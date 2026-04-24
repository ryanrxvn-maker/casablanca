import { redirect } from 'next/navigation';

// Landing das ferramentas: abre direto no Decupagem (primeira ferramenta
// do grupo Base Suite). O layout renderiza o seletor Base Suite / AI Suite
// e o rail vertical de icones por fora desse redirect.
export default function ToolsIndex() {
  redirect('/tools/decupagem');
}
