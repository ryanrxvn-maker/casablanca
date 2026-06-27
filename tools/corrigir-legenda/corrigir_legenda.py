"""CORRIGIR LEGENDA (standalone) — corrige a GRAFIA da auto-legenda do
CapCut pela copy.txt, sem perder o que foi falado e mantendo o timing.

Self-contained: SÓ usa a biblioteca padrão do Python (json, re, difflib,
unicodedata, shutil). NÃO precisa do VectCutAPI, ffmpeg, pip ou venv.

Fluxo:
  1. No CapCut você gera a AUTO-LEGENDA (timing perfeito, texto = ASR do
     que foi REALMENTE falado). Salva e FECHA o CapCut.
  2. Esta tool duplica o projeto e corrige só a grafia das palavras que
     casam com a copy.txt (0 erro onde o roteiro bate), preservando os
     tempos E os improvisos do avatar (palavras fora da copy ficam como
     foram faladas). Mantém o tipo 'subtitle' nativo -> modelos /
     animações / "aplicar a todos" do CapCut continuam funcionando.

O ORIGINAL nunca é alterado. CapCut deve estar FECHADO ao rodar.

Uso:
  python corrigir_legenda.py list
  python corrigir_legenda.py inspect --draft "NOME DO PROJETO"
  python corrigir_legenda.py corrigir --draft "NOME DO PROJETO" --copy "C:\\caminho\\copy.txt"
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import shutil
import sys
import time
import unicodedata

CAPCUT_DRAFTS = os.path.join(
    os.environ.get("LOCALAPPDATA", ""),
    "CapCut", "User Data", "Projects", "com.lveditor.draft",
)


def _root() -> str:
    if not os.path.isdir(CAPCUT_DRAFTS):
        raise FileNotFoundError(
            f"drafts do CapCut nao encontrados: {CAPCUT_DRAFTS}\n"
            "Abra o CapCut ao menos uma vez para criar a pasta de projetos."
        )
    return CAPCUT_DRAFTS


def read_copy(path: str) -> str:
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            with open(path, "r", encoding=enc) as f:
                return f.read()
        except UnicodeDecodeError:
            continue
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def _words(copy_text: str) -> list[str]:
    return re.sub(r"\s+", " ", copy_text.strip()).split(" ")


def _norm(w: str) -> str:
    w = unicodedata.normalize("NFKD", w.lower())
    w = "".join(c for c in w if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", w)


def _spelling_correct(seg_texts: list[str], copy_words: list[str]) -> list[str]:
    """Corrige a grafia das legendas existentes (texto ASR, na ordem
    falada) usando a copy: onde a palavra falada casa com a copy, troca
    pela grafia da copy; o que nao casa (improviso do avatar) FICA como
    foi falado. Mantem o n de palavras de cada legenda (timing intacto)."""
    seg_words = [t.split() for t in seg_texts]
    flat = [w for ws in seg_words for w in ws]
    if not flat or not copy_words:
        return seg_texts
    na = [_norm(w) for w in flat]
    nc = [_norm(w) for w in copy_words]
    disp = list(flat)
    sm = difflib.SequenceMatcher(None, na, nc, autojunk=False)
    for ai, ci, size in sm.get_matching_blocks():
        for k in range(size):
            if _norm(copy_words[ci + k]):   # ignora tokens so-pontuacao
                disp[ai + k] = copy_words[ci + k]
    out, idx = [], 0
    for ws in seg_words:
        n = len(ws)
        out.append(" ".join(disp[idx:idx + n]))
        idx += n
    return out


def _subtitle_track(j: dict):
    """Escolhe a track de auto-legenda: a track de texto com mais
    segmentos cujos materiais sao type=='subtitle'."""
    texts = {m["id"]: m for m in j.get("materials", {}).get("texts", [])}
    best, best_n = None, -1
    for t in j.get("tracks", []):
        if t.get("type") != "text":
            continue
        segs = t.get("segments", [])
        n_sub = sum(
            1 for s in segs
            if texts.get(s.get("material_id"), {}).get("type") == "subtitle"
        )
        if n_sub > best_n:
            best, best_n = t, n_sub
    return best, best_n


def _draft_content_path(draft_name: str) -> str:
    dc = os.path.join(_root(), draft_name, "draft_content.json")
    if not os.path.isfile(dc):
        raise FileNotFoundError(f"draft '{draft_name}' nao encontrado")
    return dc


def list_drafts() -> dict:
    root = _root()
    out = []
    for name in sorted(os.listdir(root)):
        if os.path.isfile(os.path.join(root, name, "draft_content.json")):
            out.append(name)
    return {"drafts_root": root, "count": len(out), "drafts": out}


def inspect(draft_name: str) -> dict:
    j = json.load(open(_draft_content_path(draft_name), encoding="utf-8"))
    texts = {m["id"]: m for m in j.get("materials", {}).get("texts", [])}
    track, n = _subtitle_track(j)
    if not track or n <= 0:
        return {"draft": draft_name, "subtitle_segments": 0,
                "hint": "Gere a auto-legenda no CapCut antes."}
    segs = sorted(track["segments"],
                  key=lambda s: s.get("target_timerange", {}).get("start", 0))
    sample = []
    for s in segs[:6]:
        m = texts.get(s["material_id"], {})
        try:
            txt = json.loads(m.get("content", "{}")).get("text", "")
        except Exception:
            txt = ""
        tr = s.get("target_timerange", {})
        sample.append({"t": round(tr.get("start", 0) / 1e6, 2),
                       "dur": round(tr.get("duration", 0) / 1e6, 2),
                       "txt": txt})
    return {"draft": draft_name, "subtitle_segments": len(segs),
            "sample": sample}


def _set_text(material: dict, new_text: str) -> None:
    """Reescreve SO o texto, minimamente invasivo: mantem o tipo
    'subtitle', todos os estilos e a estrutura (p/ 'aplicar a todos',
    templates e animacoes do CapCut continuarem funcionando).
    Ajusta os ranges de estilo p/ o novo tamanho e recalcula os
    tempos das palavras (words) proporcionalmente."""
    n = len(new_text)
    try:
        c = json.loads(material.get("content", "{}"))
    except Exception:
        c = {}
    old = c.get("text", "")
    c["text"] = new_text
    for st in (c.get("styles") or []):
        r = st.get("range") or [0, len(old) or n]
        a = 0 if r[0] <= 0 else min(r[0], n)
        b = n if r[1] >= (len(old) or n) else min(r[1], n)
        st["range"] = [a, max(a, b)]
    material["content"] = json.dumps(c, ensure_ascii=False)
    if "recognize_text" in material:
        material["recognize_text"] = new_text
    nws = new_text.split()
    for key in ("words", "current_words"):
        w = material.get(key)
        if not isinstance(w, dict) or not w.get("text"):
            continue
        st = w.get("start_time") or []
        et = w.get("end_time") or []
        if st and et:
            t0, t1 = st[0], et[-1]
            k = len(nws)
            step = (t1 - t0) / max(1, k)
            w["text"] = nws
            w["start_time"] = [int(t0 + i * step) for i in range(k)]
            w["end_time"] = [int(t0 + (i + 1) * step) for i in range(k)]
        else:
            w["text"] = nws


def corrigir(draft_name: str, copy_txt: str,
             out_name: str | None = None) -> dict:
    root = _root()
    src = os.path.join(root, draft_name)
    dc0 = os.path.join(src, "draft_content.json")
    if not os.path.isfile(dc0):
        raise FileNotFoundError(f"draft '{draft_name}' nao encontrado")
    if not os.path.isfile(copy_txt):
        raise FileNotFoundError(f"copy.txt nao encontrado: {copy_txt}")

    j = json.load(open(dc0, encoding="utf-8"))
    track, n = _subtitle_track(j)
    if not track or n <= 0:
        raise RuntimeError(
            "nenhuma track de auto-legenda encontrada. Gere a legenda "
            "automatica no CapCut primeiro, salve e feche o CapCut.")

    out_name = out_name or f"{draft_name} - LEGENDA OK"
    dst = os.path.join(root, out_name)
    if os.path.isdir(dst):
        out_name = f"{out_name} {int(time.time())}"
        dst = os.path.join(root, out_name)
    shutil.copytree(src, dst)

    dc = os.path.join(dst, "draft_content.json")
    j = json.load(open(dc, encoding="utf-8"))
    track, _ = _subtitle_track(j)
    texts = {m["id"]: m for m in j.get("materials", {}).get("texts", [])}
    segs = sorted(track["segments"],
                  key=lambda s: s.get("target_timerange", {}).get("start", 0))

    copy_words = _words(read_copy(copy_txt))
    seg_texts = []
    for s in segs:
        m = texts.get(s["material_id"], {})
        try:
            seg_texts.append(json.loads(m.get("content", "{}")).get("text", ""))
        except Exception:
            seg_texts.append("")

    new_lines = _spelling_correct(seg_texts, copy_words)
    changed = 0
    for s, old_t, nt in zip(segs, seg_texts, new_lines):
        m = texts.get(s["material_id"])
        if m and nt and nt != old_t:
            _set_text(m, nt.upper())
            changed += 1

    json.dump(j, open(dc, "w", encoding="utf-8"), ensure_ascii=False)
    return {
        "original": draft_name,
        "new_draft": out_name,
        "new_draft_path": dst,
        "segments_corrigidos": changed,
        "palavras_copy": len(copy_words),
        "obs": "Timing 100% do CapCut. Abra o CapCut, revise o projeto "
               f"'{out_name}' e exporte.",
    }


def _emit(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="corrigir_legenda",
        description="Corrige a grafia da auto-legenda do CapCut pela copy.txt.")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="lista os projetos do CapCut")

    pi = sub.add_parser("inspect", help="mostra a legenda atual do projeto")
    pi.add_argument("--draft", required=True)

    pc = sub.add_parser("corrigir", help="corrige a legenda pela copy.txt")
    pc.add_argument("--draft", required=True)
    pc.add_argument("--copy", required=True, help="caminho do copy.txt")
    pc.add_argument("--out-name", default=None,
                    help="nome do projeto de saida (default: '<draft> - LEGENDA OK')")

    args = p.parse_args(argv)
    try:
        if args.cmd == "list":
            _emit(list_drafts())
        elif args.cmd == "inspect":
            _emit(inspect(args.draft))
        elif args.cmd == "corrigir":
            _emit(corrigir(args.draft, args.copy, args.out_name))
    except Exception as e:
        _emit({"erro": str(e)})
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
