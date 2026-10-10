import Link from 'next/link';
import { Brand } from '@/components/Brand';

/**
 * /politica — Política de assinatura, cancelamento e reembolso.
 * Pública. Linkada no rodapé da /planos e no checkout/portal.
 */
export const metadata = {
  title: 'Política de Assinatura e Cancelamento',
  description:
    'Como funcionam assinatura, cancelamento e reembolso no Auto Edit — sem multa e com o caminho de cancelamento explicado.',
  alternates: { canonical: '/politica' },
};

const UPDATED = '09/10/2026';

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
            O plano pago (Premium) é cobrado no cartão de crédito.
            Você escolhe o ciclo, e cada um funciona de um jeito:
            <ul className="mt-3 list-disc pl-5">
              <li>
                <strong className="text-white">Mensal</strong> — assinatura{' '}
                <strong className="text-white">recorrente</strong>: cobra uma vez por mês e renova
                automaticamente até você cancelar.
              </li>
              <li>
                <strong className="text-white">Anual</strong> — pagamento{' '}
                <strong className="text-white">único</strong> (que você pode parcelar no cartão em
                até 12×). Libera <strong className="text-white">12 meses</strong> de acesso e{' '}
                <strong className="text-white">não renova automaticamente</strong>: ao fim do
                período, você decide se contrata de novo.
              </li>
            </ul>
            <p className="mt-3">
              O valor é exatamente o do plano escolhido, sem taxas escondidas.
            </p>
          </Section>

          <Section title="2. Renovação e falha de pagamento (plano mensal)">
            No <strong className="text-white">plano mensal</strong>, antes de cada renovação a
            cobrança é feita automaticamente. Se o cartão falhar, tentamos
            novamente por alguns dias; persistindo a falha, a assinatura é{' '}
            <strong className="text-white">suspensa</strong> e o acesso volta ao plano gratuito,
            sem multa. O <strong className="text-white">plano anual</strong> não tem renovação
            automática — o acesso expira ao fim dos 12 meses.
          </Section>

          <Section title="3. Cancelamento — a qualquer momento">
            Você pode cancelar quando quiser, sem burocracia, em{' '}
            <strong className="text-white">Configurações → Assinatura → Cancelar assinatura</strong>.
            O cancelamento vale na hora no nosso processador de pagamentos, e a tela mostra antes
            do clique o que vai acontecer:
            <ul className="mt-3 list-disc pl-5">
              <li>Não há multa nem fidelidade.</li>
              <li>
                <strong className="text-white">Até 7 dias depois da cobrança</strong>: devolvemos o
                valor pago (item 4) e o acesso pago termina na hora.
              </li>
              <li>
                <strong className="text-white">Depois de 7 dias da cobrança</strong>: não há
                reembolso, mas seu acesso{' '}
                <strong className="text-white">continua ativo até a próxima data de cobrança</strong>{' '}
                (você não perde os dias que já pagou).
              </li>
              <li>Em nenhum dos casos há novas cobranças.</li>
            </ul>
          </Section>

          <Section title="4. Reembolso — direito de arrependimento (7 dias)">
            Conforme o <strong className="text-white">Art. 49 do Código de Defesa do Consumidor</strong>,
            você tem até <strong className="text-white">7 (sete) dias corridos</strong> a partir da
            cobrança para desistir e receber o{' '}
            <strong className="text-white">reembolso integral</strong> do valor pago, sem precisar
            justificar. O reembolso é <strong className="text-white">automático</strong>: basta
            cancelar dentro do prazo pela tela da assinatura (item 3), sem precisar falar com o
            suporte. O valor volta para o mesmo cartão; o estorno aparece na fatura em até 10 dias
            úteis, conforme o banco emissor.
            <p className="mt-3">
              O reembolso automático vale uma vez por cliente. Após os 7 dias, não há reembolso
              proporcional de períodos já em uso, mas você pode cancelar a renovação a qualquer
              momento (item 3).
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
