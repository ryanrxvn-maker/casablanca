import { redirect } from 'next/navigation';

// Agenda e a primeira aba e a "casa" do editor: agenda do dia primeiro,
// depois ferramentas de processamento.
export default function ToolsIndex() {
  redirect('/tools/agenda');
}
