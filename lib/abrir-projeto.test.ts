import { readFileSync } from 'node:fs';
import { ABRIR_PROTOCOLO, ABRIR_VERSAO, linkDoPedido, nomeDePasta, nomeDoZip, novoJob } from './abrir-projeto';

let passed = 0;
let failed = 0;
function ok(condition: unknown, message: string) {
  if (condition) { passed++; console.log(`  ok   ${message}`); }
  else { failed++; console.error(`  FAIL ${message}`); }
}

console.log('ABRIR DIRETO NO EDITOR — o site e o app do PC falam a mesma língua:');

ok(nomeDoZip('AD01 - CREATOR', 'capcut') === 'AD01 - CREATOR - CAPCUT.zip' && nomeDoZip('AD01 - CREATOR', 'premiere') === 'AD01 - CREATOR - PREMIERE.zip',
  'nome do .zip por editor');
ok(nomeDoZip('AD:01/<x>?', 'capcut') === 'AD 01 x - CAPCUT.zip', 'nome do .zip sem caractere proibido no Windows');
ok(nomeDePasta('  AD07.  ') === 'AD07' && nomeDePasta('') === 'PROJETO PILOT', 'pasta sem ponto/espaço no fim e nunca vazia');

const job = novoJob();
ok(/^[A-Za-z0-9-]{8,64}$/.test(job) && novoJob() !== job, 'id do pedido no formato que o app aceita, um por clique');

const link = linkDoPedido({ alvo: 'capcut', job, zip: 'AD01 - CREATOR - CAPCUT.zip', t: 1791485407487.4 });
const u = new URL(link);
ok(link.startsWith(`${ABRIR_PROTOCOLO}://abrir?`) && u.searchParams.get('alvo') === 'capcut' && u.searchParams.get('job') === job
  && u.searchParams.get('zip') === 'AD01 - CREATOR - CAPCUT.zip' && u.searchParams.get('t') === '1791485407487' && u.searchParams.get('v') === '1',
  'link com alvo, id, nome do zip e instante do clique');
ok(!link.includes('+') && link.includes('%20'), 'espaço vira %20 (o app lê com UnescapeDataString)');

// o app (C#) e o site têm de concordar: protocolo, arquivo do pedido, cor da capa e versão
const cs = (f: string) => readFileSync(`engine/abrir/${f}`, 'utf8');
ok(cs('Instalador.cs').includes(`public const string Protocolo = "${ABRIR_PROTOCOLO}";`), 'app registra o MESMO protocolo que o site chama');
ok(cs('Pedido.cs').includes('public const string ArquivoDoJob = "autoedit-job.json";')
  && readFileSync('lib/pilot-projeto-run.ts', 'utf8').includes("export const ARQUIVO_DO_JOB = 'autoedit-job.json';"), 'app procura o MESMO autoedit-job.json que o site escreve');
const pastas = readFileSync('lib/pilot-projeto-pastas.ts', 'utf8');
const cor = /CAPA_COR = \{ r: (\d+), g: (\d+), b: (\d+) \}/.exec(pastas);
ok(!!cor && cs('Capcut.cs').includes(`Color.FromArgb(${cor[1]}, ${cor[2]}, ${cor[3]})`), 'app procura a MESMA cor de capa que o site pinta');
ok(cs('Capcut.cs').includes('"autoedit-capa-final.jpg"') && readFileSync('lib/pilot-projeto-run.ts', 'utf8').includes("CAPA_FINAL_ARQUIVO = 'autoedit-capa-final.jpg'"),
  'app troca a capa pela MESMA capa final que o site guarda');
ok(cs('AssemblyInfo.cs').includes(`AssemblyInformationalVersion("${ABRIR_VERSAO}")`), 'versão do app = versão que o site anuncia');
const meta = JSON.parse(readFileSync('public/downloads/auto-edit-abrir.json', 'utf8'));
ok(meta.versao === ABRIR_VERSAO && /^[0-9a-f]{64}$/.test(meta.sha256Exe), 'instalador publicado é desta versão (rode node engine/abrir/build.mjs ao mudar o app)');

// a cor da capa: o detector do app aceita o rosa e recusa o resto da tela do CapCut
const det = (r: number, g: number, b: number) => r > 150 && g < 90 && b > 85 && b < 230 && r - b > 30 && r - g > 120;
ok(cs('Capcut.cs').includes('r > 150 && g < 90 && b > 85 && b < 230 && r - b > 30 && r - g > 120'), 'detector do app = o que este teste confere');
ok(det(255, 0, 170) && det(178, 0, 119) && det(250, 8, 165), 'acha o rosa (normal, escurecido do hover, JPEG)');
ok(!det(0, 193, 205) && !det(217, 70, 239) && !det(255, 255, 255) && !det(255, 60, 60) && !det(40, 40, 50) && !det(167, 139, 250),
  'não confunde com o ciano do CapCut, o fúcsia/violeta da janelinha, branco, vermelho ou cinza');

console.log(`\n${passed} passaram, ${failed} falharam.`);
if (failed) process.exit(1);
