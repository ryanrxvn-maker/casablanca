/**
 * Gerador do relatório de ORÇAMENTO em PDF com DOWNLOAD AUTOMÁTICO.
 *
 * Clicou → baixa o arquivo. Sem diálogo de impressão. Renderiza um nó DOM
 * A4 (branco, só a logo — sem nome/domínio) fora da tela, captura com html2canvas
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
    --ink:#141019; --sub:#5f5a68; --faint:#a49eb0; --line:#eceaf2; --line2:#f4f2f9;
    --violet:#6d4ee8; --violet-d:#5234c0; --soft:#faf9fd; --paper:#ffffff;
    width:210mm; background:var(--paper); color:var(--ink);
    font-family:'Manrope',-apple-system,'Segoe UI',sans-serif;
    display:flex; flex-direction:column; padding-bottom:14mm;
    -webkit-font-smoothing:antialiased;
  }
  .ae-report .topbar{ height:6px; background:#6d4ee8;
    background-image:linear-gradient(90deg,#8b6cf6,#6d4ee8 48%,#b9c78a); }

  /* Cabeçalho */
  .ae-report .head{ display:flex; justify-content:space-between; align-items:flex-start; padding:15mm 16mm 0; }
  .ae-report .brand{ display:flex; align-items:center; }
  .ae-report .brand img{ width:62px; height:62px; object-fit:contain; }
  .ae-report .doc{ text-align:right; }
  .ae-report .kicker{ font-size:8.5px; font-weight:800; letter-spacing:.32em; text-transform:uppercase; color:var(--violet); }
  .ae-report .doc h1{ margin:3px 0 13px; font-family:'Fraunces',serif; font-weight:600; font-size:36px; letter-spacing:-.02em; color:var(--ink); line-height:1; }
  .ae-report .doc-meta{ display:flex; gap:20px; justify-content:flex-end; }
  .ae-report .doc-meta > div{ display:flex; flex-direction:column; align-items:flex-end; }
  .ae-report .doc-meta span{ font-size:7.5px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; color:var(--faint); }
  .ae-report .doc-meta b{ font-size:11px; font-weight:700; color:var(--ink); margin-top:3px; }

  .ae-report .rule{ height:1px; background:var(--line); margin:16px 16mm 0; }

  /* Cliente + resumo rápido */
  .ae-report .parties{ display:flex; justify-content:space-between; align-items:flex-end; gap:24px; padding:15px 16mm 0; }
  .ae-report .lbl{ font-size:7.5px; font-weight:800; letter-spacing:.2em; text-transform:uppercase; color:var(--faint); margin-bottom:6px; }
  .ae-report .party-name{ font-size:17px; font-weight:800; color:var(--ink); letter-spacing:-.01em; }
  .ae-report .quickstats{ display:flex; gap:9px; }
  .ae-report .qs{ min-width:76px; padding:9px 13px; border:1px solid var(--line); border-radius:12px; background:var(--soft); text-align:right; }
  .ae-report .qs span{ display:block; font-size:7px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:var(--faint); }
  .ae-report .qs b{ display:block; margin-top:4px; font-size:13.5px; font-weight:800; color:var(--ink); font-family:'JetBrains Mono',ui-monospace,monospace; }

  /* Itens */
  .ae-report .section-label{ font-size:8.5px; font-weight:800; letter-spacing:.22em; text-transform:uppercase; color:var(--faint); padding:24px 16mm 0; }
  .ae-report table{ width:calc(100% - 32mm); margin:10px 16mm 0; border-collapse:collapse; }
  .ae-report thead th{ font-size:7.5px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; color:var(--faint); text-align:left; padding:0 13px 10px; border-bottom:1.5px solid var(--ink); }
  .ae-report thead th.r{ text-align:right; }
  .ae-report tbody td{ padding:12px 13px; border-bottom:1px solid var(--line); vertical-align:middle; }
  .ae-report tbody tr:last-child td{ border-bottom:1.5px solid var(--ink); }
  .ae-report .it{ display:flex; align-items:center; gap:12px; }
  .ae-report .it-num{ width:27px; height:27px; flex:0 0 27px; border-radius:9px; background:#efeaff; color:var(--violet); font-family:'JetBrains Mono',monospace; font-weight:800; font-size:11px; display:flex; align-items:center; justify-content:center; }
  .ae-report .it-name{ font-weight:800; font-size:12.5px; color:var(--ink); }
  .ae-report .it-sub{ font-size:9px; color:var(--faint); margin-top:1px; }
  .ae-report .cell-dur{ text-align:right; color:var(--sub); font-size:12px; width:24%; }
  .ae-report .cell-val{ text-align:right; font-weight:800; font-size:12.5px; color:var(--ink); width:26%; }
  .ae-report .mono{ font-family:'JetBrains Mono',ui-monospace,monospace; }

  /* Resumo / total */
  .ae-report .summary-wrap{ display:flex; justify-content:flex-end; padding:16px 16mm 0; }
  .ae-report .summary{ width:50%; }
  .ae-report .sum-row{ display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--sub); padding:8px 2px; }
  .ae-report .sum-row + .sum-row{ border-top:1px solid var(--line2); }
  .ae-report .sum-row span:first-child{ font-weight:600; }
  .ae-report .sum-row .mono{ color:var(--ink); font-weight:700; }
  .ae-report .sum-neg{ color:#c0356f !important; }
  .ae-report .sum-tag{ display:inline-block; margin-left:6px; padding:1px 7px; border-radius:20px; background:#efeaff; color:var(--violet); font-size:8.5px; font-weight:800; vertical-align:middle; }
  .ae-report .total-box{ margin-top:12px; display:flex; justify-content:space-between; align-items:center; padding:17px 19px; border-radius:16px; color:#fff; background:#5234c0; background-image:linear-gradient(135deg,#7d5ef0,#5234c0); }
  .ae-report .total-box .tl{ font-size:9px; font-weight:800; letter-spacing:.24em; text-transform:uppercase; opacity:.9; }
  .ae-report .total-box .tl small{ display:block; font-size:8px; letter-spacing:.14em; opacity:.8; font-weight:700; margin-top:5px; }
  .ae-report .total-box .tv{ font-family:'Fraunces',serif; font-weight:700; font-size:33px; letter-spacing:-.02em; }

  /* PIX */
  .ae-report .pix{ display:flex; gap:16px; align-items:center; margin:18px 16mm 0; padding:15px 16px; border:1px solid var(--line); border-radius:16px; background:var(--soft); }
  .ae-report .pix-qr{ width:108px; height:108px; flex:0 0 108px; border:1px solid var(--line); border-radius:12px; background:#fff; padding:7px; }
  .ae-report .pix-qr img{ width:100%; height:100%; display:block; }
  .ae-report .pix-info{ flex:1; min-width:0; }
  .ae-report .pix-info .nt{ font-size:8px; font-weight:800; letter-spacing:.2em; text-transform:uppercase; color:var(--violet); margin-bottom:7px; }
  .ae-report .pix-row{ font-size:11px; color:var(--sub); margin-bottom:5px; }
  .ae-report .pix-row b{ color:var(--ink); font-weight:700; }
  .ae-report .pix-cc-lbl{ font-size:7.5px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; color:var(--faint); margin:8px 0 3px; }
  .ae-report .pix-cc{ font-size:7.5px; line-height:1.5; color:var(--sub); word-break:break-all; background:#fff; border:1px solid var(--line); border-radius:9px; padding:7px 9px; }

  /* Condições + rodapé */
  .ae-report .notes{ margin:20px 16mm 0; padding:15px 17px; border:1px solid var(--line); border-radius:14px; background:var(--soft); }
  .ae-report .notes .nt{ font-size:8px; font-weight:800; letter-spacing:.2em; text-transform:uppercase; color:var(--faint); margin-bottom:8px; }
  .ae-report .notes ul{ padding-left:15px; }
  .ae-report .notes li{ font-size:10px; color:var(--sub); line-height:1.85; }
  .ae-report .footer{ display:flex; justify-content:space-between; align-items:center; margin:20px 16mm 0; padding-top:13px; border-top:1px solid var(--line); }
  .ae-report .foot-logo{ width:26px; height:26px; object-fit:contain; opacity:.62; }
  .ae-report .fnum{ font-size:8.5px; color:var(--faint); font-family:'JetBrains Mono',ui-monospace,monospace; letter-spacing:.05em; }
`;

function reportMarkup(d: BudgetReportData, pixCardHtml: string): string {
  const rows = d.items
    .map(
      (it, i) => `
      <tr>
        <td>
          <div class="it">
            <div class="it-num">${String(i + 1).padStart(2, '0')}</div>
            <div>
              <div class="it-name">${esc(it.nome)}</div>
              <div class="it-sub">${esc(it.sub)}</div>
            </div>
          </div>
        </td>
        <td class="cell-dur mono">${esc(it.duracao)}</td>
        <td class="cell-val mono">${esc(it.valor)}</td>
      </tr>`,
    )
    .join('');

  const clienteName = d.cliente ? esc(d.cliente) : 'Cliente';

  const descontoRow =
    d.descontoPct > 0
      ? `<div class="sum-row"><span>Desconto <span class="sum-tag">${d.descontoPct}%</span></span><span class="mono sum-neg">${esc(d.descontoLabel)}</span></div>`
      : '';

  const adsTxt = `${d.qtdAds} AD${d.qtdAds === 1 ? '' : 's'}`;

  return `
    <div class="topbar"></div>
    <div class="head">
      <div class="brand">
        <img src="${esc(d.logoUrl)}" alt="" crossorigin="anonymous" />
      </div>
      <div class="doc">
        <div class="kicker">Orçamento</div>
        <h1>Proposta</h1>
        <div class="doc-meta">
          <div><span>Nº</span><b>${esc(d.docNumber)}</b></div>
          <div><span>Data</span><b>${esc(d.dateLabel)}</b></div>
        </div>
      </div>
    </div>
    <div class="rule"></div>
    <div class="parties">
      <div class="party">
        <div class="lbl">Preparado para</div>
        <div class="party-name">${clienteName}</div>
      </div>
      <div class="quickstats">
        <div class="qs"><span>ADs</span><b>${d.qtdAds}</b></div>
        <div class="qs"><span>Duração</span><b>${esc(d.duracaoTotalLabel)}</b></div>
        <div class="qs"><span>Valor / min</span><b>${esc(d.vpmLabel)}</b></div>
      </div>
    </div>
    <div class="section-label">Itens do orçamento · ${adsTxt}</div>
    <table>
      <thead><tr><th>Item</th><th class="r">Duração</th><th class="r">Valor</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="summary-wrap">
      <div class="summary">
        <div class="sum-row"><span>Subtotal</span><span class="mono">${esc(d.subtotalLabel)}</span></div>
        ${descontoRow}
        <div class="total-box">
          <div class="tl">Total a investir<small>${adsTxt} · ${esc(d.duracaoTotalLabel)}</small></div>
          <div class="tv">${esc(d.totalLabel)}</div>
        </div>
      </div>
    </div>
    ${pixCardHtml}
    <div class="notes">
      <div class="nt">Condições</div>
      <ul>
        <li>Precificação por minuto de vídeo entregue. Valores em reais (BRL).</li>
        <li>Prazo e forma de pagamento combinados na aprovação da proposta.</li>
      </ul>
    </div>
    <div class="footer">
      <img class="foot-logo" src="${esc(d.logoUrl)}" alt="" crossorigin="anonymous" />
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
    // Reserva 12mm no rodapé de cada página (margem + espaço pra numeração).
    const pageHeightCss = (pageH - 12) / mmPerPx;
    const nodeTop = rect.top;
    const children = Array.from(page.children);

    // Bordas onde é SEGURO cortar (fim de cada bloco atômico, em ordem).
    // Nunca corta no meio de uma linha de AD, do total ou do card PIX.
    const bottomOf = (el: Element) => el.getBoundingClientRect().bottom - nodeTop;
    const breaks: number[] = [];
    children.forEach((child) => {
      if (child.tagName === 'TABLE') {
        const thead = child.querySelector('thead');
        if (thead) breaks.push(bottomOf(thead));
        child.querySelectorAll('tbody tr').forEach((tr) => breaks.push(bottomOf(tr)));
      } else {
        breaks.push(bottomOf(child));
      }
    });

    // Fim REAL do conteúdo = base do último bloco (rodapé) + respiro pequeno.
    // Ignora o padding inferior do CSS pra não vazar uma página em branco.
    const lastEl = children[children.length - 1];
    const docEnd = lastEl
      ? Math.min(rect.height, bottomOf(lastEl) + 36)
      : rect.height;
    breaks.push(docEnd);

    const boundaries = Array.from(new Set(breaks.map((b) => Math.round(b))))
      .filter((b) => b > 0 && b <= Math.round(docEnd))
      .sort((a, b) => a - b);

    // Monta as páginas: cada uma vai até a última borda que ainda cabe.
    const pages: Array<[number, number]> = [];
    let start = 0;
    const EPS = 1;
    while (start < docEnd - EPS) {
      const limit = start + pageHeightCss;
      let cut = -1;
      for (const b of boundaries) {
        if (b > start + EPS && b <= limit + EPS) cut = b;
      }
      // Bloco maior que uma página inteira → corte rígido (fallback raro).
      if (cut < 0) cut = Math.min(limit, docEnd);
      pages.push([start, cut]);
      start = cut;
    }
    if (pages.length === 0) pages.push([0, docEnd]);

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

    // Numeração só quando o orçamento ocupa mais de uma página.
    const nPages = pdf.getNumberOfPages();
    if (nPages > 1) {
      for (let p = 1; p <= nPages; p++) {
        pdf.setPage(p);
        pdf.setFontSize(8);
        pdf.setTextColor(154, 154, 168);
        pdf.text(`Página ${p} de ${nPages}`, pageW / 2, pageH - 7, {
          align: 'center',
        });
      }
    }

    const nome = d.cliente ? slug(d.cliente) : d.docNumber;
    pdf.save(`Orcamento-${nome}.pdf`);
  } finally {
    document.body.removeChild(wrap);
  }
}
