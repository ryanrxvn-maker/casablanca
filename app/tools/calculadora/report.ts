/**
 * Gerador do relatório de ORÇAMENTO em PDF (via janela de impressão do
 * navegador → "Salvar como PDF"). Sem dependência externa: monta um
 * documento HTML A4 autossuficiente, branco, com a identidade Auto Edit,
 * e dispara o print quando fontes + logo terminam de carregar.
 *
 * Templating PURO — toda a aritmética/formatação acontece na page e chega
 * aqui já como string pronta (BudgetReportData). Assim não há lógica de
 * número duplicada e o layout fica isolado.
 */

export type BudgetReportItem = {
  nome: string; // "AD 1"
  sub: string; // descrição curta ("Vídeo editado")
  duracao: string; // "06:19"
  valor: string; // "R$ 284,25"
};

export type BudgetReportData = {
  docNumber: string; // "ORC-20260622-2042"
  dateLabel: string; // "22 de junho de 2026"
  validadeLabel: string; // "7 dias"
  cliente: string; // pode ser ''
  vpmLabel: string; // "R$ 45,00"
  duracaoTotalLabel: string; // "09:54"
  qtdAds: number;
  items: BudgetReportItem[];
  subtotalLabel: string; // "R$ ..."
  descontoPct: number;
  descontoLabel: string; // "-R$ ..."
  totalLabel: string; // "R$ ..."
  logoUrl: string; // URL absoluta do PNG do coelho
};

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtml(d: BudgetReportData): string {
  const rows = d.items
    .map(
      (it, i) => `
      <tr class="${i % 2 ? 'alt' : ''}">
        <td class="cell-item">
          <span class="item-badge">${esc(it.nome)}</span>
          <span class="item-sub">${esc(it.sub)}</span>
        </td>
        <td class="cell-dur mono">${esc(it.duracao)}</td>
        <td class="cell-val mono">${esc(it.valor)}</td>
      </tr>`,
    )
    .join('');

  const clienteBlock = d.cliente
    ? `<div class="party">
         <div class="party-label">Preparado para</div>
         <div class="party-name">${esc(d.cliente)}</div>
       </div>`
    : '';

  const descontoRow =
    d.descontoPct > 0
      ? `<div class="sum-row">
           <span>Desconto <span class="sum-tag">${d.descontoPct}%</span></span>
           <span class="mono sum-neg">${esc(d.descontoLabel)}</span>
         </div>`
      : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Orçamento ${esc(d.docNumber)} — Auto Edit</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --ink:#16161d; --sub:#5f5f6d; --faint:#9a9aa8; --line:#ececf1;
    --violet:#6d4ee8; --violet-deep:#4a32b0; --olive:#54631a; --paper:#ffffff;
  }
  *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  html,body{ margin:0; padding:0; background:#d9d9de; }
  body{ font-family:'Manrope',-apple-system,Segoe UI,sans-serif; color:var(--ink); }
  .page{
    width:210mm; min-height:297mm; margin:14px auto; background:var(--paper);
    padding:0 0 26mm; position:relative; box-shadow:0 12px 40px rgba(0,0,0,.18);
    display:flex; flex-direction:column;
  }
  .topbar{ height:7px; background:linear-gradient(90deg,#8b6cf6,#6d4ee8 45%,#bcc98c); }

  /* ── Cabeçalho ── */
  .head{ display:flex; justify-content:space-between; align-items:flex-start;
    padding:24mm 18mm 0; }
  .brand{ display:flex; align-items:center; gap:13px; }
  .brand img{ width:50px; height:50px; object-fit:contain;
    filter:drop-shadow(0 3px 8px rgba(109,78,232,.28)); }
  .brand .wm{ font-family:'Fraunces',serif; font-weight:700; font-size:25px;
    letter-spacing:-.01em; line-height:1; color:var(--ink); }
  .brand .tag{ margin-top:4px; font-size:8.5px; font-weight:700; letter-spacing:.22em;
    text-transform:uppercase; color:var(--faint); }
  .doc{ text-align:right; }
  .doc .kicker{ font-size:9px; font-weight:800; letter-spacing:.28em;
    text-transform:uppercase; color:var(--violet); }
  .doc h1{ margin:2px 0 10px; font-family:'Fraunces',serif; font-weight:600;
    font-size:30px; letter-spacing:-.01em; color:var(--ink); }
  .doc .meta{ font-size:10.5px; color:var(--sub); line-height:1.7; }
  .doc .meta b{ color:var(--ink); font-weight:700; }

  .rule{ height:1px; background:var(--line); margin:18px 18mm 0; }

  /* ── Partes ── */
  .parties{ display:flex; justify-content:space-between; gap:24px;
    padding:16px 18mm 0; }
  .party-label,.from-label{ font-size:8.5px; font-weight:800; letter-spacing:.2em;
    text-transform:uppercase; color:var(--faint); margin-bottom:4px; }
  .party-name{ font-size:14px; font-weight:700; color:var(--ink); }
  .from-name{ font-size:12px; font-weight:700; color:var(--ink); }
  .from-line{ font-size:10px; color:var(--sub); margin-top:2px; }
  .from{ text-align:right; }

  /* ── Itens ── */
  .section-label{ font-size:9px; font-weight:800; letter-spacing:.2em;
    text-transform:uppercase; color:var(--faint); padding:26px 18mm 0; }
  table{ width:calc(100% - 36mm); margin:8px 18mm 0; border-collapse:collapse; }
  thead th{ font-size:8.5px; font-weight:800; letter-spacing:.16em;
    text-transform:uppercase; color:var(--faint); text-align:left;
    padding:9px 12px; border-bottom:1.5px solid var(--ink); }
  thead th.r{ text-align:right; }
  tbody td{ padding:11px 12px; border-bottom:1px solid var(--line); vertical-align:middle; }
  tbody tr.alt td{ background:#fafafc; }
  .cell-item{ display:flex; flex-direction:column; gap:2px; }
  .item-badge{ display:inline-block; width:fit-content; font-weight:800; font-size:12.5px;
    color:var(--ink); }
  .item-sub{ font-size:9.5px; color:var(--faint); }
  .cell-dur{ text-align:right; color:var(--sub); font-size:12px; width:26%; }
  .cell-val{ text-align:right; font-weight:700; font-size:12.5px; color:var(--ink); width:26%; }
  .mono{ font-family:'JetBrains Mono',ui-monospace,monospace; }

  /* ── Resumo ── */
  .summary-wrap{ display:flex; justify-content:flex-end; padding:18px 18mm 0; }
  .summary{ width:54%; }
  .sum-row{ display:flex; justify-content:space-between; align-items:center;
    font-size:11.5px; color:var(--sub); padding:7px 2px; }
  .sum-row span:first-child{ font-weight:600; }
  .sum-row .mono{ color:var(--ink); font-weight:600; }
  .sum-neg{ color:#b4346a !important; }
  .sum-tag{ display:inline-block; margin-left:6px; padding:1px 7px; border-radius:20px;
    background:#efeaff; color:var(--violet); font-size:9px; font-weight:800; }
  .total-box{ margin-top:10px; display:flex; justify-content:space-between;
    align-items:center; padding:16px 18px; border-radius:14px;
    background:linear-gradient(135deg,#6d4ee8,#5234c0); color:#fff;
    box-shadow:0 10px 26px -10px rgba(109,78,232,.65); }
  .total-box .tl{ font-size:9.5px; font-weight:800; letter-spacing:.22em;
    text-transform:uppercase; opacity:.82; }
  .total-box .tl small{ display:block; font-size:8.5px; letter-spacing:.16em;
    opacity:.7; font-weight:700; margin-top:3px; }
  .total-box .tv{ font-family:'Fraunces',serif; font-weight:700; font-size:30px;
    letter-spacing:-.01em; }

  /* ── Rodapé ── */
  .spacer{ flex:1; }
  .notes{ margin:30px 18mm 0; padding:14px 16px; border:1px solid var(--line);
    border-radius:12px; background:#fbfbfd; }
  .notes .nt{ font-size:8.5px; font-weight:800; letter-spacing:.2em;
    text-transform:uppercase; color:var(--faint); margin-bottom:6px; }
  .notes ul{ margin:0; padding-left:16px; }
  .notes li{ font-size:10px; color:var(--sub); line-height:1.7; }
  .footer{ display:flex; justify-content:space-between; align-items:center;
    margin:18px 18mm 0; padding-top:12px; border-top:1px solid var(--line); }
  .footer .fb{ font-size:9.5px; color:var(--sub); }
  .footer .fb b{ color:var(--ink); font-weight:800; }
  .footer .fnum{ font-size:9px; color:var(--faint); }

  @page{ size:A4; margin:0; }
  @media print{
    html,body{ background:#fff; }
    .page{ margin:0; box-shadow:none; width:auto; min-height:auto; }
  }
</style>
</head>
<body>
  <div class="page">
    <div class="topbar"></div>

    <div class="head">
      <div class="brand">
        <img src="${esc(d.logoUrl)}" alt="Auto Edit" />
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
      ${clienteBlock || '<div></div>'}
      <div class="from">
        <div class="from-label">Emitido por</div>
        <div class="from-name">Auto Edit</div>
        <div class="from-line">Automação de edição de vídeo</div>
        <div class="from-line">darkoautoedit.com</div>
      </div>
    </div>

    <div class="section-label">Itens do orçamento · ${d.qtdAds} AD${d.qtdAds === 1 ? '' : 's'}</div>
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th class="r">Duração</th>
          <th class="r">Valor</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <div class="summary-wrap">
      <div class="summary">
        <div class="sum-row"><span>Duração total</span><span class="mono">${esc(d.duracaoTotalLabel)}</span></div>
        <div class="sum-row"><span>Valor por minuto</span><span class="mono">${esc(d.vpmLabel)}</span></div>
        <div class="sum-row"><span>Subtotal</span><span class="mono">${esc(d.subtotalLabel)}</span></div>
        ${descontoRow}
        <div class="total-box">
          <div class="tl">Total<small>${d.qtdAds} AD${d.qtdAds === 1 ? '' : 's'} · ${esc(d.duracaoTotalLabel)}</small></div>
          <div class="tv">${esc(d.totalLabel)}</div>
        </div>
      </div>
    </div>

    <div class="spacer"></div>

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
  </div>

  <script>
    (function(){
      function go(){ try{ window.focus(); }catch(e){} window.print(); }
      window.addEventListener('load', function(){
        var fr = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
        Promise.race([fr, new Promise(function(r){ setTimeout(r, 1500); })])
          .then(function(){ setTimeout(go, 220); });
      });
      window.onafterprint = function(){ setTimeout(function(){ try{ window.close(); }catch(e){} }, 120); };
    })();
  </script>
</body>
</html>`;
}

/**
 * Abre uma nova janela com o relatório e dispara o print (Salvar como PDF).
 * Retorna false se o popup foi bloqueado.
 */
export function printBudgetReport(d: BudgetReportData): boolean {
  const w = window.open('', '_blank', 'width=860,height=1024');
  if (!w) return false;
  w.document.open();
  w.document.write(buildHtml(d));
  w.document.close();
  return true;
}
