/**
 * Banco de provas do CURADOR LOCAL com DADOS REAIS.
 *
 * Roda o curador sobre a transcrição de verdade do podcast (323 frases, PT) e o
 * envelope de energia de verdade (2858 medições do áudio), e audita o resultado
 * como um editor humano auditaria — sem olhar a nota que o próprio curador deu.
 *
 * Uso: tsc este arquivo + o curador, depois `node auditar-curador.js`.
 */
import * as fs from 'fs';
import * as path from 'path';
import { curate } from './curate';

const DIR = process.env.AC_DIR as string;

type Dump = {
  transcript: { words: Array<{ text: string; start: number; end: number }>; sentences: Array<{ id: string; startMs: number; endMs: number; text: string; wordFrom: number; wordTo: number }>; language: string; provider: string; hash: string };
  source: { name: string; durationSec: number | null };
  settings: Record<string, unknown>;
};

const dump = JSON.parse(fs.readFileSync(path.join(DIR, 'dump_transcript.json'), 'utf8')) as Dump;
const energyVals = fs
  .readFileSync(path.join(DIR, 'energy.txt'), 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim())
  .map((l) => (l.includes('inf') ? -120 : parseFloat(l)));

const durationSec = dump.source.durationSec ?? 1429;

// ── muletas/anáforas que NÃO podem abrir um corte (auditoria independente) ──
const ABERTURA_RUIM = /^(então|entao|aí|ai|e aí|mas|porque|por isso|isso|isso aí|ele|ela|eles|elas|essa|esse|isso é|daí|dai|aí você|tipo|tipo assim|né|e|ou|que|aí eu|só que|beleza|certo|bom|enfim|inclusive|também|tambem|aliás|alias)\b/i;
const FIM_RUIM = /\b(e|ou|mas|porque|que|pra|para|com|de|do|da|em|no|na|então|entao|aí|ai|se|quando|como|qual|quem|é|foi|vai|tem)\s*$/i;

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function rodar(nome: string, settings: Record<string, unknown>, comEnergia: boolean) {
  const t0 = Date.now();
  const out = curate({
    transcript: dump.transcript as never,
    energy: comEnergia ? { stepSec: 0.5, db: Float32Array.from(energyVals) } : null,
    settings: { ...dump.settings, ...settings } as never,
    durationSec,
  });
  const ms = Date.now() - t0;

  const falhas: string[] = [];
  const clips = out.clips;

  console.log(`\n${'='.repeat(78)}\n${nome}  (${ms} ms, ${clips.length} cortes, ${out.topics.length} assuntos)\n${'='.repeat(78)}`);

  const ordenados = [...clips].sort((a, b) => a.startMs - b.startMs);
  for (let i = 0; i < ordenados.length; i++) {
    const c = ordenados[i];
    const dur = (c.endMs - c.startMs) / 1000;
    // As frases do Whisper real SE SOBREPOEM (a ultima palavra de uma termina
    // depois do inicio da seguinte), entao "encostar no tempo" nao quer dizer
    // "estar no corte". A frase conta quando ela COMECA dentro do corte, com a
    // mesma folga de respiro que o refineBounds usa (150 ms / 300 ms).
    const frases = dump.transcript.sentences.filter(
      (s) => s.startMs >= c.startMs - 200 && s.endMs <= c.endMs + 400,
    );
    const abre = (frases[0]?.text ?? '').trim();
    const fecha = (frases[frases.length - 1]?.text ?? '').trim();

    console.log(`\n[${c.plan.score}] ${fmt(c.startMs)}–${fmt(c.endMs)} (${dur.toFixed(0)}s)`);
    console.log(`  título   : ${c.plan.title}`);
    console.log(`  headline : ${c.plan.headline}`);
    console.log(`  abre     : "${abre.slice(0, 110)}"`);
    console.log(`  fecha    : "${fecha.slice(0, 110)}"`);
    console.log(`  tags     : ${c.plan.hashtags.join(', ')}`);
    console.log(`  por quê  : ${c.plan.why}`);

    // ── auditoria independente ──
    if (ABERTURA_RUIM.test(abre)) falhas.push(`ABERTURA fraca em ${fmt(c.startMs)}: "${abre.slice(0, 60)}"`);
    if (FIM_RUIM.test(fecha)) falhas.push(`FIM pendurado em ${fmt(c.startMs)}: "${fecha.slice(0, 60)}"`);
    const hw = c.plan.headline.trim().split(/\s+/).length;
    if (hw > 8) falhas.push(`HEADLINE com ${hw} palavras em ${fmt(c.startMs)}`);
    if (/[.]$/.test(c.plan.headline.trim())) falhas.push(`HEADLINE com ponto final em ${fmt(c.startMs)}`);
    if (c.plan.title.length > 70) falhas.push(`TÍTULO com ${c.plan.title.length} chars em ${fmt(c.startMs)}`);
    if (c.plan.hashtags.length !== 5) falhas.push(`HASHTAGS ${c.plan.hashtags.length} em ${fmt(c.startMs)}`);
    if (dur < 8) falhas.push(`DURAÇÃO ${dur.toFixed(0)}s (curto demais) em ${fmt(c.startMs)}`);
    if (dur > 310) falhas.push(`DURAÇÃO ${dur.toFixed(0)}s (longo demais) em ${fmt(c.startMs)}`);
    if (!abre) falhas.push(`SEM FRASE de abertura mapeada em ${fmt(c.startMs)}`);
  }

  // sobreposição
  for (let i = 1; i < ordenados.length; i++) {
    const a = ordenados[i - 1];
    const b = ordenados[i];
    const over = Math.min(a.endMs, b.endMs) - b.startMs;
    if (over > 0) {
      const menor = Math.min(a.endMs - a.startMs, b.endMs - b.startMs);
      if (over / menor > 0.25) falhas.push(`SOBREPOSIÇÃO de ${(over / 1000).toFixed(0)}s entre ${fmt(a.startMs)} e ${fmt(b.startMs)}`);
    }
  }

  // títulos repetidos
  const titulos = new Set<string>();
  for (const c of clips) {
    const k = c.plan.title.toLowerCase().trim();
    if (titulos.has(k)) falhas.push(`TÍTULO repetido: "${c.plan.title}"`);
    titulos.add(k);
  }

  return { clips, falhas, ms };
}

