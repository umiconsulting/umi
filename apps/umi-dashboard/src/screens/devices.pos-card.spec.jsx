import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EditPosDevicePanel, PosDeviceCard } from './devices.jsx';
import { posDeviceCard } from './device-utils.js';

const locations = [{ id: 'loc-1', name: 'Chapultepec' }];

const render = (overrides = {}) =>
  renderToStaticMarkup(
    <PosDeviceCard
      device={posDeviceCard(
        {
          id: 'dev-1',
          publicId: '6108ac30-4860-469a-b07f-8b94eed6a58e',
          displayName: 'zaza',
          platform: 'web',
          mobility: 'static',
          locationId: 'loc-1',
          state: 'active',
          rotationRequired: false,
          credentialVersion: 1,
          lastSeenAt: null,
          ...overrides,
        },
        locations,
      )}
      onEdit={() => {}}
    />,
  );

describe('Tarjeta de caja UmiPOS', () => {
  it('muestra el nombre, la plataforma, la modalidad y la sucursal', () => {
    const markup = render();
    expect(markup).toContain('zaza');
    expect(markup).toContain('WEB');
    expect(markup).toContain('ESTÁTICO');
    expect(markup).toContain('Chapultepec');
    expect(markup).toContain('Registrado');
    expect(markup).toContain('Visto nunca');
  });

  it('cambia la etiqueta de modalidad sin tocar la plataforma', () => {
    expect(render({ mobility: 'mobile' })).toContain('MÓVIL');
  });

  it('marca la rotación pendiente en la franja y en el punto', () => {
    const markup = render({ rotationRequired: true });
    expect(markup).toContain('list-card rotation');
    expect(markup).toContain('s-dot rotation');
    expect(markup).toContain('Rotación pendiente');
  });

  it('ofrece el botón de editar de la caja', () => {
    expect(render()).toContain('aria-label="Editar caja"');
  });
});

describe('Panel de la caja UmiPOS', () => {
  // The edit button used to open the KDS panel on a POS row, and that panel reads a
  // station, an open-order count and a pairing PIN — none of which a register has — so
  // the sheet came up blank. This asserts the POS panel arrives populated.
  it('abre con los datos de la caja y con la acción de revocar', () => {
    const markup = renderToStaticMarkup(
      <EditPosDevicePanel
        device={posDeviceCard(
          {
            id: 'dev-1',
            publicId: '6108ac30-4860-469a-b07f-8b94eed6a58e',
            displayName: 'zaza',
            platform: 'web',
            mobility: 'mobile',
            locationId: 'loc-1',
            state: 'active',
            rotationRequired: false,
            credentialVersion: 3,
            lastSeenAt: null,
          },
          locations,
        )}
        branchId="loc-1"
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    expect(markup).toContain('Gestionar caja');
    expect(markup).toContain('value="zaza"');
    expect(markup).toContain('Modalidad');
    expect(markup).toContain('Móvil');
    expect(markup).toContain('Web');
    expect(markup).toContain('Chapultepec');
    expect(markup).toContain('v3');
    expect(markup).toContain('Revocar caja');
    expect(markup).toContain('Guardar cambios');
    // The KDS-only fields must not leak back in.
    expect(markup).not.toContain('Estación asignada');
    expect(markup).not.toContain('ÓRDENES ABIERTAS');
  });
});
