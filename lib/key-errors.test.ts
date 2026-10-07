/**
 * Avisos de CHAVE: cada falha que o cliente pode ver tem que dizer a causa
 * REAL, em português de gente, e o que fazer. Nenhum pode culpar a chave sem
 * prova, nem cair num gatilho do toFriendlyMessage que troque o aviso por um
 * diagnóstico errado ("o gerador recusou o conteúdo", "a internet falhou"…).
 *
 * Roda com: npx tsx lib/key-errors.test.ts
 */
import { readFileSync } from 'fs';
import {
  AVISO_SEM_FALA,
  ONDE_COLAR,
  TEM_CARD,
  avisoChaveFaltando,
  avisoChaveIlegivel,
  avisoChaveNaoAceita,
  classificarFalhaDeChave,
  explicarFalhaTranscricao,
  type KeyService,
} from './key-errors';
import { toFriendlyMessage } from './friendly-error';

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) falhas++;
};
const ler = (p: string) => readFileSync(p, 'utf8');

const TODOS: KeyService[] = ['anthropic', 'assemblyai', 'elevenlabs', 'heygen', 'heygen_oauth', 'replicate', 'groq'];
const GENERICO = 'Não consegui transcrever o áudio agora. Tente de novo em instantes.';
const T = (errors: string[], aceitas: Array<'groq' | 'assemblyai'> = ['groq', 'assemblyai']) =>
  explicarFalhaTranscricao(errors, aceitas);

// Todo texto que o cliente pode ler sai daqui pra checagem de gatilho/estilo.
const visiveis: string[] = [];
const ver = (s: string) => {
  visiveis.push(s);
  return s;
};

console.log('key-errors: chave faltando / ilegível / não aceita');
for (const s of TODOS) {
  const a = ver(avisoChaveFaltando(s));
  const b = ver(avisoChaveIlegivel(s));
  const c = ver(avisoChaveNaoAceita(s));
  if (TEM_CARD.has(s)) {
    ok(a.includes(ONDE_COLAR) && b.includes(ONDE_COLAR), `${s}: diz ONDE colar`);
  } else {
    // Sem card na tela: mandar "colar lá" seria aviso sem saída.
    ok(!(a + b + c).includes(ONDE_COLAR) && /suporte/.test(a) && /suporte/.test(b) && /suporte/.test(c), `${s}: sem card, aponta o suporte`);
  }
  ok(!/\/configuracoes|missingKey|api key/i.test(a + b + c), `${s}: sem rota nem jargão`);
}
const config0 = ler('app/configuracoes/api/page.tsx');
for (const s of TEM_CARD) {
  ok(new RegExp(`id: '${s}'`).test(config0), `TEM_CARD bate com a tela: card de ${s} existe`);
}
for (const s of TODOS.filter((x) => !TEM_CARD.has(x))) {
  ok(!new RegExp(`id: '${s}'`).test(config0), `TEM_CARD bate com a tela: ${s} não tem card`);
}
ok(avisoChaveFaltando('groq').startsWith('Falta a sua chave do Groq.'), 'artigo do Groq');
ok(avisoChaveFaltando('assemblyai').startsWith('Falta a sua chave da AssemblyAI.'), 'artigo da AssemblyAI');
ok(/Conectar HeyGen agora/.test(avisoChaveFaltando('heygen_oauth')), 'OAuth do HeyGen manda pro botão, não pra colar chave');

