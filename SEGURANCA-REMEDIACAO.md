# Remediação do pentest de 13/08/2026 — darkoautoedit.com

Resposta ao relatório `relatorio-pentest-darkoautoedit.md`. Este arquivo cobre
**o que ainda depende de você** (painel da Vercel/Supabase/Cloudflare). O que era
código já foi corrigido — a lista completa está no final.

Uma observação importante sobre o relatório: ele testou o site **de fora, sem
conta**, num deploy que já não é o atual. Vários pontos que ele marcou como
abertos já tinham defesa no código (o `send-code`, por exemplo, já exigia sessão
e tinha teto diário por conta — o "sem autenticação" do achado 3.3 não valia mais
para o deploy corrente). O que estava de fato aberto foi corrigido; o resto está
listado abaixo com o motivo.

---

## 1. Ações no painel (não dá pra fazer por código)

### 1.1 — Apagar as contas criadas pelo pentester · **prioridade alta**

O relatório deixou 3 contas vivas no Supabase. Enquanto existirem, elas seguem
elegíveis a reset de senha e reenvio de confirmação.

A mais séria é **`admin@darkoautoedit.com`**: alguém de fora cadastrou um
endereço no *nosso* domínio. Ela não dá poder nenhum dentro do app (ser admin
aqui depende da flag no `profile`, não do texto do email), mas serve pra
engenharia social — um print dessa conta logada no Auto Edit engana cliente e
suporte com facilidade.

```bash
node scripts/purge-pentest-accounts.mjs
```

Esse comando **só lista**. Conferindo que a lista está certa, apague:

```bash
node scripts/purge-pentest-accounts.mjs --delete
```

### 1.2 — CAPTCHA no Supabase Auth · **prioridade alta**

Este é o item que **fecha de verdade o achado 3.2** (força bruta de senha e de
OTP). O login e a confirmação de código saem do navegador direto pro Supabase,
sem passar pelo nosso servidor — então **nenhum código nosso consegue limitar
essas tentativas**. Quem tem essa alavanca é o Supabase:

1. Dashboard → Authentication → Settings → **Enable Captcha protection**
2. Provedor: hCaptcha ou Cloudflare Turnstile
3. Copie o *site key* e o *secret*; o secret vai no Supabase, o site key no app

Depois de ativar, o `signInWithPassword` e o `signUp` passam a exigir
`options.captchaToken` — ou seja, **ativar isso exige uma alteração no código do
login/cadastro junto**. Me chame que eu faço a parte do app na mesma hora; se
ativar só no painel, o cadastro e o login param.

### 1.3 — Limites de taxa do Supabase · **prioridade média**

Dashboard → Authentication → Rate Limits. Confira principalmente:

- **Sign in / Sign up**: o relatório fez 5 logins errados seguidos sem bloqueio
- **Verify OTP**: 10 códigos errados seguidos sem bloqueio
- **Emails enviados por hora**: segura o abuso de reenvio

### 1.4 — TLS 1.0/1.1 · **prioridade média** (achado 3.8)

Não dá pra resolver por código — quem termina o TLS é a borda. Pelos IPs do
relatório (`216.198.79.1`), o tráfego bate direto na Vercel, ou seja o
Cloudflare está só como DNS (nuvem cinza). Dois caminhos:

- **Cloudflare como proxy** (nuvem laranja no registro DNS) → SSL/TLS → Edge
  Certificates → *Minimum TLS Version* → **1.2**. É o controle direto.
- **Continuar só na Vercel**: não há botão de versão mínima de TLS; abra um
  chamado com o suporte deles pedindo o corte de TLS 1.0/1.1.

Impacto real é baixo (nenhum ataque prático foi demonstrado), mas é exigência de
conformidade PCI-DSS e higiene básica.

### 1.5 — Alerta de custo na Twilio · **prioridade média**

