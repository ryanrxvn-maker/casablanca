/**
 * PDF "COMO ABRIR" do projeto editável (08.10) — vai DENTRO do .zip.
 *
 * Silas: *"baixa a pasta certinha pra rodar o projeto, com as instruções
 * dentro de como rodar o projeto muito fácil, pode ser um PDF enfiado dentro
 * da pasta zip"*. Desenhado em vetor com o jsPDF (sem html2canvas, sem DOM):
 * roda igual no navegador e no teste. Texto só em WinAnsi (o que as fontes
 * padrão do PDF desenham): nada de emoji, seta unicode ou travessão.
 */

export type AlvoDoPdf = 'capcut' | 'premiere';

export type DadosDoPdf = {
  alvo: AlvoDoPdf;
  /** nome do AD (vai no título) */
  nomeAd: string;
  /** as pastas de projeto que vieram no .zip (uma por vídeo montado) */
  pastas: string[];
  /** nome do .zip baixado */
  zip: string;
  /** as camadas que o projeto traz, em linguagem de editor */
  camadas: string[];
  /** observações do export (cantos retos, trilha ausente…) */
  avisos: string[];
  /** onde o Premiere procura a mídia sozinho (só Premiere) */
  pastaPremiere?: string;
};

/** Tira o que as fontes padrão do PDF não desenham (fica legível, nunca "□"). */
export function textoSeguro(s: string): string {
  return s
    .replace(/[\u2014\u2013]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[\u2192\u279c\u27a1]/g, '>')
    .replace(/[^\x20-\x7e\u00a0-\u00ff\n]/g, '');
}

type Cor = [number, number, number];
const TINTA: Cor = [24, 24, 32];
const CINZA: Cor = [102, 104, 116];
const CLARO: Cor = [236, 237, 241];
const VERDE: Cor = [132, 204, 22];

