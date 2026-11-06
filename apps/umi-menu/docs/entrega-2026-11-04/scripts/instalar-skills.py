#!/usr/bin/env python3
"""Copia skills seleccionadas sin sobrescribir instalaciones existentes."""
from pathlib import Path
import argparse
import shutil

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dest', type=Path, required=True, help='Directorio .agents/skills de destino')
parser.add_argument('names', nargs='+', help='Nombres de skills de usadas/ o apoyo/')
args = parser.parse_args()
available = {
    p.name: p
    for group in ['usadas', 'apoyo']
    for p in (root / 'skills' / group).iterdir()
    if p.is_dir() and (p / 'SKILL.md').is_file()
}
if len(args.names) != len(set(args.names)):
    parser.error('No repitas nombres de skills.')
for name in args.names:
    if name not in available:
        parser.error('Skill desconocida: ' + name + '. Disponibles: ' + ', '.join(sorted(available)))
    target = args.dest.expanduser() / name
    if target.exists() or target.is_symlink():
        parser.error('Ya existe; no se sobrescribe: ' + str(target))
args.dest.expanduser().mkdir(parents=True, exist_ok=True)
for name in args.names:
    target = args.dest.expanduser() / name
    shutil.copytree(available[name], target)
    print('Copiada:', name, '->', target)
print('No se ejecutaron scripts ni se modificó la configuración de Codex.')
