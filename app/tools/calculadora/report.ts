/**
 * Gerador do relatório de ORÇAMENTO em PDF com DOWNLOAD AUTOMÁTICO.
 *
 * Clicou → baixa o arquivo. Sem diálogo de impressão. Renderiza um nó DOM
 * A4 (branco, identidade Auto Edit) fora da tela, captura com html2canvas
 * e empacota num PDF via jsPDF — tudo no client, sem backend.
 *
 * jspdf/html2canvas são importados dinamicamente só quando o botão é
 * clicado, então não pesam no bundle das outras telas.
 */

export type BudgetReportItem = {
  nome: string; // "AD 1"
  sub: string; // "Vídeo editado"
  duracao: string; // "06:19"
  valor: string; // "R$ 284,25"
};

export type BudgetReportPix = {
  key: string; // chave PIX
  name: string; // nome do recebedor (opcional)
  city: string; // cidade (opcional)
  amount: number; // valor a embutir no QR (0 = sem valor)
};

export type BudgetReportData = {
  docNumber: string;
  dateLabel: string;
  validadeLabel: string;
  cliente: string;
  vpmLabel: string;
  duracaoTotalLabel: string;
  qtdAds: number;
  items: BudgetReportItem[];
  subtotalLabel: string;
  descontoPct: number;
  descontoLabel: string;
  totalLabel: string;
  logoUrl: string;
  /** Quando presente e com chave → renderiza bloco PIX + QR no relatório. */
  pix?: BudgetReportPix;
};

