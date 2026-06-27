# Corrigir Legenda (standalone)

Corrige a **grafia** da auto-legenda do CapCut pela `copy.txt`, mantendo o
**timing** e o **tipo subtitle nativo** (modelos / animações / "aplicar a
todos" continuam funcionando). O original nunca é alterado.

- **Sem VectCutAPI, sem ffmpeg, sem pip, sem venv.** Só Python (stdlib).
- **Cross-platform** (Windows e macOS): acha a pasta de projetos do CapCut
  sozinho. Se não achar, aponte com `--drafts-root "<caminho>"`.

## Setup — macOS

O Python 3 já costuma vir no Mac. Se faltar: `brew install python` (ou
`xcode-select --install`). Salve o `corrigir_legenda.py` (ex.: na Mesa).

```bash
# rodar (ajuste o caminho do arquivo)
python3 ~/Desktop/corrigir_legenda.py list
python3 ~/Desktop/corrigir_legenda.py corrigir --draft "NOME DO PROJETO" --copy "/caminho/copy.txt"
```

Pasta de projetos do CapCut no Mac (o script tenta automaticamente):
`~/Movies/CapCut/User Data/Projects/com.lveditor.draft`

## Setup — Windows

```powershell
# Python (se não tiver)
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
}
```

```powershell
# Uso (CapCut FECHADO)
python $env:USERPROFILE\Desktop\corrigir_legenda.py list
python $env:USERPROFILE\Desktop\corrigir_legenda.py corrigir --draft "NOME DO PROJETO" --copy "C:\caminho\copy.txt"
```

Saída: duplica o projeto em **`<NOME> - LEGENDA OK`** com o texto corrigido.
Abra esse projeto no CapCut, revise e exporte.

## Fluxo correto

1. No CapCut: gere a **auto-legenda** (timing perfeito; o texto sai do ASR =
   o que foi REALMENTE falado).
2. **Salve e FECHE** o CapCut.
3. Rode o `corrigir`. Ele troca a grafia só onde a fala bate com a copy;
   improvisos do avatar (fora da copy) ficam como foram falados.
4. Abra `<NOME> - LEGENDA OK` no CapCut e exporte.

> CapCut tem que estar **fechado** ao rodar `corrigir` (senão corrompe o draft).
