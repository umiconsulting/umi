"""Build the Windows ICO with Pillow. Read PNG bytes from stdin."""
import io
import sys
import PIL
from PIL import Image

if PIL.__version__ != "12.2.0":
    raise RuntimeError("Use Pillow 12.2.0")
image = Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGBA")
destination = io.BytesIO()
image.save(destination, format="ICO", sizes=[(n, n) for n in (16, 24, 32, 48, 64, 128, 256)])
sys.stdout.buffer.write(destination.getvalue())
