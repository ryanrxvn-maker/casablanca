/**
 * Motor do Downloader no macOS — TESTE FECHADO.
 *
 * O Motor pro Mac esta provado em Mac de verdade (workflow "Motor macOS":
 * instala, binarios, launchd, pareamento, yt-dlp e ffmpeg, nos dois chips).
 * O que o teste automatizado NAO consegue cobrir e o yt-dlp puxando de site
 * real por IP RESIDENCIAL — runner de CI sai por IP de datacenter e o
 * YouTube barra datacenter. Esse ultimo centimetro so' fecha na maquina de
 * um cliente de verdade.
 *
 * Por isso o comando de instalacao aparece so pra quem esta nesta lista.
 * Os outros clientes de Mac NAO veem o instalador do Windows (que eles nao
 * conseguem rodar): veem o que funciona pra eles hoje — Instagram e TikTok
 * pela extensao — e a informacao honesta de que YouTube/Pinterest no Mac
 * ainda estao em teste.
 *
 * Isto NAO e' controle de seguranca: e' rollout controlado. O que o script
 * baixa e publico (Node oficial, yt-dlp, ffmpeg) e a rota que o serve segue
 * aberta, igual ja' e' a do .exe do Windows.
 *
 * Pra soltar pra geral: esvaziar MAC_MOTOR_BETA (ou trocar a chamada em
 * app/tools/downloader/page.tsx por `true`) — nao ha nada alem disso.
 */

/** Testadores do Motor no Mac. Admin entra sempre, sem estar na lista. */
export const MAC_MOTOR_BETA: ReadonlyArray<string> = [
  // 01.09.2026 — primeira cliente de Mac; abriu o caso perguntando no suporte.
  'iasmingarcia.editora@gmail.com',
];

function normaliza(e: string): string {
  return e.trim().toLowerCase();
}

/**
 * Este usuario pode instalar o Motor no Mac?
 *
 * @param email  email da sessao (`useUserEmail()`): `undefined` enquanto
 *               resolve, `null` deslogado. Nos dois casos responde `false` —
 *               na duvida NAO mostra o comando, pra ninguem instalar por
 *               engano antes da hora.
 * @param isAdmin admin ve sempre (pra conseguir conferir a tela do cliente).
 */
export function macMotorLiberado(
  email: string | null | undefined,
  isAdmin = false,
): boolean {
  if (isAdmin) return true;
  if (!email) return false;
  const e = normaliza(email);

  if (MAC_MOTOR_BETA.some((x) => normaliza(x) === e)) return true;

  // Env opcional pra adicionar testador sem mexer no codigo:
  //   NEXT_PUBLIC_MAC_MOTOR_BETA="fulano@x.com,ciclano@y.com"
  const extra = process.env.NEXT_PUBLIC_MAC_MOTOR_BETA || '';
  return extra
    .split(',')
    .map(normaliza)
    .filter(Boolean)
    .includes(e);
}
