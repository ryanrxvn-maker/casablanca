/**
 * voz-medir.mjs — mede o PITCH do que o HeyGen realmente entregou.
 *
 * Existe porque o rótulo mente nos dois sentidos (medido em 23.08):
 *   • o clone da Cátia voltou `gender: "male"` e o preview saiu em 260 Hz,
 *     feminino;
 *   • `redheadedgurl` e `AD14G1GL[C]-RIPTVWA` voltaram `female` e as duas
 *     saíram com voz grave e masculinizada NO TAKE.
 *
 * Então não se decide pelo campo: baixa-se o take (ou o preview do clone) e
 * mede-se. Trinta segundos de conferência contra um vídeo pronto errado.
 *
 *   autoedit voz medir --video <videoId>          # o take que saiu
 *   autoedit voz medir --arquivo take.mp4
 *   autoedit voz medir --url <preview do clone>
 *
 * Precisa de ffmpeg no PATH e de `praat-parselmouth` no Python
 * (`pip install praat-parselmouth`) — o mesmo motor do tratar_voz.py, porque
 * autocorrelação na mão trava no 1º harmônico e devolve o dobro da frequência.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Faixas de decisão — as mesmas do portão de voz das skills. */
const GRAVE = 165;   // abaixo disso: masculina
const AGUDA = 185;   // acima disso: feminina; entre as duas, ambígua

const MEDIDOR = `
import sys, numpy as np, parselmouth
f = sys.argv[1]
snd = parselmouth.Sound(f)
p = snd.to_pitch(pitch_floor=60.0, pitch_ceiling=400.0)
v = np.array([x for x in p.selected_array["frequency"] if x > 0])
if not len(v):
    print("SEM_PITCH"); raise SystemExit(0)
h, b = np.histogram(v, bins=16)
picos = [(round((b[i]+b[i+1])/2), int(h[i])) for i in range(len(h)) if h[i] > 0.30*h.max()]
# proporcao de silencio: quanto maior, mais "espacada" a fala
y = snd.values[0]; sr = int(snd.sampling_frequency); hop = int(0.02*sr)
e = np.array([np.sqrt(np.mean(y[k*hop:(k+1)*hop]**2)) for k in range(len(y)//hop)])
lim = max(1e-4, float(np.percentile(e, 92))*0.10)
print("%.1f|%.1f|%.1f|%.1f|%s" % (np.median(v), np.percentile(v,10), np.percentile(v,90),
      100*float(np.mean(e < lim)), ";".join("%d:%d" % pk for pk in picos[:6])))
`;

function rodar(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout || '', err: r.stderr || '' };
}

/**
 * Mede um arquivo de áudio/vídeo local e devolve o laudo.
 * @param {string} caminho
 */
export function medirArquivo(caminho) {
  if (!existsSync(caminho)) throw new Error('arquivo nao existe: ' + caminho);
  const dir = mkdtempSync(join(tmpdir(), 'vozmedir-'));
  const wav = join(dir, 'a.wav');
  const py = join(dir, 'm.py');
  try {
    const f = rodar('ffmpeg', ['-y', '-loglevel', 'error', '-i', caminho, '-vn', '-ac', '1', '-ar', '22050', wav]);
    if (!existsSync(wav)) throw new Error('ffmpeg nao extraiu audio: ' + (f.err || '').slice(0, 200));
    writeFileSync(py, MEDIDOR, 'utf8');
    const r = rodar('python', [py, wav]);
    const linha = (r.out || '').trim().split('\n').pop();
    if (!linha || linha === 'SEM_PITCH') {
      if (/No module named/.test(r.err)) throw new Error('falta o parselmouth: pip install praat-parselmouth');
      throw new Error('nao consegui medir o pitch' + (r.err ? ': ' + r.err.slice(0, 200) : ''));
    }
    const [med, p10, p90, sil, picos] = linha.split('|');
    const mediana = Number(med);
    const sexo = mediana < GRAVE ? 'MASCULINA' : mediana > AGUDA ? 'feminina' : 'AMBIGUA';
    const listaPicos = String(picos || '').split(';').filter(Boolean)
      .map((x) => { const [hz, n] = x.split(':'); return { hz: Number(hz), n: Number(n) }; });
    // pico forte na faixa masculina numa voz "feminina" = sintese masculinizou,
    // ou sobrou um segundo falante no material que virou o clone.
    const graves = listaPicos.filter((x) => x.hz < 135 && x.n > 0);
    return {
      mediana, p10: Number(p10), p90: Number(p90), silencioPct: Number(sil),
      sexo, picos: listaPicos,
      alertas: [
        ...(sexo === 'MASCULINA' ? ['a voz saiu MASCULINA'] : []),
        ...(sexo === 'AMBIGUA' ? ['pitch na faixa ambigua (' + GRAVE + '-' + AGUDA + ' Hz) — ouca antes de aprovar'] : []),
        ...(graves.length ? ['pico na faixa grave (' + graves.map((x) => x.hz + ' Hz').join(', ') + ') — masculinizou ou tem 2 falantes'] : []),
        // CALIBRADO em 23.08 contra takes que o Silas aprovou: 18% e 28%.
        // Take de anuncio tem pausa de pontuacao mesmo — 28 acendia alarme
        // falso. 38 deixa o normal passar e ainda pega o patologico (o
        // clone da Catia herdando as pausas do podcast).
        ...(Number(sil) > 38 ? ['fala ESPACADA (' + Number(sil).toFixed(0) + '% de silencio) — o clone pode ter herdado as pausas do material'] : []),
      ],
    };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

/** Baixa o take do HeyGen pelo videoId e mede. Usa o CLI `heygen`. */
export function medirVideo(videoId) {
  const dir = mkdtempSync(join(tmpdir(), 'vozmedir-'));
  const mp4 = join(dir, 'take.mp4');
  try {
    const r = rodar('heygen', ['video', 'download', videoId, '--output-path', mp4, '--force']);
    if (!existsSync(mp4)) throw new Error('nao baixou o video: ' + (r.err || r.out || '').slice(0, 200));
    return medirArquivo(mp4);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

/** Baixa de uma URL (ex: `preview_audio_url` do clone) e mede. */
export function medirUrl(url) {
  const dir = mkdtempSync(join(tmpdir(), 'vozmedir-'));
  const arq = join(dir, 'a.bin');
  try {
    const r = rodar('curl', ['-sL', '-o', arq, url]);
    if (!existsSync(arq)) throw new Error('nao baixou a url: ' + (r.err || '').slice(0, 200));
    return medirArquivo(arq);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
  }
}
