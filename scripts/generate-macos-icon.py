#!/usr/bin/env python3
"""
Generate a macOS .icns file with proper padding for dock icon sizing.

macOS (Big Sur+) expects app icons to have ~100px transparent padding on all
sides of a 1024x1024 canvas, with artwork occupying ~80% (~824x824). Tauri's
icon generator fills the entire canvas, making icons appear larger than native
apps in the dock.

This script adds the required padding and generates a properly formatted .icns
file using macOS's built-in iconutil.
"""

import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Pillow is required. Install with: pip3 install Pillow")
    sys.exit(1)

# macOS icon spec (Big Sur+)
CANVAS_SIZE = 1024
CONTENT_SIZE = 824  # ~80% of canvas
PADDING = (CANVAS_SIZE - CONTENT_SIZE) // 2  # 100px

# Required .iconset sizes: (filename, pixel size)
ICONSET_SIZES = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]


def create_padded_icon(source_path: Path) -> Image.Image:
    """Create a 1024x1024 icon with proper macOS padding."""
    source = Image.open(source_path).convert("RGBA")

    # Resize artwork to fit within the content area
    artwork = source.resize((CONTENT_SIZE, CONTENT_SIZE), Image.LANCZOS)

    # Create transparent canvas and center the artwork
    canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    canvas.paste(artwork, (PADDING, PADDING))

    return canvas


def generate_icns(padded_icon: Image.Image, output_path: Path) -> None:
    """Generate .icns file from padded icon using iconutil."""
    with tempfile.TemporaryDirectory() as tmpdir:
        iconset_dir = Path(tmpdir) / "icon.iconset"
        iconset_dir.mkdir()

        for filename, size in ICONSET_SIZES:
            resized = padded_icon.resize((size, size), Image.LANCZOS)
            resized.save(iconset_dir / filename, "PNG")

        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset_dir), "-o", str(output_path)],
            check=True,
        )


def main():
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    icons_dir = project_root / "src-tauri" / "icons"

    source_icon = icons_dir / "icon.png"
    output_icns = icons_dir / "icon.icns"

    if not source_icon.exists():
        print(f"Source icon not found: {source_icon}")
        sys.exit(1)

    print(f"Source: {source_icon}")
    print(
        f"Adding {PADDING}px padding ({CONTENT_SIZE}px content in {CANVAS_SIZE}px canvas)"
    )

    padded = create_padded_icon(source_icon)
    generate_icns(padded, output_icns)

    print(f"Generated: {output_icns}")


if __name__ == "__main__":
    main()