import { buildPixPayload } from './pix';

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const REPORT_CSS = `
  .ae-report, .ae-report *{ box-sizing:border-box; margin:0; padding:0; }
  .ae-report{
    --ink:#16161d; --sub:#5f5f6d; --faint:#9a9aa8; --line:#ececf1;
    --violet:#6d4ee8; --paper:#ffffff;
    width:210mm; background:var(--paper); color:var(--ink);
    font-family:'Manrope',-apple-system,'Segoe UI',sans-serif;
    display:flex; flex-direction:column; padding-bottom:16mm;
  }
  .ae-report .topbar{ height:7px; background:#6d4ee8;
    background-image:linear-gradient(90deg,#8b6cf6,#6d4ee8 45%,#bcc98c); }
  .ae-report .head{ display:flex; justify-content:space-between; align-items:flex-start; padding:24mm 18mm 0; }
  .ae-report .brand{ display:flex; align-items:center; gap:13px; }
  .ae-report .brand img{ width:50px; height:50px; object-fit:contain; }
  .ae-report .wm{ font-family:'Fraunces',serif; font-weight:700; font-size:25px; letter-spacing:-.01em; line-height:1; color:var(--ink); }
  .ae-report .tag{ margin-top:5px; font-size:8.5px; font-weight:700; letter-spacing:.22em; text-transform:uppercase; color:var(--faint); }
  .ae-report .doc{ text-align:right; }
  .ae-report .kicker{ font-size:9px; font-weight:800; letter-spacing:.28em; text-transform:uppercase; color:var(--violet); }
  .ae-report .doc h1{ margin:3px 0 10px; font-family:'Fraunces',serif; font-weight:600; font-size:30px; letter-spacing:-.01em; color:var(--ink); }
  .ae-report .meta{ font-size:10.5px; color:var(--sub); line-height:1.75; }
  .ae-report .meta b{ color:var(--ink); font-weight:700; }
  .ae-report .rule{ height:1px; background:var(--line); margin:18px 18mm 0; }
  .ae-report .parties{ display:flex; justify-content:space-between; gap:24px; padding:16px 18mm 0; }
  .ae-report .lbl{ font-size:8.5px; font-weight:800; letter-spacing:.2em; text-transform:uppercase; color:var(--faint); margin-bottom:5px; }
  .ae-report .party-name{ font-size:14px; font-weight:700; color:var(--ink); }
  .ae-report .from{ text-align:right; }
  .ae-report .from-name{ font-size:12px; font-weight:700; color:var(--ink); }
  .ae-report .from-line{ font-size:10px; color:var(--sub); margin-top:3px; }
  .ae-report .section-label{ font-size:9px; font-weight:800; letter-spacing:.2em; text-transform:uppercase; color:var(--faint); padding:26px 18mm 0; }
  .ae-report table{ width:calc(100% - 36mm); margin:8px 18mm 0; border-collapse:collapse; }
  .ae-report thead th{ font-size:8.5px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; color:var(--faint); text-align:left; padding:9px 12px; border-bottom:1.5px solid var(--ink); }
  .ae-report thead th.r{ text-align:right; }
  .ae-report tbody td{ padding:11px 12px; border-bottom:1px solid var(--line); vertical-align:middle; }
  .ae-report tbody tr.alt td{ background:#fafafc; }
  .ae-report .item-badge{ display:block; font-weight:800; font-size:12.5px; color:var(--ink); }
  .ae-report .item-sub{ font-size:9.5px; color:var(--faint); margin-top:2px; }
  .ae-report .cell-dur{ text-align:right; color:var(--sub); font-size:12px; width:26%; }
  .ae-report .cell-val{ text-align:right; font-weight:700; font-size:12.5px; color:var(--ink); width:26%; }
  .ae-report .mono{ font-family:'JetBrains Mono',ui-monospace,monospace; }
  .ae-report .summary-wrap{ display:flex; justify-content:flex-end; padding:18px 18mm 0; }
  .ae-report .summary{ width:54%; }
  .ae-report .sum-row{ display:flex; justify-content:space-between; align-items:center; font-size:11.5px; color:var(--sub); padding:7px 2px; }
  .ae-report .sum-row span:first-child{ font-weight:600; }
  .ae-report .sum-row .mono{ color:var(--ink); font-weight:600; }
  .ae-report .sum-neg{ color:#b4346a !important; }
  .ae-report .sum-tag{ display:inline-block; margin-left:6px; padding:1px 7px; border-radius:20px; background:#efeaff; color:var(--violet); font-size:9px; font-weight:800; }
  .ae-report .total-box{ margin-top:10px; display:flex; justify-content:space-between; align-items:center; padding:16px 18px; border-radius:14px; color:#fff; background:#5234c0; background-image:linear-gradient(135deg,#6d4ee8,#5234c0); }
  .ae-report .total-box .tl{ font-size:9.5px; font-weight:800; letter-spacing:.22em; text-transform:uppercase; opacity:.85; }
  .ae-report .total-box .tl small{ display:block; font-size:8.5px; letter-spacing:.16em; opacity:.78; font-weight:700; margin-top:4px; }
  .ae-report .total-box .tv{ font-family:'Fraunces',serif; font-weight:700; font-size:30px; letter-spacing:-.01em; }
  .ae-report .pix{ display:flex; gap:16px; align-items:center; margin:22px 18mm 0; padding:14px 16px; border:1px solid var(--line); border-radius:14px; background:#fbfbfd; }
  .ae-report .pix-qr{ width:104px; height:104px; flex:0 0 104px; border:1px solid var(--line); border-radius:10px; background:#fff; padding:6px; }
  .ae-report .pix-qr img{ width:100%; height:100%; display:block; }
  .ae-report .pix-info{ flex:1; min-width:0; }
  .ae-report .pix-info .nt{ font-size:8.5px; font-weight:800; letter-spacing:.2em; text-transform:uppercase; color:var(--violet); margin-bottom:6px; }
  .ae-report .pix-row{ font-size:11px; color:var(--sub); margin-bottom:5px; }
  .ae-report .pix-row b{ color:var(--ink); font-weight:700; }
  .ae-report .pix-cc-lbl{ font-size:8px; font-weight:800; letter-spacing:.18em; text-transform:uppercase; color:var(--faint); margin:7px 0 3px; }
  .ae-report .pix-cc{ font-size:7.5px; line-height:1.5; color:var(--sub); word-break:break-all; background:#fff; border:1px solid var(--line); border-radius:8px; padding:6px 8px; }
  .ae-report .spacer{ flex:1; min-height:18px; }
  .ae-report .notes{ margin:30px 18mm 0; padding:14px 16px; border:1px solid var(--line); border-radius:12px; background:#fbfbfd; }
  .ae-report .notes .nt{ font-size:8.5px; font-weight:800; letter-spacing:.2em; text-transform:uppercase; color:var(--faint); margin-bottom:7px; }
  .ae-report .notes ul{ padding-left:16px; }
  .ae-report .notes li{ font-size:10px; color:var(--sub); line-height:1.8; }
  .ae-report .footer{ display:flex; justify-content:space-between; align-items:center; margin:18px 18mm 0; padding-top:12px; border-top:1px solid var(--line); }
  .ae-report .footer .fb{ font-size:9.5px; color:var(--sub); }
  .ae-report .footer .fb b{ color:var(--ink); font-weight:800; }
  .ae-report .footer .fnum{ font-size:9px; color:var(--faint); }
`;

