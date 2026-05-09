/**
 * DARKO LAB Extension — Content Script HeyGen
 *
 * Roda em app.heygen.com. Recebe comandos do background worker pra
 * automatizar a UI do HeyGen: digitar copy, escolher avatar/voz, gerar,
 * polar status, retornar URL final.
 *
 * AVISO IMPORTANTE: HeyGen pode mudar seletores DOM a qualquer momento.
 * Esse content script e best-effort — se quebrar, atualizar os seletores.
 *
 * Estrategia:
 *  1. Navegar pra /create-video (Script-to-Video)
 *  2. Aguardar elementos carregarem
 *  3. Selecionar avatar via API interna do HeyGen (mais robusto que clicks)
 *  4. Inserir texto no textarea de script
 *  5. Selecionar voice id (se override)
 *  6. Clicar Generate
 *  7. Capturar request POST de generation, extrair video_id
 *  8. Polar GET /api/v1/video.status ate completed
 *  9. Retornar video_url
 */

const SELECTORS = {
  scriptTextarea:
    'textarea[placeholder*="script" i], textarea[placeholder*="texto" i], div[contenteditable="true"]',
  generateButton: 'button[type="submit"], button:has(span:contains("Generate")), button.submit-btn',
};

let currentJob = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'HG_RUN_JOB') {
    runJob(msg.requestId, msg.payload).catch((err) => {
      reportError(msg.requestId, err?.message ?? String(err));
    });
    return false;
  }
  if (msg && msg.type === 'HG_TEST_SESSION') {
    testSession()
      .then((res) => sendResponse(res))
      .catch((e) =>
        sendResponse({ ok: false, detail: e?.message ?? String(e) }),
      );
    return true; // mantem o callback async
  }
});

/**
 * Tenta uma chamada leve pro HeyGen pra confirmar se a sessao esta valida.
 * Endpoint /api/v1/user/info costuma responder com info do usuario logado.
 */
async function testSession() {
  const headers = getInternalAuthHeaders();
  const endpoints = [
    'https://app.heygen.com/api/v1/user/info',
    'https://app.heygen.com/api/v2/user.info',
    'https://app.heygen.com/api/v1/user.info',
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers,
      });
      if (r.ok) {
        const j = await r.json().catch(() => null);
        const email = j?.data?.email ?? j?.email ?? null;
        return {
          ok: true,
          detail: email ? `Logado como ${email}` : 'Sessao valida.',
        };
      }
      if (r.status === 401 || r.status === 403) {
        return { ok: false, detail: 'Sessao expirada — faca login novamente.' };
      }
    } catch {
      /* tenta proximo */
    }
  }
  return {
    ok: false,
    detail: 'Nao consegui verificar sessao. Faca login em app.heygen.com.',
  };
}

function reportProgress(requestId, stage, percent) {
  chrome.runtime.sendMessage({
    type: 'HG_TAB_PROGRESS',
    requestId,
    stage,
    percent,
  });
}

function reportResult(requestId, videoUrl) {
  chrome.runtime.sendMessage({
    type: 'HG_TAB_RESULT',
    requestId,
    videoUrl,
  });
}