export async function pdfDeComoAbrir(d: DadosDoPdf): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const W = 210;
  const M = 18;
  let y = 0;
  const cor = (c: Cor) => pdf.setTextColor(c[0], c[1], c[2]);
  const fundo = (c: Cor) => pdf.setFillColor(c[0], c[1], c[2]);
  const linha = (c: Cor) => pdf.setDrawColor(c[0], c[1], c[2]);
  const texto = (s: string, x: number, yy: number, o: { tam?: number; peso?: 'normal' | 'bold'; c?: Cor; max?: number } = {}) => {
    pdf.setFont('helvetica', o.peso || 'normal');
    pdf.setFontSize(o.tam || 10.5);
    cor(o.c || TINTA);
    const linhas = pdf.splitTextToSize(textoSeguro(s), o.max || W - x - M) as string[];
    pdf.text(linhas, x, yy);
    return linhas.length * (o.tam || 10.5) * 0.42;
  };
  const novaPaginaSePreciso = (altura: number) => {
    if (y + altura > 297 - 16) {
      pdf.addPage();
      y = 20;
    }
  };

  // ── cabeçalho escuro com a marca do editor ──
  fundo([12, 13, 18]);
  pdf.rect(0, 0, W, 54, 'F');
  if (d.alvo === 'capcut') {
    fundo([10, 10, 10]);
    pdf.roundedRect(M, 14, 26, 26, 6, 6, 'F');
    linha([255, 255, 255]);
    pdf.setLineWidth(2.3);
    pdf.setLineCap('round');
    pdf.setLineJoin('round');
    pdf.lines([[10.5, -2.8]], M + 6, 23.2);
    pdf.lines([[0, 7.2], [11.2, 0]], M + 6, 23.2);
    pdf.line(M + 12, 27.6, M + 18.2, 31.6);
  } else {
    fundo([0, 0, 91]);
    pdf.roundedRect(M, 14, 26, 26, 6, 6, 'F');
    linha([153, 153, 255]);
    pdf.setLineWidth(0.9);
    pdf.roundedRect(M + 1.3, 15.3, 23.4, 23.4, 5, 5, 'S');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(19);
    pdf.setTextColor(153, 153, 255);
    pdf.text('Pr', M + 13, 31.4, { align: 'center' });
  }
  texto(d.alvo === 'capcut' ? 'Como abrir no CapCut' : 'Como abrir no Premiere Pro', M + 34, 24.5, { tam: 20, peso: 'bold', c: [255, 255, 255] });
  texto(`Projeto editável de ${d.nomeAd}, gerado pelo ClickUp Pilot do Auto Edit`, M + 34, 32, { tam: 10, c: [190, 192, 204], max: W - M - 34 - M });
  y = 66;

  // ── passos ──
  const passos: Array<{ titulo: string; texto: string; caminho?: string }> = d.alvo === 'capcut'
    ? [
      { titulo: 'Extraia o arquivo baixado', texto: `Clique com o botão direito em "${d.zip}" e escolha "Extrair tudo". Dentro vem ${d.pastas.length === 1 ? 'a pasta do projeto' : `uma pasta por vídeo (${d.pastas.length})`} e este PDF.` },
      { titulo: 'Abra a pasta de rascunhos do CapCut', texto: 'No CapCut, clique na engrenagem (Configurações) e depois em "Projetos". Em "Local do rascunho" está a pasta onde o CapCut guarda os projetos; clique no ícone de pasta ao lado pra abrir ela no Windows. O padrão é:', caminho: 'C:\\Users\\SEU USUÁRIO\\AppData\\Local\\CapCut\\User Data\\Projects\\com.lveditor.draft' },
      { titulo: 'Arraste a pasta do projeto pra lá', texto: `Arraste ${d.pastas.length === 1 ? `a pasta "${d.pastas[0]}"` : 'as pastas dos vídeos'} pra dentro da pasta de rascunhos. Não renomeie nada: a mídia já vem dentro da pasta.` },
      { titulo: 'Feche e abra o CapCut', texto: 'O projeto aparece na lista com o mesmo nome da pasta. Abra e edite como quiser: cada coisa está na sua camada.' },
    ]
    : [
      { titulo: 'Extraia o arquivo baixado', texto: `Clique com o botão direito em "${d.zip}" e escolha "Extrair tudo".`, caminho: d.pastaPremiere ? `Dica: extraia em  ${d.pastaPremiere.replace(/\//g, '\\')}  e o Premiere acha toda a mídia sozinho.` : undefined },
      { titulo: 'Importe o projeto no Premiere', texto: 'No Premiere Pro: Arquivo > Importar, e escolha o arquivo "PREMIERE - ....xml" da pasta. Ele vira uma sequência pronta no painel Projeto.' },
      { titulo: 'Se pedir a mídia, aponte UM arquivo', texto: 'Se aparecer a janela "Vincular mídia", clique em "Localizar", entre na pasta MIDIA e escolha o avatar.mp4. Deixe marcado "Revincular outros automaticamente": o resto é encontrado sozinho.' },
      { titulo: 'Abra a sequência e edite', texto: 'Dê dois cliques na sequência: avatar, b-rolls, transições, legenda, SFX e trilha estão cada um na sua faixa.' },
    ];
  passos.forEach((p, i) => {
    const corpoAltura = 6 + pdf.splitTextToSize(textoSeguro(p.texto), W - M - 30 - M).length * 4.6 + (p.caminho ? 12 : 0);
    novaPaginaSePreciso(corpoAltura + 8);
    // número no próprio círculo
    fundo(VERDE);
    pdf.circle(M + 6, y + 1, 5.2, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    cor([10, 18, 6]);
    pdf.text(String(i + 1), M + 6, y + 2.9, { align: 'center' });
    texto(p.titulo, M + 16, y + 2.6, { tam: 12.5, peso: 'bold' });
    let yy = y + 8.4;
    yy += texto(p.texto, M + 16, yy, { tam: 10.3, c: CINZA, max: W - M - 16 - M });
    if (p.caminho) {
      fundo(CLARO);
      const alt = 8.5;
      pdf.roundedRect(M + 16, yy - 1.5, W - M - 16 - M, alt, 2, 2, 'F');
      pdf.setFont('courier', 'bold');
      pdf.setFontSize(8.6);
      cor(TINTA);
      pdf.text(textoSeguro(p.caminho), M + 19, yy + 4.1, { maxWidth: W - M - 22 - M });
      yy += alt + 1;
    }
    y = yy + 5;
  });

  // ── o que vem no projeto ──
  novaPaginaSePreciso(16 + d.camadas.length * 6);
  linha(CLARO);
  pdf.setLineWidth(0.4);
  pdf.line(M, y, W - M, y);
  y += 9;
  texto('O que vem no projeto', M, y, { tam: 12.5, peso: 'bold' });
  y += 6.5;
  for (const c of d.camadas) {
    novaPaginaSePreciso(7);
    fundo(VERDE);
    pdf.circle(M + 1.6, y - 1.2, 1.1, 'F');
    y += texto(c, M + 6, y, { tam: 10, c: CINZA, max: W - M - 6 - M }) + 1.6;
  }

  if (d.avisos.length) {
    y += 3;
    novaPaginaSePreciso(14);
    texto('Observações', M, y, { tam: 12.5, peso: 'bold' });
    y += 6.5;
    for (const a of d.avisos) {
      novaPaginaSePreciso(8);
      fundo([251, 191, 36]);
      pdf.circle(M + 1.6, y - 1.2, 1.1, 'F');
      y += texto(a, M + 6, y, { tam: 9.6, c: CINZA, max: W - M - 6 - M }) + 1.6;
    }
  }

  // rodapé
  const total = pdf.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    texto('Auto Edit  ·  ClickUp Pilot  ·  projeto editável', M, 289, { tam: 8, c: [160, 162, 172] });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text(`${i}/${total}`, W - M, 289, { align: 'right' });
  }
  return pdf.output('blob');
}