console.log('key-errors: classificação só com prova');
ok(classificarFalhaDeChave('groq: Groq key ausente.') === 'sem-chave', 'key ausente');
ok(classificarFalhaDeChave('assemblyai: AssemblyAI key nao configurada.') === 'sem-chave', 'key não configurada (Gerador de SRT)');
ok(classificarFalhaDeChave('groq: Groq 401: {"error":{"message":"Invalid API Key","code":"invalid_api_key"}}') === 'chave-invalida', 'Groq 401');
ok(classificarFalhaDeChave('assemblyai: AAI upload 401 {"error": "Authentication error, API token missing/invalid"}') === 'chave-invalida', 'AssemblyAI 401');
ok(classificarFalhaDeChave('groq: Groq 403: {"error":{"message":"Forbidden"}}') === 'outra', '403 sozinho NÃO culpa a chave');
ok(classificarFalhaDeChave('groq: Groq 429: rate_limit_exceeded') === 'limite', '429 = limite');
ok(classificarFalhaDeChave('assemblyai: AAI transcript 400 {"error":"Your current account balance is negative. Please top up."}') === 'sem-credito', 'saldo negativo = sem crédito');
ok(classificarFalhaDeChave('groq: Groq retornou sem palavras.') === 'sem-fala', 'sem palavras = sem fala');
ok(classificarFalhaDeChave('assemblyai: Transcoding failed. File does not appear to contain audio.') === 'sem-fala', 'arquivo sem áudio = sem fala');
ok(classificarFalhaDeChave('groq: Groq 500: internal') === 'outra', '500 = outra (sem culpar a chave)');
ok(classificarFalhaDeChave('assemblyai: AAI timeout') === 'outra', 'timeout = outra');
ok(classificarFalhaDeChave('fetch failed ECONNRESET') === 'outra', 'rede = outra');

console.log('key-errors: transcrição (o que o cliente lê)');
ok(/Falta uma chave de transcrição/.test(ver(T(['groq: Groq key ausente.', 'assemblyai: AAI key ausente.']))), 'nenhuma chave: pede uma das duas');
ok(/basta uma/.test(T(['groq: Groq key ausente.', 'assemblyai: AAI key ausente.'])), 'deixa claro que basta uma');
ok(ver(T(['assemblyai: AAI key ausente.'], ['assemblyai'])) === avisoChaveFaltando('assemblyai'), 'só AssemblyAI aceita: pede a dela');
ok(/^O Groq não aceitou a sua chave/.test(ver(T(['groq: Groq 401: invalid_api_key', 'assemblyai: AAI key ausente.']))), 'Groq inválida + sem AssemblyAI');
ok(/^A AssemblyAI não aceitou a sua chave/.test(ver(T(['groq: Groq key ausente.', 'assemblyai: AAI upload 401 Authentication error']))), 'AssemblyAI inválida + sem Groq');
ok(/^O Groq não aceitou/.test(T(['groq: Groq 500: x', 'assemblyai: AAI upload 401 x'])) === false, 'falha genérica do 1º não esconde a chave ruim do 2º');
ok(/^A AssemblyAI não aceitou/.test(T(['groq: Groq 500: x', 'assemblyai: AAI upload 401 x'])), 'chave ruim do 2º aparece');
ok(/^Sua conta no Groq atingiu o limite de uso do plano por enquanto/.test(ver(T(['groq: Groq 429: rate limit', 'assemblyai: AAI key ausente.']))), 'limite do Groq');
ok(!/minuto/.test(T(['groq: Groq 429: rate limit', 'assemblyai: AAI key ausente.'])), 'limite não promete "um minuto" (pode ser por hora/dia)');
ok(/^Sua conta na AssemblyAI está sem crédito/.test(ver(T(['groq: Groq key ausente.', 'assemblyai: AAI transcript 402 insufficient balance']))), 'AssemblyAI sem crédito');
ok(/ou use a outra chave/.test(T(['groq: Groq key ausente.', 'assemblyai: AAI transcript 402 x'])), 'sem crédito com alternativa: sugere a outra');
ok(!/ou use a outra chave/.test(T(['assemblyai: AAI transcript 402 x'], ['assemblyai'])), 'sem alternativa: não sugere chave que não serve');
ok(ver(T(['groq: Groq key ausente.'])) === AVISO_SEM_FALA, 'AssemblyAI rodou e voltou vazia = sem fala');
ok(T([]) === AVISO_SEM_FALA, 'ninguém falhou e sem palavra = sem fala');
ok(T(['groq: Groq retornou sem palavras.', 'assemblyai: AAI key ausente.']) === AVISO_SEM_FALA, 'Groq vazio + sem AssemblyAI = sem fala');
ok(ver(T(['groq: Groq 500: x', 'assemblyai: AAI timeout'])) === GENERICO, 'falhas sem prova = genérico');
ok(T(['groq: Groq 403: Forbidden', 'assemblyai: AAI key ausente.']) === GENERICO, '403 + sem AssemblyAI = genérico (não culpa a chave)');
ok(/^O Groq não aceitou/.test(T(['groq: Groq Whisper falhou: 401 {"error":{"code":"invalid_api_key"}}', 'assemblyai: AssemblyAI key nao configurada.'])), 'formato do Gerador de SRT');
ok(/^A AssemblyAI não aceitou/.test(T(['assemblyai: 401 {"error": "Authentication error, API token missing/invalid"}'], ['assemblyai'])), 'formato da Camuflagem');
ok(
  explicarFalhaTranscricao(['groq: Groq 500: x', 'assemblyai: AAI timeout'], ['groq', 'assemblyai'], 'Texto da ferramenta.') === 'Texto da ferramenta.',
  'genérico da ferramenta é respeitado',
);
ver(AVISO_SEM_FALA);
ver(GENERICO);

