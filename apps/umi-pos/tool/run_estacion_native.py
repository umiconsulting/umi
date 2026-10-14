#!/usr/bin/env python3
"""Ejecuta el fork con credenciales y preferencias de desarrollo aisladas."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlparse

APP = Path(__file__).resolve().parent.parent
REPO = APP.parent.parent
RUNTIME = Path(os.environ.get('ESTACION_RUNTIME_ROOT', str(APP / '.estacion-runtime'))).resolve()

def empty_workspace():
    """Reserva un workspace vacío para esta ventana del fork."""
    if not shutil.which('hyprctl') or not os.environ.get('HYPRLAND_INSTANCE_SIGNATURE'):
        raise RuntimeError('Comprueba un workspace vacío antes de abrir el POS en este escritorio')
    clients = json.loads(subprocess.check_output(['hyprctl', '-j', 'clients'], text=True))
    if any(c.get('title') == 'UmiPOS · Estación' for c in clients):
        raise RuntimeError('La ventana del fork ya está abierta')
    occupied = {c['workspace']['id'] for c in clients}
    workspace = next(n for n in range(1, 1000) if n not in occupied)
    rule = (
        'if umi_estacion_open_rule then umi_estacion_open_rule:set_enabled(false) end; '
        'umi_estacion_open_rule = hl.window_rule({'
        'name="umi-estacion-empty-workspace", '
        'match={class="[Cc]o[.]umiconsulting[.]umi_pos[.]estacion"}, '
        f'workspace="{workspace}", fullscreen=true}})'
    )
    subprocess.run(['hyprctl', 'eval', rule], check=True)
    placement = (
        'if umi_estacion_open_subscription then umi_estacion_open_subscription:remove() end; '
        'umi_estacion_open_subscription=hl.on("window.open", function(w) '
        'if string.lower(w.class or "")~="co.umiconsulting.umi_pos.estacion" then return end; '
        f'local target={workspace}; '
        'local function free(n) '
        'for _,x in pairs(hl.get_windows({workspace=tostring(n)})) do '
        'if x.pid~=w.pid then return false end end; return true end; '
        'while not free(target) and target<1000 do target=target+1 end; '
        'if target>=1000 then return end; '
        'hl.dispatch(hl.dsp.window.move({window=w,workspace=tostring(target),follow=true})); '
        'if w.fullscreen==0 then hl.dispatch(hl.dsp.window.fullscreen({window=w})) end end)'
    )
    subprocess.run(['hyprctl', 'eval', placement], check=True)
    subprocess.run(['hyprctl', 'eval', f'hl.dispatch(hl.dsp.focus({{workspace="{workspace}"}}))'], check=True)
    print(f'Workspace vacío para el fork: {workspace}', flush=True)

def stop_keyring(keyring):
    """Detén el demonio privado y recógelo. La limpieza no debe tapar el fallo real."""
    keyring.terminate()
    try:
        keyring.wait(timeout=10)
    except subprocess.TimeoutExpired:
        keyring.kill()
        keyring.wait(timeout=10)

def main():
    env = dict(os.environ)
    api_base = env.get('UMIPOS_API_BASE_URL', 'http://127.0.0.1:4013')
    runtime = RUNTIME / ('native-' + str(urlparse(api_base).port or 80))
    for key, name in [('XDG_DATA_HOME', 'data'), ('XDG_CONFIG_HOME', 'config'), ('XDG_CACHE_HOME', 'cache')]:
        folder = runtime / name
        folder.mkdir(parents=True, exist_ok=True)
        os.chmod(folder, 0o700)
        env[key] = str(folder)
    env['UMIPOS_FULLSCREEN'] = '1'
    env['UMIPOS_ESTACION_PREVIEW'] = '1'
    env['GDK_BACKEND'] = 'x11'
    env['WAYLAND_DISPLAY'] = ''
    if '--inside' not in sys.argv:
        empty_workspace()
        try:
            return subprocess.call(['dbus-run-session', '--', sys.executable, str(Path(__file__).resolve()), '--inside'], env=env)
        finally:
            subprocess.run(['hyprctl', 'eval', 'if umi_estacion_open_rule then umi_estacion_open_rule:set_enabled(false) end'], check=False)
            subprocess.run(['hyprctl', 'eval', 'if umi_estacion_open_subscription then umi_estacion_open_subscription:remove() end'], check=False)
    private_runtime = Path(tempfile.mkdtemp(prefix='estacion-4013-'))
    control = private_runtime / 'keyring'
    control.mkdir(parents=True, exist_ok=True)
    os.chmod(control, 0o700)
    os.chmod(private_runtime, 0o700)
    env['XDG_RUNTIME_DIR'] = str(private_runtime)
    env['GNOME_KEYRING_CONTROL'] = str(control)
    # Las activaciones del bus privado no pueden abrir un diálogo del escritorio.
    subprocess.run([
        'dbus-update-activation-environment', 'DISPLAY=', 'WAYLAND_DISPLAY=',
        'XDG_RUNTIME_DIR=' + str(private_runtime),
    ], env=env, check=True)
    keyring_env = dict(env, DISPLAY='', WAYLAND_DISPLAY='')
    keyring = subprocess.Popen(['gnome-keyring-daemon', '--foreground', '--unlock', '--components=secrets', '--control-directory=' + str(control)], env=keyring_env, stdin=subprocess.PIPE, text=True, stdout=subprocess.DEVNULL)
    keyring.stdin.write('\n')
    keyring.stdin.close()
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if keyring.poll() is not None:
            raise RuntimeError('El servicio privado de credenciales terminó')
        ready = subprocess.check_output(['gdbus', 'call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.freedesktop.secrets'], env=env, text=True)
        if 'true' in ready:
            break
        time.sleep(.05)
    else:
        stop_keyring(keyring)
        raise RuntimeError('El servicio privado de credenciales no respondió')
    subprocess.run(['secret-tool', 'store', '--label=estacion-preflight', 'app', 'estacion-preflight'], input='probe\n', env=env, text=True, check=True, timeout=10, stdout=subprocess.DEVNULL)
    result = subprocess.check_output(['secret-tool', 'lookup', 'app', 'estacion-preflight'], env=env, text=True, timeout=10).strip()
    subprocess.run(['secret-tool', 'clear', 'app', 'estacion-preflight'], env=env, check=True, timeout=10)
    if result != 'probe':
        raise RuntimeError('El proveedor aislado no conserva el dato de prueba')
    print('Almacén de desarrollo aislado: verificado', flush=True)
    accessibility = registry = None
    if env.get('ESTACION_ATSPI', '0') == '1':
        # AT-SPI's systemd activation belongs to the user's desktop. These two
        # processes belong to the private session and stop with this launcher.
        accessibility = subprocess.Popen(
            ['/usr/lib/at-spi-bus-launcher', '--launch-immediately', '--a11y=1'],
            env=env, stdout=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            owned = subprocess.check_output([
                'gdbus', 'call', '--session', '--dest', 'org.freedesktop.DBus',
                '--object-path', '/org/freedesktop/DBus', '--method',
                'org.freedesktop.DBus.NameHasOwner', 'org.a11y.Bus',
            ], env=env, text=True)
            if 'true' in owned:
                break
            time.sleep(.05)
        else:
            stop_keyring(accessibility)
            stop_keyring(keyring)
            raise RuntimeError('El bus privado de accesibilidad no respondió')
        import ast
        address = ast.literal_eval(subprocess.check_output([
            'gdbus', 'call', '--session', '--dest', 'org.a11y.Bus',
            '--object-path', '/org/a11y/bus', '--method', 'org.a11y.Bus.GetAddress',
        ], env=env, text=True))[0]
        if str(private_runtime) not in address:
            stop_keyring(accessibility)
            stop_keyring(keyring)
            raise RuntimeError('La accesibilidad debe usar el directorio privado')
        env['AT_SPI_BUS_ADDRESS'] = address
        registry = subprocess.Popen(
            ['/usr/lib/at-spi2-registryd'], env=env, stdout=subprocess.DEVNULL,
        )
        print('Bus privado de accesibilidad: preparado', flush=True)
    contract = json.loads((REPO / 'packages/contract/generated/contract.json').read_text())['contractVersion']
    flutter = os.environ.get('FLUTTER_BIN', str(Path.home() / '.local/opt/flutter/bin/flutter'))
    mode = env.get('ESTACION_BUILD_MODE', 'debug')
    if mode not in {'debug', 'profile', 'release'}:
        raise ValueError('ESTACION_BUILD_MODE debe ser debug, profile o release')
    instrumented = env.get('ESTACION_DRIVER', '0') == '1'
    if mode == 'release' and instrumented:
        raise ValueError('La extensión de pruebas no se incluye en release')
    target = 'test_driver/driver_main.dart' if instrumented else 'lib/main.dart'
    command = [flutter, 'run', '-d', 'linux', '--' + mode, '-t', target]
    defines = {'UMIPOS_ENVIRONMENT':'development', 'UMIPOS_API_BASE_URL':api_base, 'UMIPOS_DEVELOPMENT_DIAGNOSTICS':'true', 'UMIPOS_FEATURE_BOOTSTRAP':'disabled', 'UMIPOS_HARDWARE_SIMULATOR_ENABLED':'true', 'UMIPOS_RELEASE_VERSION':'0.1.0', 'UMIPOS_CONTRACT_VERSION':contract, 'UMIPOS_CONFIG_SCHEMA_VERSION':'1'}
    command += ['--dart-define=' + key + '=' + value for key, value in defines.items()]
    try:
        return subprocess.call(command, cwd=APP, env=env)
    finally:
        if registry is not None:
            stop_keyring(registry)
        if accessibility is not None:
            stop_keyring(accessibility)
        stop_keyring(keyring)
        shutil.rmtree(private_runtime, ignore_errors=True)

if __name__ == '__main__':
    sys.exit(main())
