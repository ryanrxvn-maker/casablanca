# TT URL Collector — bookmarklet standalone

Capturador de URLs do TikTok por nicho. **Não tem nada a ver com o DARKO LAB**
nem com a extensão Downloader — é só um arquivo `.html` + `javascript:`
bookmarklet que você arrasta pra barra de favoritos do seu navegador.

## Por que existe

Pra montar listas de vídeos do TikTok por tema (ex.: "memoria", "ed") sem
escrever script de scraping nem mexer no DARKO. Você rola a busca, clica
"Capturar visíveis", troca de busca, repete. No fim, exporta um `.txt` por
nicho e usa onde quiser (yt-dlp, etc.).

## Como instalar

1. Abra **`install.html`** no Chrome/Edge/Firefox (clique 2x no arquivo).
2. **Arraste** o botão lima _"TT URL Collector"_ pra sua barra de favoritos.
   - Se a barra estiver escondida: `Ctrl+Shift+B` no Chrome/Edge, `Ctrl+B` no Firefox.
   - **Não clique no botão** — bookmarklet só roda quando salvo como favorito.

## Como usar

1. Abra o TikTok (busca, perfil, hashtag, feed — qualquer página).
2. Clique no favorito **TT URL Collector**. Aparece um painel no canto.
3. Escolha o nicho (vem com **Memória** e **E.D**; clique "+ add" pra criar outros).
4. Role a página → clique **"Capturar visíveis (N)"** → repete.
   - As URLs ficam salvas em `localStorage` do `tiktok.com`, então você pode
     trocar de busca / página / aba sem perder.
5. Quando tiver o que precisa, clique **"Exportar TXT"** → baixa `memoria.txt`,
   `ed.txt` etc., **uma URL por linha**, já limpas (sem `?` tracker).

## Botões do painel

| Botão | O que faz |
|---|---|
| **Capturar visíveis (N)** | Pega os N vídeos novos atualmente no DOM e salva no nicho selecionado |
| **Copiar URLs do nicho** | Copia o conteúdo do nicho atual pro clipboard |
| **Exportar TXT** | Baixa 1 `.txt` por nicho que tem URLs |
| **Limpar nicho** | Apaga só o nicho atual (confirma) |
| **Limpar TUDO** | Apaga todos os nichos (confirma) |
| **_** (header) | Esconde / mostra o corpo do painel |

Painel é **arrastável** pelo header.

Clicar no favorito de novo na mesma página → **esconde o painel**. Clicar mais
uma vez → mostra de volta.

## Depois: baixar os áudios

```bash
# instale uma vez: pip install yt-dlp  (precisa do ffmpeg no PATH)
yt-dlp -a memoria.txt -o "audios-memoria/%(id)s.%(ext)s" -x --audio-format mp3
yt-dlp -a ed.txt      -o "audios-ed/%(id)s.%(ext)s"      -x --audio-format mp3
```

## Onde estão os dados

`localStorage` do `https://www.tiktok.com`:

- `tt_url_col_buckets` → JSON `{ "memoria": { "<videoId>": "<url>", ... }, "ed": {...} }`
- `tt_url_col_niche` → string com o último nicho selecionado

Pra zerar tudo manualmente: DevTools → Application → Local Storage →
`https://www.tiktok.com` → deletar as duas chaves.

## Arquivos

```
bookmarklet.js        ← código-fonte (legível)
bookmarklet.min.js    ← versão colapsada (saída do build)
bookmarklet.uri.txt   ← versão javascript:... pronta pra colar (saída do build)
install.html          ← página que você abre pra arrastar pra barra
build.mjs             ← gera min + uri + injeta no install.html
README.md             ← este arquivo
```

## Rebuildar (se editar `bookmarklet.js`)

```bash
cd standalone/tiktok-url-collector
node build.mjs
```

Atualiza `bookmarklet.min.js`, `bookmarklet.uri.txt` e re-injeta no `install.html`.

## Limitações

- O bookmarklet só "vê" o que está renderizado no DOM da página atual. Tem que
  rolar pra carregar mais resultados e clicar **Capturar visíveis** de novo.
- TikTok virtualiza a lista em alguns lugares (descarta itens fora do
  viewport). Se notar que o contador "visíveis" cai depois de muito scroll,
  capture com frequência (cada N de scroll, não no fim).
- Algumas páginas do TikTok têm CSP estrita que pode bloquear `eval`-like de
  bookmarklet. O nosso só usa DOM/localStorage/Blob, nada perigoso — deve
  passar.
