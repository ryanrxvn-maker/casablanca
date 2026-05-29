import Link from 'next/link';
import { Brand } from '@/components/Brand';

/**
 * /termos — Termos de Uso do Auto Edit. Público. Linkado no cadastro
 * (consentimento obrigatório) e no rodapé.
 */
export const metadata = {
  title: 'Termos de Uso · Auto Edit',
};

const UPDATED = '29/05/2026';

export default function TermosPage() {
  return (
    <main className="relative min-h-screen">
      <header className="border-b border-line/50 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[820px] items-center justify-between px-5">
          <Brand href="/" />
          <Link href="/" className="btn-ghost">
            ← Início
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-[820px] px-5 py-12 md:py-16">
        <p
          className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-violet"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Legal
        </p>
        <h1 className="mb-2 text-[32px] font-extrabold tracking-tight text-white md:text-[40px]">
          Termos de Uso
        </h1>
        <p className="mb-10 text-[13px] text-text-muted">Última atualização: {UPDATED}</p>

        <div className="flex flex-col gap-8 text-[15px] leading-relaxed text-text-muted">
          <S title="1. Aceitação">
            Ao criar uma conta ou usar o Auto Edit, você concorda com estes Termos
            de Uso e com a{' '}
            <Link href="/politica" className="text-violet hover:text-white">
              Política de Assinatura e Cancelamento
            </Link>
            . Se não concordar, não use o serviço.
          </S>

          <S title="2. O que é o Auto Edit">
            O Auto Edit é uma plataforma de automação de edição de vídeo. As
            ferramentas rodam no seu próprio computador/navegador; seus arquivos
            de mídia não são enviados pros nossos servidores, salvo quando uma
            ferramenta específica exigir processamento externo (informado no uso).
          </S>

          <S title="3. Conta e segurança">
            <ul className="mt-2 list-disc pl-5">
              <li>Você é responsável por manter sua senha em segredo e por toda atividade na sua conta.</li>
              <li>As credenciais são pessoais e intransferíveis. Compartilhar acesso pode levar à suspensão.</li>
              <li>Você deve fornecer dados verdadeiros no cadastro.</li>
            </ul>
          </S>

          <S title="4. Planos, pagamento e acesso">
            Os recursos pagos (Basic e Pro) exigem assinatura ativa. O acesso é
            liberado apenas mediante pagamento confirmado ou concessão expressa do
            administrador. Tentar burlar o controle de acesso é proibido e resulta
            em suspensão imediata. Detalhes de cobrança, renovação e reembolso na{' '}
            <Link href="/politica" className="text-violet hover:text-white">
              Política de Assinatura
            </Link>
            .
          </S>

          <S title="5. Uso aceitável">
            Você concorda em não: (a) usar o serviço para conteúdo ilegal ou que
            viole direitos de terceiros; (b) tentar acessar áreas restritas,
            recursos pagos sem pagar, ou contas de outros; (c) realizar engenharia
            reversa, revender ou redistribuir o serviço sem autorização; (d)
            sobrecarregar ou atacar a infraestrutura.
          </S>

          <S title="6. Conteúdo e propriedade">
            Você mantém os direitos sobre os arquivos que processa. O software, a
            marca e a interface do Auto Edit são de nossa propriedade e protegidos
            por lei. As chaves de API que você conectar (BYOK) são suas e ficam
            cifradas.
          </S>

          <S title="7. Disponibilidade e limitação de responsabilidade">
            O serviço é fornecido “como está”. Buscamos a maior estabilidade
            possível, mas não garantimos funcionamento ininterrupto. Não nos
            responsabilizamos por perdas indiretas decorrentes do uso, no limite
            permitido pela lei.
          </S>

          <S title="8. Cancelamento e encerramento">
            Você pode cancelar a qualquer momento (ver Política). Podemos suspender
            ou encerrar contas que violem estes Termos, com aviso quando cabível.
          </S>

          <S title="9. Alterações">
            Podemos atualizar estes Termos. Mudanças relevantes serão comunicadas.
            O uso continuado após a atualização significa aceitação.
          </S>

          <S title="10. Foro e contato">
            Estes Termos seguem a legislação brasileira (incluindo o Código de
            Defesa do Consumidor). Dúvidas? WhatsApp{' '}
            <a
              href="https://wa.me/5534991262437"
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet hover:text-white"
            >
              (34) 99126-2437
            </a>
            .
          </S>
        </div>

        <div className="mt-12 flex gap-4 border-t border-line/60 pt-6 text-[13px]">
          <Link href="/politica" className="text-violet hover:text-white">
            Política de Cancelamento
          </Link>
          <Link href="/planos" className="text-violet hover:text-white">
            Planos
          </Link>
        </div>
      </article>
    </main>
  );
}

function S({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2
        className="mb-3 text-[18px] font-bold text-white"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
}
