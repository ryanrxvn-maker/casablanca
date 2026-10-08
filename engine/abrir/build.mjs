/**
 * Monta o AUTO EDIT ABRIR (o app do PC que abre o projeto editável direto no
 * CapCut/Premiere) e o pacote que o site entrega:
 *
 *   engine/abrir/dist/AutoEditAbrir.exe          (csc do .NET 4 que vem no Windows)
 *   public/downloads/auto-edit-abrir.zip
 *     └─ Auto Edit Abrir/
 *         ├─ Instalar Auto Edit Abrir.exe
 *         └─ COMO INSTALAR.pdf
 *
 * Rode:  node engine/abrir/build.mjs
 * (Windows; assina com o mesmo certificado do instalador do Downloader quando
 *  ele existe neste PC — engine/installer/sign-exe.ps1.)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..', '..');
const log = (s) => console.log('[abrir] ' + s);

const versao = readFileSync(path.join(aqui, 'AssemblyInfo.cs'), 'utf8').match(/AssemblyInformationalVersion\("([^"]+)"\)/)?.[1];
if (!versao) throw new Error('versão do AssemblyInfo.cs não encontrada');

const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
if (!existsSync(csc)) throw new Error('csc.exe do .NET 4 não encontrado (precisa de Windows).');
const dist = path.join(aqui, 'dist');
mkdirSync(dist, { recursive: true });
const exe = path.join(dist, 'AutoEditAbrir.exe');
const fontes = ['AssemblyInfo.cs', 'Nativo.cs', 'Pedido.cs', 'Capcut.cs', 'Premiere.cs', 'Instalador.cs', 'Telas.cs', 'Programa.cs'];

log(`compilando ${versao}…`);
execFileSync(csc, [
  '/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', '/warn:4',
  `/out:${exe}`,
  `/win32icon:${path.join(aqui, 'icone.ico')}`,
  `/win32manifest:${path.join(aqui, 'app.manifest')}`,
  '/r:System.IO.Compression.dll', '/r:System.Web.Extensions.dll', '/r:Microsoft.VisualBasic.dll',
  '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll',
  ...fontes.map((f) => path.join(aqui, f)),
], { stdio: 'inherit', cwd: aqui });

const assinar = path.join(raiz, 'engine', 'installer', 'sign-exe.ps1');
if (process.argv.includes('--sem-assinar')) log('sem assinatura (--sem-assinar)');
else if (existsSync(assinar)) {
  try {
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', assinar, '-Exe', exe], { stdio: 'inherit' });
  } catch (e) {
    log('assinatura falhou (o exe segue sem): ' + e.message);
  }
}

log('PDF de instruções…');
const { jsPDF } = await import('jspdf');
const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
const W = pdf.internal.pageSize.getWidth();
const M = 46;
pdf.setFillColor(12, 12, 16);
pdf.rect(0, 0, W, 132, 'F');
pdf.setFillColor(167, 139, 250);
pdf.rect(0, 0, W / 2, 4, 'F');
pdf.setFillColor(217, 70, 239);
pdf.rect(W / 2, 0, W / 2, 4, 'F');
pdf.setFillColor(176, 110, 245);
pdf.roundedRect(M, 34, 58, 58, 13, 13, 'F');
pdf.setFillColor(255, 255, 255);
pdf.triangle(M + 23, 50, M + 23, 76, M + 43, 63, 'F');
pdf.setTextColor(255, 255, 255);
pdf.setFont('helvetica', 'bold');
pdf.setFontSize(22);
pdf.text('Auto Edit Abrir', M + 76, 62);
pdf.setFont('helvetica', 'normal');
pdf.setFontSize(11);
pdf.setTextColor(190, 190, 205);
pdf.text(`Como instalar (versão ${versao})`, M + 77, 82);

let y = 172;
pdf.setTextColor(40, 40, 52);
pdf.setFontSize(11.5);
const intro = pdf.splitTextToSize('Com o Auto Edit Abrir instalado, o botão "Projeto editável" do Pilot abre o projeto direto no CapCut ou no Premiere: sem extrair zip e sem procurar pasta. Leva 1 minuto.', W - 2 * M);
pdf.text(intro, M, y);
y += intro.length * 15 + 18;

const passos = [
  ['Extraia esta pasta', 'Botão direito no .zip baixado > "Extrair tudo" > Extrair.'],
  ['Abra o instalador', 'Dois cliques em "Instalar Auto Edit Abrir.exe".'],
  ['Se o Windows mostrar um aviso azul', 'Clique em "Mais informações" e depois em "Executar assim mesmo". O aviso aparece com todo programa novo que ainda não tem certificado de editor; o Auto Edit Abrir instala só no seu usuário (não pede administrador) e não fica ligado em segundo plano.'],
  ['Clique em "Instalar"', 'Em segundos ele mostra "Pronto!" e abre o Auto Edit no navegador.'],
  ['No Pilot: Projeto editável > CapCut (ou Premiere)', 'Na 1ª vez o Chrome pergunta "Abrir Auto Edit Abrir?". Marque "Sempre permitir que darkoautoedit.com abra links deste tipo" e clique em Abrir. Pronto: o projeto entra no editor sozinho.'],
];
passos.forEach(([titulo, texto], i) => {
  pdf.setFillColor(124, 92, 246);
  pdf.circle(M + 13, y - 4, 13, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text(String(i + 1), M + 13, y, { align: 'center' });
  pdf.setTextColor(24, 24, 32);
  pdf.setFontSize(12.5);
  pdf.text(titulo, M + 38, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10.5);
  pdf.setTextColor(80, 80, 96);
  const linhas = pdf.splitTextToSize(texto, W - 2 * M - 38);
  pdf.text(linhas, M + 38, y + 17);
  y += 30 + linhas.length * 13.5;
});

y += 6;
pdf.setFillColor(244, 242, 255);
const caixa = [
  'O que ele faz: copia o projeto pra pasta de rascunhos do CapCut (ou pra C:\\AUTOEDIT, no Premiere), abre o editor e entra no projeto.',
  'O que ele NÃO faz: não fica ligado, não inicia com o Windows, não lê seus arquivos, não pede senha nem administrador.',
  'Desinstalar: Configurações do Windows > Apps > Auto Edit Abrir > Desinstalar.',
];
const linhasCaixa = caixa.flatMap((t) => pdf.splitTextToSize(t, W - 2 * M - 28));
const altura = linhasCaixa.length * 14 + caixa.length * 6 + 22;
pdf.roundedRect(M, y, W - 2 * M, altura, 10, 10, 'F');
pdf.setTextColor(60, 52, 110);
pdf.setFontSize(10);
let yy = y + 22;
for (const t of caixa) {
  const ls = pdf.splitTextToSize(t, W - 2 * M - 28);
  pdf.text(ls, M + 14, yy);
  yy += ls.length * 14 + 6;
}
const pdfBuf = Buffer.from(pdf.output('arraybuffer'));

log('pacote .zip…');
const JSZip = (await import('jszip')).default;
const zip = new JSZip();
const exeBuf = readFileSync(exe);
zip.file('Auto Edit Abrir/Instalar Auto Edit Abrir.exe', exeBuf);
zip.file('Auto Edit Abrir/COMO INSTALAR.pdf', pdfBuf);
const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
const saida = path.join(raiz, 'public', 'downloads');
mkdirSync(saida, { recursive: true });
writeFileSync(path.join(saida, 'auto-edit-abrir.zip'), zipBuf);
const sha = createHash('sha256').update(exeBuf).digest('hex');
writeFileSync(path.join(saida, 'auto-edit-abrir.json'), JSON.stringify({ versao, sha256Exe: sha, bytesZip: zipBuf.length }, null, 2) + '\n');
writeFileSync(path.join(dist, 'COMO INSTALAR.pdf'), pdfBuf);
log(`pronto: exe ${(statSync(exe).size / 1024).toFixed(0)} KB · zip ${(zipBuf.length / 1024).toFixed(0)} KB · sha256 ${sha.slice(0, 16)}…`);