function reportMarkup(d: BudgetReportData, pixCardHtml: string): string {
  const rows = d.items
    .map(
      (it, i) => `
      <tr class="${i % 2 ? 'alt' : ''}">
        <td>
          <span class="item-badge">${esc(it.nome)}</span>
          <span class="item-sub">${esc(it.sub)}</span>
        </td>
        <td class="cell-dur mono">${esc(it.duracao)}</td>
        <td class="cell-val mono">${esc(it.valor)}</td>
      </tr>`,
    )
    .join('');

  const clienteBlock = d.cliente
    ? `<div><div class="lbl">Preparado para</div><div class="party-name">${esc(d.cliente)}</div></div>`
    : '<div></div>';

  const descontoRow =
    d.descontoPct > 0
      ? `<div class="sum-row"><span>Desconto <span class="sum-tag">${d.descontoPct}%</span></span><span class="mono sum-neg">${esc(d.descontoLabel)}</span></div>`
      : '';

  const adsTxt = `${d.qtdAds} AD${d.qtdAds === 1 ? '' : 's'}`;

  return `
    <div class="topbar"></div>
    <div class="head">
      <div class="brand">
        <img src="${esc(d.logoUrl)}" alt="Auto Edit" crossorigin="anonymous" />
        <div>
          <div class="wm">Auto Edit</div>
          <div class="tag">Automação de edição de vídeo</div>
        </div>
      </div>
      <div class="doc">
        <div class="kicker">Orçamento</div>
        <h1>Proposta</h1>
        <div class="meta">
          Nº <b>${esc(d.docNumber)}</b><br/>
          Data <b>${esc(d.dateLabel)}</b><br/>
          Validade <b>${esc(d.validadeLabel)}</b>
        </div>
      </div>
    </div>
    <div class="rule"></div>
    <div class="parties">
      ${clienteBlock}
      <div class="from">
        <div class="lbl">Emitido por</div>
        <div class="from-name">Auto Edit</div>
        <div class="from-line">Automação de edição de vídeo</div>
        <div class="from-line">darkoautoedit.com</div>
      </div>
    </div>
    <div class="section-label">Itens do orçamento · ${adsTxt}</div>
    <table>
      <thead><tr><th>Item</th><th class="r">Duração</th><th class="r">Valor</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="summary-wrap">
      <div class="summary">
        <div class="sum-row"><span>Duração total</span><span class="mono">${esc(d.duracaoTotalLabel)}</span></div>
        <div class="sum-row"><span>Valor por minuto</span><span class="mono">${esc(d.vpmLabel)}</span></div>
        <div class="sum-row"><span>Subtotal</span><span class="mono">${esc(d.subtotalLabel)}</span></div>
        ${descontoRow}
        <div class="total-box">
          <div class="tl">Total<small>${adsTxt} · ${esc(d.duracaoTotalLabel)}</small></div>
          <div class="tv">${esc(d.totalLabel)}</div>
        </div>
      </div>
    </div>
    ${pixCardHtml}
    <div class="notes">
      <div class="nt">Condições</div>
      <ul>
        <li>Precificação por minuto de vídeo entregue. Valores em reais (BRL).</li>
        <li>Orçamento válido por ${esc(d.validadeLabel)} a partir da data de emissão.</li>
        <li>Prazo e forma de pagamento combinados na aprovação da proposta.</li>
      </ul>
    </div>
    <div class="footer">
      <div class="fb"><b>Auto Edit</b> · Automação de edição de vídeo · darkoautoedit.com</div>
      <div class="fnum">${esc(d.docNumber)}</div>
    </div>
  `;
}

/** Garante que as fontes premium do relatório estão no <head>. */
function ensureFonts(): void {
  if (document.getElementById('ae-report-fonts')) return;
  const link = document.createElement('link');
  link.id = 'ae-report-fonts';
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=JetBrains+Mono:wght@500;600;700&display=swap';
  document.head.appendChild(link);
}

function imgReady(img: HTMLImageElement): Promise<void> {
  if (img.complete && img.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => resolve(), { once: true });
  });
}

