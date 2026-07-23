import { redirect } from 'next/navigation';

/**
 * /admin/dashboard → /admin
 *
 * O painel foi unificado: financeiro (arrecadado por período), usuários,
 * ranking de ferramentas, origem de tráfego e online agora vivem TODOS no
 * /admin. Este redirect existe só pra não quebrar bookmark/histórico.
 */
export default function DashboardRedirect() {
  redirect('/admin');
}
