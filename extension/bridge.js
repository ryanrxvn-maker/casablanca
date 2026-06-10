/**
 * DARKO LAB Extension - Bridge content script
 * Roda em darkoautoedit.com e localhost. Faz a ponte entre a pagina
 * (window.postMessage) e o background worker (chrome.runtime.sendMessage).
 */

(function () {
  const VERSION = chrome.runtime.getManifest().version;

  function sendToPage(msg) {
    // IMPORTANTE: source: 'darkolab-ext' precisa vir DEPOIS do spread,
    // senao um campo source dentro do msg (vindo de payloads do background)
    // sobrescreve o source do envelope e a page nao reconhece a mensagem.
    window.postMessage({ ...msg, source: 'darkolab-ext' }, '*');
  }

  /**
   * Encaminha mensagem pro background com PROTECAO contra "Extension
   * context invalidated": quando a extensao e atualizada/recarregada com
   * a pagina aberta, chrome.runtime.sendMessage LANCA sincronamente e o
   * callback nunca roda — antes disso o erro era engolido e a page ficava
   * esperando ate o timeout (30s+) sem resposta nenhuma ("hang silencioso").
   * Agora a page recebe erro INSTANTANEO com instrucao de F5.
   *
   * makeErrorMsg(errorText) → objeto de resposta de erro pro tipo certo.
   * onAck(resp) → opcional, roda quando o background confirma recebimento.
   */
  function relayToBg(message, makeErrorMsg, onAck) {
    const ctxInvalidadoMsg =
      'Extensao foi atualizada/recarregada — recarregue esta pagina (F5) pra reconectar.';
    try {
      chrome.runtime.sendMessage(message, (resp) => {
        if (chrome.runtime.lastError) {
          sendToPage(makeErrorMsg(chrome.runtime.lastError.message ?? 'Background nao respondeu.'));
        } else if (onAck) {
          onAck(resp);
        }
      });
    } catch (e) {
      const raw = e?.message || String(e);
      sendToPage(makeErrorMsg(/context invalidated/i.test(raw) ? ctxInvalidadoMsg : raw));
    }
  }

  window.addEventListener('message', (ev) => {
    const data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.source !== 'darkolab') return;

    if (data.type === 'HG_PING') {
      sendToPage({ type: 'HG_PONG', version: VERSION });
      return;
    }

    if (data.type === 'HG_GENERATE') {
      const requestId = data.requestId;
      relayToBg(
        { type: 'HG_GENERATE', requestId, payload: data.payload },
        (error) => ({ type: 'HG_ERROR', requestId, error }),
      );
      return;
    }

    if (data.type === 'HG_STUDIO_GENERATE') {
      const requestId = data.requestId;
      relayToBg(
        { type: 'HG_STUDIO_GENERATE', requestId, payload: data.payload },
        (error) => ({ type: 'HG_ERROR', requestId, error }),
      );
      return;
    }

    if (data.type === 'HG_CANCEL') {
      try { chrome.runtime.sendMessage({ type: 'HG_CANCEL', requestId: data.requestId }); } catch {}
      return;
    }

    if (data.type === 'HG_TEST_SESSION') {
      const requestId = data.requestId;
      relayToBg(
        { type: 'HG_TEST_SESSION', requestId },
        (detail) => ({ type: 'HG_TEST_RESULT', requestId, ok: false, detail }),
      );
      return;
    }

    if (data.type === 'HG_API_FETCH') {
      const requestId = data.requestId;
      relayToBg(
        { type: 'HG_API_FETCH', requestId, req: data.req },
        (message) => ({ type: 'HG_API_RESULT', requestId, status: 0, ok: false, body: { message } }),
      );
      return;
    }

    if (data.type === 'HG_RELOAD_SELF') {
      try { chrome.runtime.sendMessage({ type: 'HG_RELOAD_SELF' }); } catch {}
      // Sem resposta — extensao vai reiniciar, perde a conexao
      return;
    }

    if (data.type === 'HG_FETCH_DOC') {
      const requestId = data.requestId;
      relayToBg(
        { type: 'HG_FETCH_DOC', requestId, url: data.url },
        (error) => ({ type: 'HG_DOC_RESULT', requestId, ok: false, error }),
        // ACK → page sabe que o background ACEITOU o job e esta lendo o doc.
        // Com isso a page pode esperar MAIS que 30s (export lento + fallback
        // tab) sem confundir com "extensao morta".
        () => sendToPage({ type: 'HG_DOC_ACK', requestId }),
      );
      return;
    }

    if (data.type === 'HG_LIST_AVATARS') {
      const requestId = data.requestId;
      relayToBg(
        { type: 'HG_LIST_AVATARS', requestId },
        (error) => ({ type: 'HG_AVATARS_RESULT', requestId, ok: false, avatars: [], error }),
      );
      return;
    }

    if (data.type === 'HG_GET_CREDITS') {
      const requestId = data.requestId;
      relayToBg(
        { type: 'HG_GET_CREDITS', requestId },
        (error) => ({ type: 'HG_CREDITS_RESULT', requestId, ok: false, error }),
      );
      return;
    }

    if (data.type === 'HG_CREATE_PHOTO_AVATAR') {
      const requestId = data.requestId;
      relayToBg(
        { type: 'HG_CREATE_PHOTO_AVATAR', requestId, payload: data.payload },
        (error) => ({ type: 'HG_PHOTO_AVATAR_RESULT', requestId, ok: false, error }),
      );
      return;
    }

    if (data.type === 'HG_DRIVE_LIST_FOLDER') {
      const requestId = data.requestId;
      relayToBg(
        { type: 'HG_DRIVE_LIST_FOLDER', requestId, folderId: data.folderId },
        (error) => ({ type: 'HG_DRIVE_LIST_FOLDER_RESULT', requestId, ok: false, error, files: [] }),
      );
      return;
    }

    if (data.type === 'HG_DOWNLOAD_DRIVE') {
      const requestId = data.requestId;
      relayToBg(
        { type: 'HG_DOWNLOAD_DRIVE', requestId, fileId: data.fileId },
        (error) => ({ type: 'HG_DRIVE_DOWNLOAD_RESULT', requestId, ok: false, error }),
      );
      return;
    }

    if (data.type === 'HG_CLONE_VOICE') {
      const requestId = data.requestId;
      relayToBg(
        { type: 'HG_CLONE_VOICE', requestId, payload: data.payload },
        (error) => ({ type: 'HG_CLONE_VOICE_RESULT', requestId, ok: false, error }),
      );
      return;
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.source === 'darkolab-bg') {
      console.log('[DARKO LAB Bridge] <-- bg msg type=', msg.type, 'reqId=', msg.requestId, 'payload keys=', msg.payload ? Object.keys(msg.payload) : 'none');
      sendToPage({
        type: msg.type,
        requestId: msg.requestId,
        ...msg.payload,
      });
      console.log('[DARKO LAB Bridge] --> postMessage darkolab-ext type=', msg.type, 'reqId=', msg.requestId);
    }
  });

  console.log('[DARKO LAB Bridge] online v' + VERSION + ' on ' + window.location.host);
})();
