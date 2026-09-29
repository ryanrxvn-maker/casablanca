# StockFrame — fichas visuais internas

O Claude coletou um instantâneo de 6.413 mídias em 26/09/2026 (5.931 vídeos e 482 áudios). O material original, as prévias e as folhas de contato permanecem na pasta local `D:\Área de Trabalho\CASABLANCA\.stockframe-catalogo`; **não** estão no deploy. As URLs assinadas do instantâneo expiram e não devem ser copiadas para o repositório.

`fichas/NNNN.txt` contém somente linhas que foram comparadas visualmente à folha `folhas/NNNN.jpg`. O formato e os beats estão em `fichas/VOCABULARIO.md`. A geração confere os números com `folhas/NNNN.json` e publica apenas `ID → descrição visual, beats, apelo, flags e título original`, sem links de mídia nem chave de API.

Estado deste lote: 1.575 IDs de vídeo em 98 folhas completas e 1 parcial; 4.356 vídeos ainda não têm ficha. A folha 0031 deixa os nove primeiros itens adultos sem ficha individual. A pasta `ED +18 - EM BREVE` é bloqueada no Smart por segurança, inclusive quando o título não revela o conteúdo.

Para acrescentar fichas, continue pela próxima folha não revisada, confira os quadros, salve `fichas/NNNN.txt` e gere novamente:

```powershell
node scripts/build-stockframe-visual-audit.mjs 'D:\Área de Trabalho\CASABLANCA\.stockframe-catalogo'
node scripts/test.mjs stockframe.test
```

O output versionado é `data/stockframe-visual-audit.ts`. O Pilot o carrega sob demanda só ao analisar com Smart Stocks. IDs sem ficha continuam usando o ranking anterior e apenas resultados liberados pela API da conta paga são candidatos: a ficha local não libera vídeo, não altera cota e não faz download. Não inferir que todos os vídeos foram conferidos até as 381 folhas e seus IDs estarem auditados.

Antes de publicar: confirmar branch/base atual, preservar alterações paralelas, type-check, build, testes do Smart e do bridge, deploy concluído, endpoint publicado e checagem visual/funcional no Pilot autenticado.
