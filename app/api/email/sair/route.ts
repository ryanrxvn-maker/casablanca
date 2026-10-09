import { NextResponse } from 'next/server';
import { serviceClient } from '@/app/api/admin/_helpers';
import { verifyOptout } from '@/lib/email-optout';

/**
 * /api/email/sair?u=<conta>&t=<assinatura> — "não quero mais receber" dos
 * e-mails de avisos/propagandas.
 *
 * GET  → página de confirmação (antivírus de e-mail abre links sozinho: GET
 *        nunca descadastra).
 * POST → descadastra (botão da página ou o "cancelar inscrição" de 1 clique do
 *        Gmail/Apple, RFC 8058). `acao=voltar` volta a receber.
 * Sem login: a assinatura HMAC prova que o link saiu do e-mail DESSA conta.
 * Por isso o middleware deixa este caminho sem checar Origin (o POST de 1
 * clique vem do servidor do provedor, sem Origin) — ver lib/supabase/middleware.ts.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type View = 'confirmar' | 'saiu' | 'voltou' | 'invalido' | 'erro';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function page(view: View, u = '', t = '', status = 200): NextResponse {
  const action = `/api/email/sair?u=${encodeURIComponent(u)}&t=${encodeURIComponent(t)}`;
  const copy: Record<View, { title: string; text: string; form?: { label: string; acao: 'sair' | 'voltar'; primary: boolean } }> = {
    confirmar: {
      title: 'Parar de receber nossos e-mails?',
      text: 'Você deixa de receber os e-mails de novidades e avisos do Auto Edit. Os avisos dentro da sua conta continuam aparecendo normalmente.',
      form: { label: 'Sim, não quero mais receber', acao: 'sair', primary: true },
    },
    saiu: {
      title: 'Pronto, você saiu da lista',
      text: 'Não vamos mais mandar e-mails de novidades e avisos pra você. Mudou de ideia? É só voltar.',
      form: { label: 'Voltar a receber', acao: 'voltar', primary: false },
    },
    voltou: { title: 'Bem-vindo de volta', text: 'Você volta a receber os e-mails de novidades e avisos do Auto Edit.' },
    invalido: { title: 'Link inválido', text: 'Esse link não confere. Use o link do rodapé do e-mail que você recebeu.' },
    erro: { title: 'Não deu agora', text: 'Tivemos um problema pra salvar. Tente de novo em alguns minutos.' },
  };
  const c = copy[view];
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="color-scheme" content="dark"><title>${esc(c.title)} · Auto Edit</title>
<style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#09090b;color:#fff;font-family:'Inter','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif}
body{display:flex;align-items:center;justify-content:center;padding:24px 16px;background:radial-gradient(60% 50% at 50% 0%,rgba(162,145,224,.16),transparent 70%),#09090b}
.card{width:100%;max-width:440px;padding:34px 30px 30px;border-radius:24px;background:#121217;border:1px solid #24242c;box-shadow:0 40px 90px -40px rgba(0,0,0,.9)}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:.02em;font-size:15px;margin-bottom:26px}
.brand img{width:32px;height:32px}
h1{margin:0;font-size:24px;line-height:30px;font-weight:800;letter-spacing:-.02em}
p{margin:12px 0 0;font-size:15px;line-height:24px;color:#b8b8c6}
form{margin:26px 0 0}
button,a.btn{display:inline-flex;align-items:center;justify-content:center;width:100%;height:50px;border-radius:14px;border:0;font:inherit;font-size:15px;font-weight:700;cursor:pointer;text-decoration:none}
.primary{background:#A291E0;color:#0a0a0c;box-shadow:0 14px 30px -12px rgba(162,145,224,.75)}
.ghost{background:transparent;color:#fff;box-shadow:inset 0 0 0 1px #2c2c36}
.ghost:hover{box-shadow:inset 0 0 0 1px #45455a}
.back{margin-top:12px}
</style></head>
<body><main class="card">
<div class="brand"><img src="/auto-edit-logo@128.png" alt="">Auto Edit</div>
<h1>${esc(c.title)}</h1>
<p>${esc(c.text)}</p>
${c.form ? `<form method="post" action="${esc(action)}"><input type="hidden" name="acao" value="${c.form.acao}"><button type="submit" class="${c.form.primary ? 'primary' : 'ghost'}">${esc(c.form.label)}</button></form>` : ''}
<a class="btn ghost back" href="/">Ir pro Auto Edit</a>
</main></body></html>`;
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const u = url.searchParams.get('u') ?? '';
  const t = url.searchParams.get('t') ?? '';
  if (!verifyOptout(u, t)) return page('invalido', '', '', 400);
  return page('confirmar', u, t);
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const u = url.searchParams.get('u') ?? '';
  const t = url.searchParams.get('t') ?? '';
  if (!verifyOptout(u, t)) return page('invalido', '', '', 400);
  const form = await req.formData().catch(() => null);
  const voltar = form?.get('acao') === 'voltar';
  try {
    const svc = serviceClient();
    const { data, error } = await svc.auth.admin.getUserById(u);
    if (error || !data?.user) return page('erro', u, t, 500);
    const meta = { ...(data.user.app_metadata ?? {}), email_optout: !voltar, email_optout_at: new Date().toISOString() };
    const upd = await svc.auth.admin.updateUserById(u, { app_metadata: meta });
    if (upd.error) return page('erro', u, t, 500);
    return page(voltar ? 'voltou' : 'saiu', u, t);
  } catch {
    return page('erro', u, t, 500);
  }
}