function reportError(requestId, error) {
  chrome.runtime.sendMessage({
    type: 'HG_TAB_ERROR',
    requestId,
    error,
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(predicate, timeoutMs = 15000, interval = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = predicate();
    if (v) return v;
    await sleep(interval);
  }
  throw new Error('Timeout esperando elemento.');
}

/**
 * Tenta capturar a sessao do HeyGen pra fazer chamadas pra propria API
 * interna deles. Pega cookies + token salvo no localStorage.
 *
 * Tudo dentro do contexto autenticado da aba — nao consome a API publica.
 */
function getInternalAuthHeaders() {
  // HeyGen geralmente guarda token em localStorage('access_token') ou
  // cookies sso. Como roda no contexto da aba, fetch vai propagar cookies.
  const headers = { 'Content-Type': 'application/json' };
  try {
    const token =
      localStorage.getItem('access_token') ||
      localStorage.getItem('token') ||
      '';
    if (token) headers['Authorization'] = 'Bearer ' + token;
  } catch (e) {
    /* ignora */
  }
  return headers;
}

/**
 * Job principal. Estrategia hibrida: usa API interna do HeyGen pra
 * generation (mais robusto que click-fu) com cookies de sessao.
 */
async function runJob(requestId, payload) {
  if (currentJob) {
    reportError(
      requestId,
      'Outra geracao em andamento na mesma aba — aguarde finalizar.',
    );
    return;
  }
  currentJob = requestId;

  try {
    const {
      copy,
      audioBase64,
      audioFilename,
      avatarId,
      voiceId,
      motor,
      partLabel,
    } = payload;

    if (!avatarId) {
      throw new Error('payload invalido: avatarId obrigatorio.');
    }
    if (!copy && !audioBase64) {
      throw new Error('payload invalido: copy OU audioBase64 obrigatorio.');
    }

    reportProgress(requestId, `Preparando ${partLabel ?? ''}...`);

    const headers = getInternalAuthHeaders();

    // 1) Se modo audio: faz upload do audio pro HeyGen primeiro
    let voiceBlock;
    if (audioBase64) {
      reportProgress(requestId, 'Uploadando audio pro HeyGen...');
      const audioUrl = await uploadAudioToHeyGen(
        audioBase64,
        audioFilename ?? `${partLabel ?? 'audio'}.mp3`,
        headers,
      );
      voiceBlock = {
        type: 'audio',
        audio_url: audioUrl,
      };
    } else {
      voiceBlock = voiceId
        ? { type: 'text', input_text: copy, voice_id: voiceId }
        : { type: 'text', input_text: copy };
    }

    const generateBody = {
      video_inputs: [
        {
          character: {
            type: 'avatar',
            avatar_id: avatarId,
            avatar_style: motor === 'V' ? 'closeUp' : 'normal',
          },
          voice: voiceBlock,
          background: { type: 'color', value: '#0a0a0a' },
        },
      ],
      dimension: { width: 1080, height: 1920 },
      title: partLabel ? `DARKO LAB ${partLabel}` : 'DARKO LAB Auto',
    };

    reportProgress(requestId, 'Enviando job pro HeyGen...');

    const headers = getInternalAuthHeaders();

    // Tenta endpoints INTERNOS primeiro (autenticam via cookie de sessao).
    // Fallback pra v2 publica so se o user tiver API key configurada na sessao
    // (improvavel — geralmente quem instala a extensao quer evitar API).
    const generateEndpoints = [
      'https://app.heygen.com/api/v2/video/generate',
      'https://app.heygen.com/api/v1/video/generate',
      'https://app.heygen.com/api/v1/video.generate',
      'https://api.heygen.com/v2/video/generate',
    ];

    let videoId = null;
    let lastErrorDetail = '';

    for (const url of generateEndpoints) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify(generateBody),
        });
        if (res.status === 401 || res.status === 403) {
          lastErrorDetail = `Login expirado em ${url} (${res.status})`;
          continue; // tenta proximo
        }
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          lastErrorDetail = `${url} → ${res.status}: ${t.slice(0, 150)}`;
          continue;
        }
        const json = await res.json().catch(() => null);
        videoId =
          json?.data?.video_id ??
          json?.data?.id ??
          json?.video_id ??
          json?.id ??
          null;
        if (videoId) break;
        lastErrorDetail = `${url} sem video_id no body`;
      } catch (e) {
        lastErrorDetail = `${url}: ${e.message ?? e}`;
      }
    }

    if (!videoId) {
      throw new Error(
        `HeyGen rejeitou a request — login expirou ou endpoint mudou. Faca login em https://app.heygen.com e tente de novo. Detalhe: ${lastErrorDetail}`,
      );
    }

    // 2) Polar status
    reportProgress(requestId, 'HeyGen processando avatar...', 0);

    const pollDeadline = Date.now() + 15 * 60 * 1000; // 15min max
    let lastPercent = 0;

    const statusEndpoints = [
      `https://app.heygen.com/api/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
      `https://app.heygen.com/api/v2/video.status?video_id=${encodeURIComponent(videoId)}`,
      `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
    ];

    while (Date.now() < pollDeadline) {
      if (currentJob !== requestId) {
        throw new Error('Job foi cancelado.');
      }

      let data = null;
      for (const url of statusEndpoints) {
        try {
          const r = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers,
          });
          if (r.ok) {
            const j = await r.json().catch(() => null);
            data = j?.data ?? j ?? null;
            if (data) break;
          }
        } catch {
          /* tenta proximo */
        }
      }

      if (!data) {
        await sleep(5000);
        continue;
      }

      const status = String(data.status ?? '');
      const videoUrl = data.video_url ?? data.url ?? '';

      if (status === 'completed' && videoUrl) {
        reportProgress(requestId, 'Concluido!', 1);
        reportResult(requestId, videoUrl);
        currentJob = null;
        return;
      }

      if (status === 'failed') {
        throw new Error(
          data?.error?.message ?? data?.error ?? 'HeyGen retornou status failed.',
        );
      }

      lastPercent = Math.min(0.9, lastPercent + 0.05);
      reportProgress(
        requestId,
        `HeyGen: ${status || 'processando'}...`,
        lastPercent,
      );
      await sleep(5000);
    }

    throw new Error('Timeout — HeyGen demorou mais de 15min.');
  } catch (e) {
    reportError(requestId, e?.message ?? String(e));
  } finally {
    if (currentJob === requestId) currentJob = null;
  }
}

/**
 * Upload de audio pro HeyGen. Retorna URL hospedada nos servidores deles
 * pra usar no campo voice.audio_url.
 *
 * Tenta multiplos endpoints (HeyGen as vezes muda) — usa o que responder OK.
 */
async function uploadAudioToHeyGen(audioBase64, filename, headers) {
  // Decodifica base64 pra binary
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'mp3').toLowerCase();
  const mime =
    ext === 'wav'
      ? 'audio/wav'
      : ext === 'm4a'
        ? 'audio/mp4'
        : ext === 'ogg' || ext === 'opus'
          ? 'audio/ogg'
          : 'audio/mpeg';
  const blob = new Blob([bytes.buffer], { type: mime });

  // Tenta endpoint v1 upload
  const uploadHeaders = { ...headers };
  delete uploadHeaders['Content-Type']; // deixa o browser setar com boundary
  uploadHeaders['Content-Type'] = mime;

  // Internos primeiro (cookies da sessao) → upload publico → API publica
  const endpoints = [
    'https://app.heygen.com/api/v1/upload/asset',
    'https://app.heygen.com/api/v2/asset',
    'https://upload.heygen.com/v1/asset',
    'https://api.heygen.com/v1/asset',
  ];

  let lastError = '';
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        credentials: 'include',
        headers: uploadHeaders,
        body: blob,
      });
      if (!res.ok) {
        lastError = `${res.status} em ${ep}`;
        continue;
      }
      const json = await res.json().catch(() => null);
      const url =
        json?.data?.url ??
        json?.data?.file_url ??
        json?.url ??
        json?.file_url ??
        '';
      if (url) return url;
      lastError = `${ep} sem URL no body`;
    } catch (e) {
      lastError = `${ep}: ${e.message}`;
    }
  }
  throw new Error(`Nenhum endpoint de upload de audio respondeu. ${lastError}`);
}

console.log('[DARKO LAB HeyGen Content] online');
