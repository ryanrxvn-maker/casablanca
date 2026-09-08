# Disparos persistentes

Background fica na conta até exclusão explícita. Histórico expira sete dias após
o evento; recarregar ou atualizar um evento não reinicia esse prazo.

## Publicação

1. Aplicar `supabase/migrations/035_durable_records.sql` no banco configurado em
   `NEXT_PUBLIC_SUPABASE_URL`, antes de publicar o código. A migração cria tabelas
   próprias, RLS e RPCs; não altera dados de outras tabelas.
2. Publicar a aplicação com as variáveis Supabase existentes. A limpeza física
   diária exige `CRON_SECRET` e a credencial de serviço utilizada por `serviceClient`.
   Mesmo sem cron, a política de leitura esconde o histórico expirado.
3. Conferir `/api/user/records` autenticado e `/tools/background`: o indicador só
   confirma sincronização depois da resposta do banco. Importar os registros
   antigos exige confirmar a conta, pois o armazenamento anterior era compartilhado.
4. Confirmar recuperação após reload e outra sessão da mesma conta. Não limpar
   dados reais do navegador para fazer este teste.

## Regras de integridade

- Cada registro possui revisão; snapshots vazios ou parciais não excluem dados.
- Escritas locais são serializadas entre abas. A RPC usa comparação de revisão,
  bloqueio transacional e recibos compactos para repetição após perda de resposta.
- Divergências no mesmo campo preservam uma cópia de recuperação e ficam visíveis.
- Exclusão grava um tombstone; abas antigas não ressuscitam o registro.
- Reiniciar uma task com outro `startedAt` arquiva a execução anterior no background.
- Recuperar o Pilot não inicia outro worker automaticamente. O usuário escolhe
  Retomar após conferir se há uma aba já processando.
- A limpeza automática do zip-store protege IDs associados ao background salvo.
- Nenhuma alteração de credenciais, extensão ou conteúdo dos vídeos faz parte desta correção.

## Limites explícitos

O banco guarda metadados, planos, IDs e referências; não é backup dos bytes de
montados. Vídeos locais dependem do IndexedDB/arquivo baixado e URLs externas
podem expirar. Fechar o navegador interrompe workers locais. Registros ainda
pendentes no navegador não podem ser recuperados do servidor antes de confirmar
a sincronização. Disponibilidade depende também das cotas e backups do provedor.

Os cards antigos que já haviam desaparecido não são reconstruídos por esta
migração sem uma cópia original. Conflitos podem ser exportados pelo indicador
para revisão; não devem ser resolvidos descartando o armazenamento do navegador.

## Testes

`node scripts/test.mjs durable-records`

`node scripts/test.mjs heygen-batch-store`

`node scripts/test.mjs zip-store-prune`

`npm run type-check` e `npm run build`

`scripts/test-durable-records-sql.cjs` roda a migração duas vezes num PostgreSQL
PGlite temporário e testa RLS, revisões, recibos, tombstones, arquivamento e TTL.
Instale `@electric-sql/pglite` num diretório de testes e indique o caminho do módulo
por `PGLITE_MODULE`; ele não é uma dependência da aplicação.
