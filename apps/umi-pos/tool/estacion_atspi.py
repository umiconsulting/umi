#!/usr/bin/env python3
"""Inspect the Estación preview through its private AT-SPI bus."""
import argparse
import json
import os
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--pid', type=int, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--activate', help='Exact accessible name of one visible enabled action')
parser.add_argument('--action', choices=['Tap', 'Focus'], default='Tap')
args = parser.parse_args()
process = Path('/proc') / str(args.pid)
allowed = {
    Path('/tmp/umi-pos-n3-verify/apps/umi-pos/build/linux/x64/profile/bundle/umi_pos'),
    Path('/home/juan/Projects/umiconsulting/umi-pos-estacion/apps/umi-pos/build/linux/x64/profile/bundle/umi_pos'),
    Path('/home/juan/Projects/umiconsulting/umi/apps/umi-pos/build/linux/x64/profile/bundle/umi_pos'),
}
if process.joinpath('exe').resolve() not in allowed:
    raise SystemExit('The process must be the isolated Estación profile build.')
environment = dict(
    value.split('=', 1)
    for value in process.joinpath('environ').read_bytes().decode().split('\0')
    if '=' in value
)
address = environment.get('AT_SPI_BUS_ADDRESS', '')
if environment.get('XDG_RUNTIME_DIR', 'missing') not in address:
    raise SystemExit('Relaunch this fork with ESTACION_ATSPI=1 for a private accessibility bus.')
for key in ['DBUS_SESSION_BUS_ADDRESS', 'DISPLAY', 'XDG_RUNTIME_DIR', 'AT_SPI_BUS_ADDRESS']:
    if key in environment:
        os.environ[key] = environment[key]

import gi  # noqa: E402
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi  # noqa: E402

Atspi.set_timeout(1000, 2000)
desktop = Atspi.get_desktop(0)
application = None
for index in range(desktop.get_child_count()):
    candidate = desktop.get_child_at_index(index)
    if candidate.get_process_id() == args.pid:
        application = candidate
        break
if application is None:
    raise SystemExit('The isolated process is absent from its accessibility bus.')

nodes = []
actions = []
def visit(accessible, depth=0):
    if depth > 18 or len(nodes) >= 1200:
        return
    name = accessible.get_name()
    state_set = accessible.get_state_set()
    states = [value.value_nick for value in state_set.get_states()]
    action = accessible.get_action_iface()
    action_names = []
    if action is not None:
        action_names = [action.get_action_name(i) for i in range(action.get_n_actions())]
        if (name == args.activate and action.get_n_actions() > 0
                and state_set.contains(Atspi.StateType.ENABLED)
                and state_set.contains(Atspi.StateType.SHOWING)):
            indexes = [i for i, value in enumerate(action_names) if value == args.action]
            if len(indexes) == 1:
                actions.append((action, indexes[0]))
    nodes.append({
        'depth': depth, 'name': name, 'role': accessible.get_role_name(),
        'states': states, 'actions': action_names,
    })
    for index in range(accessible.get_child_count()):
        visit(accessible.get_child_at_index(index), depth + 1)

visit(application)
result = {
    'method': 'External AT-SPI client; GI Atspi 2.0; private app bus; exact process filter',
    'pid': args.pid, 'nodes': nodes,
    'limits': 'Bridge inspection, not a spoken screen-reader or complete keyboard task.',
}
if args.activate:
    if len(actions) != 1:
        raise SystemExit(f'Expected one visible enabled action, found {len(actions)}.')
    action, index = actions[0]
    result['activation'] = {'name': args.activate, 'action': args.action, 'accepted': action.do_action(index)}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'nodes': len(nodes), 'saved': str(args.output), 'activation': result.get('activation')}, ensure_ascii=False))
