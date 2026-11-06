"""Genera QR de ejemplo para una dirección local o de red explícita."""
import argparse
from pathlib import Path
import qrcode
import qrcode.image.svg

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:56456')
args = parser.parse_args()
if not args.base_url.startswith(('http://', 'https://')):
    parser.error('La dirección debe comenzar con http:// o https://')
out = Path(__file__).resolve().parent / 'qr'
out.mkdir(exist_ok=True)
for table in (1, 2, 12):
    qr = qrcode.make(f'{args.base_url.rstrip("/")}/?mesa={table}', image_factory=qrcode.image.svg.SvgPathImage)
    qr.save(out / f'mesa-{table}.svg')
print(f'QR generados para {args.base_url}')
