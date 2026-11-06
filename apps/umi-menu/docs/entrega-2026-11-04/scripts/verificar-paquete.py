#!/usr/bin/env python3
"""Comprueba los archivos del manifiesto SHA256SUMS de esta entrega."""
from pathlib import Path
import hashlib
import sys

root = Path(__file__).resolve().parents[1]
manifest = root / 'SHA256SUMS'
if not manifest.is_file():
    raise SystemExit('Falta SHA256SUMS. Usa el paquete completo.')
errors = []
count = 0
for line in manifest.read_text().splitlines():
    digest, relative = line.split('  ', 1)
    target = root / relative
    if not target.resolve().is_relative_to(root):
        errors.append('Ruta fuera del paquete: ' + relative)
        continue
    if not target.is_file():
        errors.append('Falta: ' + relative)
        continue
    actual = hashlib.sha256(target.read_bytes()).hexdigest()
    if actual != digest:
        errors.append('Cambió: ' + relative)
    count += 1
if errors:
    print('\n'.join(errors))
    sys.exit(1)
print(f'Integridad correcta: {count} archivos coinciden con SHA256SUMS.')