const a = rodar('PADRÃO (auto, 9:16, com energia)', {}, true);
const b = rodar('SEM ENERGIA (fallback quando o ffmpeg falha)', {}, false);
const c = rodar('CURTOS (até 30 s, 10 cortes)', { length: 'lt30', count: 10 }, true);
const d = rodar('LONGOS (90 s–3 min, 5 cortes)', { length: '90-180', count: 5 }, true);

// determinismo
const e1 = rodar('DETERMINISMO (2ª execução idêntica)', {}, true);
const iguais =
  JSON.stringify(a.clips.map((x) => [x.startMs, x.endMs, x.plan.title])) ===
  JSON.stringify(e1.clips.map((x) => [x.startMs, x.endMs, x.plan.title]));

const todas = [...a.falhas, ...b.falhas, ...c.falhas, ...d.falhas];
console.log(`\n${'='.repeat(78)}\nLAUDO\n${'='.repeat(78)}`);
console.log(`determinístico: ${iguais ? 'SIM' : 'NÃO ❌'}`);
console.log(`tempo do curador: ${a.ms} ms (padrão) / ${b.ms} ms (sem energia)`);
console.log(`problemas encontrados: ${todas.length}`);
for (const f of todas) console.log(`  ❌ ${f}`);
if (todas.length === 0 && iguais) console.log('\n✅ passou em tudo que dá pra medir sem olho humano.');
fs.writeFileSync(
  path.join(DIR, 'laudo-curador.json'),
  JSON.stringify({ padrao: a.clips, semEnergia: b.clips.length, curtos: c.clips.length, longos: d.clips.length, falhas: todas, deterministico: iguais }, null, 2),
);
