import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { withI18n } from '@/test/i18n.jsx';
import { HardwareCard } from './devices.jsx';

/**
 * THE PRINTERS ARE INVENTORY.
 *
 * Until this card, the only reader of `merchant.hardware_device` was the till's own
 * hardware centre, so "which printer serves the counter?" could only be answered by
 * walking to the till. What these assertions pin is that the back office states the
 * hardware the way an inventory does — the model a person recognises, the type, how it
 * connects, and which register it serves, resolved to a NAME rather than an id.
 */
const printer = (overrides = {}) => ({
  id: 'hw-1',
  locationId: 'loc-1',
  type: 'printer',
  manufacturer: 'Epson',
  model: 'TM-T20IIIL',
  publicReference: 'usb-04b8-0e27',
  transport: 'usb_foundation',
  capabilities: ['printer.receipt'],
  enabled: true,
  connectionState: 'connected',
  registerName: 'Caja 1',
  assignedDeviceName: 'Caja mostrador',
  lastHeartbeatAt: null,
  lastDiagnosticAt: null,
  createdAt: '2026-10-07T23:08:07.167Z',
  ...overrides,
});

const render = (devices, now = Date.now()) =>
  renderToStaticMarkup(withI18n(<HardwareCard devices={devices} now={now} />));

describe('Hardware del negocio', () => {
  it('lista la impresora con su modelo, su conexión y a quién sirve', () => {
    // A state is only shown as the present when a probe said so recently.
    const now = Date.now();
    const markup = render([printer({ lastDiagnosticAt: new Date(now).toISOString() })], now);
    expect(markup).toContain('Epson TM-T20IIIL');
    expect(markup).toContain('Impresora');
    expect(markup).toContain('Conectado');
    expect(markup).toContain('USB');
    expect(markup).toContain('usb-04b8-0e27');
    // The register by NAME. An id answers nothing to the person taking inventory.
    expect(markup).toContain('Caja 1');
  });

  /**
   * A CLAIM WITH NO AGE IS NOT A STATE.
   *
   * `connection_state` is written by whoever last probed the device — a till, days
   * ago, maybe from a different terminal — and this card used to render it as "the
   * state right now". The owner found the consequence on 2026-10-11: a printer that
   * was switched off read "Conectado". Past the freshness window the card says when
   * it was last seen and leaves the verdict open.
   */
  it('no presenta una medición vieja como el estado de ahora', () => {
    const now = Date.now();
    const threeHoursAgo = new Date(now - 3 * 60 * 60 * 1000).toISOString();
    const markup = render([printer({ lastDiagnosticAt: threeHoursAgo })], now);
    expect(markup).not.toContain('Conectado');
    expect(markup).toMatch(/Sin verificar/);
    expect(markup).toMatch(/hace 3 h/);

    const never = render([printer()], now);
    expect(never).not.toContain('Conectado');
    expect(never).toContain('Sin verificar');
  });

  it('cae al dispositivo cuando el hardware no está atado a una caja', () => {
    const markup = render([printer({ registerName: null })]);
    expect(markup).toContain('Caja mostrador');
  });

  // A cash drawer is a different kind of thing with a different label, and the list must
  // say which is which — that is the whole point of an inventory.
  it('nombra cada tipo de hardware', () => {
    const markup = render([
      printer({ id: 'hw-2', type: 'cash_drawer', model: 'CD-410', registerName: null }),
    ]);
    expect(markup).toContain('Cajón de dinero');
  });

  it('dice que no hay nada en vez de callarse', () => {
    expect(render([])).toContain('No hay impresoras ni periféricos registrados');
  });
});
