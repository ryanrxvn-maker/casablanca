"""
Gera os .ico dos instaladores a partir do PNG do coelho Auto Edit
usado pelas extensões. Mesmo arte que aparece em chrome://extensions
e no favicon, agora também no ícone dos .exe instaladores.

Roda manualmente quando o ícone do coelho mudar:
    python scripts/build-installer-icons.py

Targets:
  engine/installer/icon.ico              → AutoEditDownloaderSetup.exe
  engine/subtitle-remover-pkg/darko-icon.ico → AutoEditSmartRemoverSetup.exe
"""

from pathlib import Path
from PIL import Image


SOURCE_PNG = Path("extension/icons/icon-128.png")

# Tamanhos que o Windows usa: 16/32/48 pra explorer/tray,
# 64/128/256 pra "ícone grande" no Vista+, alta-DPI.
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

TARGETS = [
    Path("engine/installer/icon.ico"),
    Path("engine/subtitle-remover-pkg/darko-icon.ico"),
]


def build_ico(src_png: Path, dst_ico: Path) -> None:
    if not src_png.exists():
        raise FileNotFoundError(f"PNG fonte não existe: {src_png}")
    base = Image.open(src_png).convert("RGBA")
    # Upscale 128→256 lanczos pra não ficar pixelado em telas 4K
    base_256 = base.resize((256, 256), Image.LANCZOS)
    dst_ico.parent.mkdir(parents=True, exist_ok=True)
    base_256.save(
        dst_ico,
        format="ICO",
        sizes=ICO_SIZES,
        bitmap_format="bmp",  # padrão Windows
    )
    print(f"[OK] {dst_ico} ({dst_ico.stat().st_size} bytes)")


def main() -> None:
    print(f"Fonte: {SOURCE_PNG}")
    for dst in TARGETS:
        build_ico(SOURCE_PNG, dst)
    print(f"\nPronto — {len(TARGETS)} .ico gerados.")


if __name__ == "__main__":
    main()
