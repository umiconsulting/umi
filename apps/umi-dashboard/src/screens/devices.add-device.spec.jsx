import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { withI18n } from '@/test/i18n.jsx';
import { AddDevicePanel } from './devices.jsx';

/**
 * ONE FORM FOR BOTH JOBS.
 *
 * The panel used to branch: UmiPOS created an enrolment request, and UmiKDS minted a
 * legacy iPad pairing PIN whose device this app cannot even start on. A person setting
 * up a kitchen tablet picked the honest option and got a device that would never work.
 * What this proves is the absence of that second machine — no PIN, no station, and the
 * same code button whichever product is chosen.
 */
const render = (products = { kds: true, pos: true }) =>
  renderToStaticMarkup(
    withI18n(
      <AddDevicePanel
        onClose={() => {}}
        products={products}
        locations={[{ id: 'loc-1', name: 'Chapultepec' }]}
        branchId="loc-1"
        onBranchChange={() => {}}
        onProvisioned={() => {}}
      />,
    ),
  );

describe('Añadir dispositivo', () => {
  it('ofrece el código de registro y no el pareo viejo de iPad', () => {
    const markup = render();
    expect(markup).toContain('Crear código');
    expect(markup).not.toContain('Generar PIN');
    expect(markup).not.toContain('Estación asignada');
    expect(markup).not.toContain('iPad');
  });

  // The product picker renders only the option already chosen, so the KDS choice shows
  // itself here — by name, by the placeholder the name field suggests, and by the fields
  // the request needs.
  it('pide nombre, plataforma y modalidad para el KDS', () => {
    const markup = render();
    expect(markup).toContain('UmiKDS');
    expect(markup).toContain('Nombre del dispositivo');
    expect(markup).toContain('placeholder="Cocina"');
    expect(markup).toContain('Plataforma');
    expect(markup).toContain('Modalidad');
  });

  // Android is the default platform on purpose: a browser build is refused as a
  // production POS, so a Web default hands the person a device that cannot work.
  it('propone Android', () => {
    expect(render()).toContain('Android');
  });
});
