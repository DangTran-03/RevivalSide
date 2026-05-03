#!/usr/bin/env python3
"""
Create display-correct 16:9 PNGs for extracted CounterSide cutscene backgrounds.

The raw Unity cutscene background textures are square, usually 1024x1024. The
game shows them inside a widescreen cutscene UI, so opening the extracted PNG
directly makes the art look squeezed. This tool keeps the raw export untouched
and writes derived copies under each bundle's CutsceneBG16x9 folder.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

try:
    from PIL import Image
except ImportError as exc:
    raise SystemExit("Pillow is required: pip install pillow") from exc


TARGET_SIZE = (1920, 1080)
LANCZOS = getattr(Image.Resampling, "LANCZOS", Image.LANCZOS)


def is_cutscene_bg_bundle(path: Path) -> bool:
    return path.name.lower().startswith("ab_ui_nkm_ui_cutscen_bg")


def image_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        return image.size


def convert_image(source: Path, output: Path, target_size: tuple[int, int]) -> dict[str, Any]:
    with Image.open(source) as image:
        source_size = image.size
        resized = image.resize(target_size, LANCZOS)
        output.parent.mkdir(parents=True, exist_ok=True)
        temp_output = output.with_name(f"{output.name}.tmp")
        resized.save(temp_output, format="PNG")
        try:
            temp_output.replace(output)
        except PermissionError:
            if output.exists():
                try:
                    if image_size(output) == target_size:
                        temp_output.unlink(missing_ok=True)
                        return {
                            "source": str(source),
                            "output": str(output),
                            "source_size": list(source_size),
                            "size": list(target_size),
                            "skipped": True,
                            "reason": "existing output was locked but already correct",
                        }
                except Exception:
                    pass
            if output.exists():
                output.unlink()
            temp_output.replace(output)

    return {
        "source": str(source),
        "output": str(output),
        "source_size": list(source_size),
        "size": list(target_size),
    }


def iter_cutscene_bg_images(root: Path, source_kind: str) -> list[Path]:
    images: list[Path] = []
    for bundle_dir in root.rglob("ab_ui_nkm_ui_cutscen_bg*"):
        if not bundle_dir.is_dir() or not is_cutscene_bg_bundle(bundle_dir):
            continue
        source_dir = bundle_dir / source_kind
        if source_dir.is_dir():
            images.extend(sorted(source_dir.glob("*.png")))
    return images


def parse_size(raw: str) -> tuple[int, int]:
    normalized = raw.lower().replace("x", ",")
    parts = [part.strip() for part in normalized.split(",") if part.strip()]
    if len(parts) != 2:
        raise argparse.ArgumentTypeError("size must look like 1920x1080")
    width, height = int(parts[0]), int(parts[1])
    if width <= 0 or height <= 0:
        raise argparse.ArgumentTypeError("size values must be positive")
    return width, height


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path("extracted-assets/all"),
        help="Root of extracted assets",
    )
    parser.add_argument(
        "--source-kind",
        default="Sprite",
        choices=("Sprite", "Texture2D"),
        help="Which raw export folder to read from",
    )
    parser.add_argument(
        "--out-folder",
        default="CutsceneBG16x9",
        help="Derived output folder name below each cutscene background bundle",
    )
    parser.add_argument(
        "--size",
        type=parse_size,
        default=TARGET_SIZE,
        help="Output dimensions, default 1920x1080",
    )
    parser.add_argument("--dry-run", action="store_true", help="Report work without writing PNGs")
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip outputs that already exist with the requested size",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        help="Manifest path; defaults to cutscene-bg-16x9-manifest.json under root",
    )
    args = parser.parse_args()

    root = args.root.resolve()
    if not root.exists():
        raise FileNotFoundError(root)

    entries: list[dict[str, Any]] = []
    for source in iter_cutscene_bg_images(root, args.source_kind):
        bundle_dir = source.parent.parent
        output = bundle_dir / args.out_folder / source.name
        if args.skip_existing and output.exists():
            try:
                if image_size(output) == args.size:
                    temp_output = output.with_name(f"{output.name}.tmp")
                    if temp_output.exists():
                        temp_output.unlink()
                    entries.append(
                        {
                            "source": str(source),
                            "output": str(output),
                            "source_size": list(image_size(source)),
                            "size": list(args.size),
                            "skipped": True,
                        }
                    )
                    continue
            except Exception:
                pass
        if args.dry_run:
            source_size = image_size(source)
            entries.append(
                {
                    "source": str(source),
                    "output": str(output),
                    "source_size": list(source_size),
                    "size": list(args.size),
                }
            )
        else:
            entries.append(convert_image(source, output, args.size))

    manifest = args.manifest.resolve() if args.manifest else root / "cutscene-bg-16x9-manifest.json"
    payload = {
        "root": str(root),
        "source_kind": args.source_kind,
        "out_folder": args.out_folder,
        "size": list(args.size),
        "file_count": len(entries),
        "files": entries,
    }
    if not args.dry_run:
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    action = "would write" if args.dry_run else "wrote"
    print(f"{action} {len(entries)} cutscene background(s)")
    print(f"manifest: {manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
