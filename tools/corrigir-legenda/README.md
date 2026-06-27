# Corrigir Legenda (standalone)

Corrige a **grafia** da auto-legenda do CapCut pela `copy.txt`, mantendo o
**timing** e o **tipo subtitle nativo** (modelos / animações / "aplicar a
todos" continuam funcionando). O original nunca é alterado.

- **Sem VectCutAPI, sem ffmpeg, sem pip, sem venv.** Só Python (stdlib).
- Lê os projetos do CapCut direto de `%LOCALAPPDATA%\CapCut\...`.

## Setup no outro PC (só tem Claude Code)

Cole isto no terminal (PowerShell). Instala o Python se faltar e baixa o
script:

```powershell
# 1) Python (se não tiver)
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
}

# 2) Baixar o script
$dst = "$env:USERPROFILE\corrigir_legenda.py"
irm "https://raw.githubusercontent.com/ryanrxvn-maker/casablanca/main/tools/corrigir-legenda/corrigir_legenda.py" -OutFile $dst
Write-Host "Pronto: $dst"
```

Depois disso o PC está pronto pra disparar correção de legenda.

## Uso

```powershell
# Listar os projetos do CapCut (pra achar o nome exato)
python $env:USERPROFILE\corrigir_legenda.py list

# Ver a legenda atual de um projeto
python $env:USERPROFILE\corrigir_legenda.py inspect --draft "NOME DO PROJETO"

# Corrigir a legenda pela copy.txt  (CapCut FECHADO)
python $env:USERPROFILE\corrigir_legenda.py corrigir --draft "NOME DO PROJETO" --copy "C:\caminho\copy.txt"
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