console.log('key-errors: nenhum aviso cai em gatilho do toFriendlyMessage');
for (const v of visiveis) {
  ok(toFriendlyMessage(new Error(v), '__nenhum_gatilho__') === '__nenhum_gatilho__', `sem gatilho: "${v.slice(0, 60)}…"`);
}

console.log('key-errors: estilo');
for (const v of visiveis) {
  ok(!/[—–]/.test(v), `sem travessão: "${v.slice(0, 50)}…"`);
  ok(!/\b(?:4\d\d|5\d\d)\b/.test(v), `sem código HTTP: "${v.slice(0, 50)}…"`);
}

console.log('key-errors: o aviso de chave pendente em cada ferramenta');
const banner = ler('components/MissingKeyBanner.tsx');
ok(!/falha no meio/i.test(banner), 'banner não ameaça "falha no meio do processamento"');
ok(/\/configuracoes\/api#chave-/.test(banner), 'botão leva direto pro card da chave');
ok(/visibilitychange/.test(banner), 'aviso some sozinho ao voltar pra aba com a chave salva');
const USOS = [
  'app/tools/camuflagem/page.tsx',
  'app/tools/copy-srt/page.tsx',
  'app/tools/decupagem-copy/page.tsx',
  'app/tools/heygen-auto/page.tsx',
  'app/tools/tipografia/page.tsx',
  'components/auto-cortes/ClipSettingsPanel.tsx',
];
for (const p of USOS) {
  const s = ler(p);
  const m = /<MissingKeyBanner[\s\S]*?\/>/.exec(s);
  ok(!!m && /\buso="/.test(m[0]), `${p}: diz pra que a chave serve ali`);
}
ok(
  /semChave="A camuflagem funciona sem ela/.test(ler('app/tools/camuflagem/page.tsx')),
  'Camuflagem avisa que funciona sem a chave (ela só liga a conferência)',
);
const config = ler('app/configuracoes/api/page.tsx');
for (const id of ['assemblyai', 'groq', 'heygen']) {
  ok(new RegExp(`id: '${id}'`).test(config), `card de ${id} existe em Chaves de IA`);
}
ok(/id=\{`chave-\$\{m\.id\}`\}/.test(config), 'cards têm âncora chave-<serviço>');
ok(!/\$0\.04|\$0\.45/.test(config), 'sem preço chumbado (muda e vira mentira)');

console.log('key-errors: nenhum aviso manda pra rota crua');
for (const p of [
  'lib/user-keys.ts',
  'app/api/heygen/voices/route.ts',
  'lib/heygen-identidade.ts',
  'lib/llm/anthropic.ts',
  'lib/llm/groq.ts',
  'lib/auto-cortes/analyze-client.ts',
  'app/api/decupagem-copy/match/route.ts',
]) {
  ok(!/['`"][^'`"\n]*(?:em|cole em|Reconfigure em) \/configuracoes\/api/.test(ler(p)), `${p}: sem "em /configuracoes/api" em texto`);
}
ok(!/no limite por minuto/.test(ler('lib/llm/groq.ts')), 'Groq: limite não promete "por minuto"');

if (falhas > 0) {
  console.error(`\nFAIL key-errors: ${falhas} falha(s)`);
  process.exit(1);
}
console.log('\nOK key-errors: tudo passou');