Mesmo com os tetos novos (item 2.3 abaixo), configure um alerta de gasto:
Twilio Console → Billing → **Usage Triggers**. É a rede de proteção que avisa se
alguém achar um caminho que não previmos.

### 1.6 — Promover a CSP pra modo bloqueante · **quando puder testar**

Explicado em detalhe na seção 3.

---

## 2. O que já foi corrigido no código

### 2.1 — Enumeração de usuários (achado 3.1, Médio) · `app/api/auth/diagnose/route.ts`

**Era assim:** mandando só o email, o endpoint respondia `not_found` pra quem não
tinha conta e `unconfirmed`/`wrong_password` pra quem tinha. Um `curl` sem
credencial nenhuma confirmava se qualquer email tinha cadastro aqui.

**Ficou assim:** o endpoint só revela o estado da conta pra quem **prova que é
dono dela** — a senha vai junto e é verificada de verdade contra o Supabase.
Senha certa → motivo real. Senha errada **ou email inexistente** → a *mesma*
resposta `invalid_credentials` nos dois casos. Acabou o oráculo.

**A UX não perdeu nada**, e esse era o risco da correção óbvia (responder sempre
genérico): tanto no login quanto no cadastro a pessoa **acabou de digitar a
senha**, então quem é dono continua recebendo a mensagem exata ("confirme seu
email", "acesso revogado", "troque a senha provisória") com o botão certo.
Inclusive continua funcionando aquele caso do cliente cujo email de cadastro não
chegava: quem re-cadastra uma conta pendente segue caindo direto na tela do
código.

Exceção consciente: contas **banidas** continuam se identificando. O GoTrue
responde `user_banned` sem garantir que conferiu a senha, e é melhor a pessoa
saber que precisa falar com o suporte. Contas normais seguem indistinguíveis de
email inexistente, que é o que importa.

### 2.2 — OTP de SMS era previsível · **não estava no relatório**

`app/api/auth/sms/send-code/route.ts` gerava o código com `Math.random()`, que é
um gerador **não-criptográfico**: o estado interno dele pode ser reconstruído a
partir de algumas saídas observadas — e o atacante observa quantas quiser, é só
pedir código pro próprio telefone. Na prática dava pra **prever o código enviado
pro telefone de outra pessoa** sem nunca ver o SMS dela, o que é pior que força
bruta porque nem esbarra nos limites de tentativa.

Trocado por `crypto.randomInt`. O pentest não tinha como ver isso de fora — só
lendo o código.

### 2.3 — SMS bombing (achado 3.3, Médio) · `send-code`

O endpoint já exigia sessão e já tinha teto de 10/dia **por conta** — mas o teto
por conta não segura o ataque que importa: como o cadastro é aberto, criar várias
contas grátis bombardeava a **mesma vítima**, cada conta gastando a cota dela.

Agora o teto acompanha o **número de destino**: máximo 5 SMS por número em 24h e
1 minuto de intervalo entre envios pro mesmo número, valendo pra qualquer conta.
O custo total por vítima virou fixo, que era exatamente a remediação pedida.

### 2.4 — CSP ausente (achado 3.4, Baixo) · `next.config.js`

Duas camadas. Detalhe na seção 3.

### 2.5 — robots.txt entregava o mapa (achado 3.7) · `app/robots.ts`

O arquivo listava `/admin`, `/api`, `/tools` e todas as telas de auth. Como o
próprio relatório nota, `Disallow` **não impede acesso nem indexação** — só
publicava o mapa do app pra quem abrisse `/robots.txt`.

As rotas privadas saíram do `robots.txt` e agora saem do índice pelo header
`X-Robots-Tag: noindex, nofollow, noarchive`, que é o mecanismo que de fato
funciona. Quem barra acesso continua sendo o middleware de sessão. O SEO das
páginas públicas não muda.

### 2.6 — HSTS reforçado

De 1 ano para 2 anos, com `preload`. Sem `preload`, a **primeira** visita em
`http://` ainda é interceptável. Para entrar na lista embutida dos browsers é
preciso submeter o domínio em <https://hstspreload.org> — faça isso só quando
tiver certeza de que nenhum subdomínio precisa de HTTP puro, porque **sair da
lista é lento**.

### 2.7 — Limite de tentativas: o que ele é e o que ele não é

Vale ser explícito, porque o relatório cobrou isso: o `lib/rate-limit.ts` guarda
os contadores **na memória da instância**. Na Vercel isso significa que cada
instância serverless tem o próprio contador — com várias instâncias ativas, o
teto efetivo é multiplicado. Ele adiciona fricção real contra abuso, mas não é
um limite global exato.

Onde isso importava de verdade, o limite está no **banco**, que é global e não
depende de instância: os tetos de SMS por conta e por número de destino. E o
`diagnose`, por passar a validar a senha no Supabase, agora também fica sujeito
ao limite de taxa do próprio Supabase Auth.

Um limitador global exato exigiria Redis/Upstash (infra nova, variáveis novas).
Só vale a pena se você vir abuso concreto — me chame que eu ligo.

### 2.8 — Respostas de auth não entram em cache

O `diagnose` agora responde com `Cache-Control: no-store, private`. Resposta de
autenticação nunca deve ficar em cache de CDN ou de browser compartilhado.

---

## 3. Sobre a CSP: por que em duas camadas

Uma CSP escrita no escuro derruba justamente as ferramentas pesadas — elas
dependem de WebAssembly (ffmpeg, MediaPipe), de `Worker` criado a partir de
`blob:`, de CDN (unpkg/jsdelivr) e da injeção das extensões. Como a regra aqui é
**não quebrar ferramenta**, a política foi dividida:

**Camada 1 — bloqueante, risco zero.** Só entrou diretiva que comprovadamente
não afeta nada do app (verifiquei: não existe `<object>`/`<embed>`, não existe
nenhum `<form action=...>` — todo envio é `fetch` — e o app já recusa iframe).
Não há `default-src` nem `script-src` aqui de propósito: o que não está listado
segue liberado.

```
base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'
```

Isso já barra sequestro de `<base>` (que reescreve o destino de todo caminho
relativo da página), injeção de plugin e roubo de dados por formulário apontado
pra fora.

**Camada 2 — a política estrita, em modo observação.** Vai como
`Content-Security-Policy-Report-Only`: **não bloqueia nada**, só reporta violação
no console do navegador. Ela contém a `connect-src` estreita, que é a diretiva
que realmente impede exfiltração de dados caso um XSS apareça.

### Como promover pra bloqueante

1. Abra o app e **rode as ferramentas pesadas** (decupagem, camuflagem, lipsync,
   legenda, FakePass) com o console aberto (F12)
2. Procure mensagens de violação de CSP. Se aparecer alguma origem legítima que
   eu não previ, **acrescente ela na política antes de promover**
3. Console limpo: em `next.config.js`, troque a chave
   `Content-Security-Policy-Report-Only` por `Content-Security-Policy` e apague
   a camada 1

Fica um limite honesto mesmo depois de promovida: o `script-src` precisa de
`'unsafe-inline'`, porque o Next injeta script inline de hidratação em toda
página. Tirar isso exige *nonce* por requisição, o que força renderização
dinâmica no site inteiro — custo de latência e de SEO na landing, num app que já
tem queixa de lentidão de partida a frio. A `connect-src` estreita entrega a
maior parte do benefício sem esse custo.

---

## 4. O que o relatório não conseguiu testar (item 3.10)

O maior buraco de **cobertura** do pentest é a área autenticada: SSRF nas
ferramentas de vídeo, injeção de comando no ffmpeg, IDOR e billing ficaram todos
sem teste por falta de conta confirmada. Auditei esses vetores diretamente no
código-fonte — resultado registrado na seção seguinte.