function slug(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Monta o relatório, captura e baixa o PDF automaticamente.
 * Lança erro se algo falhar (a page trata pra avisar o usuário).
 */
export async function downloadBudgetReport(d: BudgetReportData): Promise<void> {
  ensureFonts();

  // PIX (opcional): monta BR Code + QR code, tudo no client.
  let pixCardHtml = '';
  if (d.pix && d.pix.key.trim()) {
    const brcode = buildPixPayload({
      key: d.pix.key,
      name: d.pix.name,
      city: d.pix.city,
      amount: d.pix.amount,
    });
    if (brcode) {
      const QRCode = (await import('qrcode')).default;
      const qrDataUrl = await QRCode.toDataURL(brcode, {
        margin: 0,
        width: 240,
        errorCorrectionLevel: 'M',
        color: { dark: '#16161dff', light: '#ffffffff' },
      });
      pixCardHtml = `
        <div class="pix">
          <div class="pix-qr"><img src="${esc(qrDataUrl)}" alt="QR Code PIX" /></div>
          <div class="pix-info">
            <div class="nt">Pagamento via PIX</div>
            <div class="pix-row">Chave: <b>${esc(d.pix.key.trim())}</b></div>
            <div class="pix-row">Aponte a câmera do app do banco pro QR Code ou use o copia e cola abaixo.</div>
            <div class="pix-cc-lbl">PIX Copia e Cola</div>
            <div class="pix-cc mono">${esc(brcode)}</div>
          </div>
        </div>`;
    }
  }

  const wrap = document.createElement('div');
  wrap.style.cssText =
    'position:fixed; left:-10000px; top:0; width:210mm; background:#fff; z-index:-1;';
  const style = document.createElement('style');
  style.textContent = REPORT_CSS;
  const page = document.createElement('div');
  page.className = 'ae-report';
  page.innerHTML = reportMarkup(d, pixCardHtml);
  wrap.appendChild(style);
  wrap.appendChild(page);
  document.body.appendChild(wrap);

  try {
    const imgs = Array.from(page.querySelectorAll('img'));
    await Promise.all([
      document.fonts ? document.fonts.ready : Promise.resolve(),
      ...imgs.map(imgReady),
    ]);
    // pequeno respiro pro layout assentar com as fontes carregadas
    await new Promise((r) => setTimeout(r, 80));

    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);

    const canvas = await html2canvas(page, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = 210;
    const pageH = 297;
    const SCALE = 2; // == html2canvas scale

    // Geometria em CSS px (o nó tem 210mm de largura).
    const rect = page.getBoundingClientRect();
    const cssWidth = rect.width;
    const mmPerPx = pageW / cssWidth;
    const pageHeightCss = pageH / mmPerPx; // altura de 1 A4 em px
    const totalCss = rect.height;
    const nodeTop = rect.top;

    // Bordas onde é SEGURO cortar (fim de cada bloco atômico, em ordem).
    // Nunca corta no meio de uma linha de AD, do total ou do card PIX.
    const bottomOf = (el: Element) => el.getBoundingClientRect().bottom - nodeTop;
    const breaks: number[] = [];
    Array.from(page.children).forEach((child) => {
      if (child.tagName === 'TABLE') {
        const thead = child.querySelector('thead');
        if (thead) breaks.push(bottomOf(thead));
        child.querySelectorAll('tbody tr').forEach((tr) => breaks.push(bottomOf(tr)));
      } else {
        breaks.push(bottomOf(child));
      }
    });
    breaks.push(totalCss); // fim real do documento (inclui o padding inferior)
    const boundaries = Array.from(new Set(breaks.map((b) => Math.round(b))))
      .filter((b) => b > 0)
      .sort((a, b) => a - b);

    // Monta as páginas: cada uma vai até a última borda que ainda cabe.
    const pages: Array<[number, number]> = [];
    let start = 0;
    const EPS = 1;
    while (start < totalCss - EPS) {
      const limit = start + pageHeightCss;
      let cut = -1;
      for (const b of boundaries) {
        if (b > start + EPS && b <= limit + EPS) cut = b;
      }
      // Bloco maior que uma página inteira → corte rígido (fallback raro).
      if (cut < 0) cut = Math.min(limit, totalCss);
      pages.push([start, cut]);
      start = cut;
    }
    if (pages.length === 0) pages.push([0, totalCss]);

    // Recorta cada página numa canvas própria → imagem nítida, sem sobra.
    for (let i = 0; i < pages.length; i++) {
      const [a, b] = pages[i];
      const srcY = Math.round(a * SCALE);
      const srcH = Math.min(Math.round((b - a) * SCALE), canvas.height - srcY);
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = srcH;
      const ctx = slice.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
      }
      const sliceMm = (srcH / SCALE) * mmPerPx;
      if (i > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/png'), 'PNG', 0, 0, pageW, sliceMm, undefined, 'FAST');
    }

    const nome = d.cliente ? slug(d.cliente) : d.docNumber;
    pdf.save(`Orcamento-Auto-Edit-${nome}.pdf`);
  } finally {
    document.body.removeChild(wrap);
  }
}
