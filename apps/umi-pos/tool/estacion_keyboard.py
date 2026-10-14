#!/usr/bin/env python3
"""Envía una entrada sólo al POS de prueba con el foco verificado."""
import argparse
import json
import os
import re
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--pid', required=True, type=int)
input_group = parser.add_mutually_exclusive_group(required=True)
input_group.add_argument('--key', choices=['Tab', 'shift+Tab', 'Return', 'space', 'Escape', 'Down', 'Up', 'Home', 'End', 'Prior', 'Next', 'ctrl+a'])
input_group.add_argument('--text', help='Numeric quantity for native input verification.')
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
allowed = {
    Path('/tmp/umi-pos-n3-verify/apps/umi-pos/build/linux/x64/profile/bundle/umi_pos'),
    Path('/home/juan/Projects/umiconsulting/umi-pos-estacion/apps/umi-pos/build/linux/x64/profile/bundle/umi_pos'),
    Path('/home/juan/Projects/umiconsulting/umi/apps/umi-pos/build/linux/x64/profile/bundle/umi_pos'),
}
process = Path('/proc') / str(args.pid)
if process.joinpath('exe').resolve() not in allowed:
    raise SystemExit('El proceso debe ser la compilación de perfil aislada de Estación.')
active = json.loads(subprocess.check_output(['hyprctl', 'activewindow', '-j'], text=True))
if active.get('pid') != args.pid or active.get('title') != 'UmiPOS · Estación':
    raise SystemExit('El POS de prueba debe tener el foco antes de enviar una entrada.')
source = dict(value.split('=', 1) for value in process.joinpath('environ').read_bytes().decode().split('\0') if '=' in value)
env = dict(os.environ, DISPLAY=source['DISPLAY'])
if args.text is not None and re.fullmatch(r'[0-9.]{1,32}', args.text) is None:
    raise SystemExit('Text input must be a numeric quantity of at most 32 characters.')
command = ['xdotool', 'key', '--delay', '30', args.key] if args.key is not None else ['xdotool', 'type', '--clearmodifiers', '--delay', '30', args.text]
result = subprocess.run(command, env=env, check=True)
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps({
    'method': 'XTEST through installed xdotool; native process and compositor focus checked before input',
    'pid': args.pid, 'key': args.key, 'text': args.text, 'exit_code': result.returncode,
    'limit': 'Key dispatch is not proof of the resulting application state; inspect it separately.',
}, ensure_ascii=False, indent=2) + '\n')
print('Entrada enviada al POS con foco verificado.')
