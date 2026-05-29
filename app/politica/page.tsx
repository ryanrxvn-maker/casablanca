import Link from 'next/link';
import { Brand } from '@/components/Brand';

/**
 * /politica — Política de assinatura, cancelamento e reembolso.
 * Pública. Linkada no rodapé da /planos e no checkout/portal.
 */
export const metadata = {
  title: 'Política de Assinatura e Cancelamento · Auto Edit',
};

const UPDATED = '29/05/2026';

export default function PoliticaPage() {
  return (
    <main className="relative min-h-screen">
      <header className="border-b border-line/50 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[820px] items-center justify-between px-5">
          <Brand href="/" />
          <Link href="/planos" className="btn-ghost">
            ← Planos
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-[820px] px-5 py-12 md:py-16">
        <p
          className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-violet"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Transparência
        </p>
        <h1 className="mb-2 text-[32px] font-extrabold tracking-tight text-white md:text-[40px]">
          Assinatura, cancelamento e reembolso
        </h1>
        <p className="mb-10 text-[13px] text-text-muted">
          Última atualização: {UPDATED}
        </p>

        <div className="flex flex-col gap-8 text-[15px] leading-relaxed text-text-muted">
          <Section title="1. Como funciona a cobrança">
            Os planos pagos (Basic e Pro) são <strong className="text-white">assinaturas recorrentes</strong>{' '}
            cobradas no cartão de crédito. Você escolhe o ciclo:
            <ul className="mt-3 list-disc pl-5">
              <li><strong className="text-white">Mensal</strong> — cobrado uma vez por mês.</li>
              <li><strong className="text-white">Anual</strong> — cobrado uma vez por ano (12 meses de acesso por cobrança).</li>
            </ul>
            <p className="mt-3">
              A renovação é <strong className="text-white">automática</strong> ao fim de cada ciclo,
              no mesmo cartão, até que você cancele. O valor de cada cobrança é
              exatamente o do plano escolhido, sem taxas escondidas.
            </p>
          </Section>

          <Section title="2. Renovação e falha de pagamento">
            Antes de cada renovação a cobrança é feita automaticamente. Se o
            cartão falhar, tentamos novamente por alguns dias. Persistindo a
            falha, a assinatura é <strong className="text-white">suspensa</strong> e o acesso aos recursos
            pagos volta ao plano gratuito — sem cobrança de multa.
          </Section>

          <Section title="3. Cancelamento — a qualquer momento">
            Você pode cancelar quando quiser, sem burocracia, em{' '}
            <strong className="text-white">Configurações → Assinatura → Gerenciar</strong> (portal
            seguro do nosso processador de pagamentos). Ao cancelar:
            <ul className="mt-3 list-disc pl-5">
              <li>Não há multa nem fidelidade.</li>
              <li>
                Seu acesso <strong className="text-white">continua ativo até o fim do período já pago</strong>{' '}
                (você não perde os dias/meses que já pagou).
              </li>
              <li>Após esse período, não há novas cobranças.</li>
            </ul>
          </Section>

          <Section title="4. Reembolso — direito de arrependimento (7 dias)">
            Conforme o <strong className="text-white">Art. 49 do Código de Defesa do Consumidor</strong>,
            você tem até <strong className="text-white">7 (sete) dias corridos</strong> a partir da
            primeira contratação para desistir e receber o{' '}
            <strong className="text-white">reembolso integral</strong> do valor pago, sem precisar
            justificar. Basta solicitar pelo suporte dentro desse prazo.
            <p className="mt-3">
              Após os 7 dias, não há reembolso proporcional de períodos já em uso,
              mas você pode cancelar a renovação a qualquer momento (item 3).
            </p>
          </Section>

          <Section title="5. Suporte">
            Dúvidas sobre cobrança, cancelamento ou reembolso? Fale com a gente
            pelo WhatsApp{' '}
            <a
              href="https://wa.me/5534991262437"
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet hover:text-white"
            >
              (34) 99126-2437
            </a>
            . Respondemos o quanto antes.
          </Section>
        </div>

        <div className="mt-12 border-t border-line/60 pt-6">
          <Link href="/planos" className="text-violet hover:text-white">
            ← Voltar pros planos
          </Link>
        </div>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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
