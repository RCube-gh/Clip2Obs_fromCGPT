"""
アイコン画像を 16x16, 48x48, 128x128 にリサイズして
extension/icons/ に保存するスクリプト
"""
from PIL import Image
import os
import sys

src = sys.argv[1]  # 元画像のパス
out_dir = os.path.join(os.path.dirname(src), "extension", "icons")
os.makedirs(out_dir, exist_ok=True)

img = Image.open(src).convert("RGBA")
for size in [16, 48, 128]:
    resized = img.resize((size, size), Image.LANCZOS)
    path = os.path.join(out_dir, f"icon{size}.png")
    resized.save(path, "PNG")
    print(f"Saved: {path}")
print("Done!")
