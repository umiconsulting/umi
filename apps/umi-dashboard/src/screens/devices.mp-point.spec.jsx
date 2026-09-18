import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n.jsx';
import { MercadoPagoPointCard, MpPointCallbackNotice, MpPointStoreSheet } from './devices.jsx';

// The card reads everything through `data.jsx`, whose wire shape has its own spec
// (`data.mp-point.spec.jsx`). What is left to prove here is that each STATE is told the
// truth: not connected is not an empty terminal list, a failed read is not a missing
// account, and the days shown are the server's rather than a subtraction done here.
const mockState = {
  data: { status: null, terminals: null },
  loading: false,
  error: null,
  errorCode: null,
  loaded: true,
};

vi.mock('@/data.jsx', () => ({
  useMpPointData: () => mockState,
  getMpPointAuthorization: () => Promise.resolve({ url: 'https://vendor.example/oauth' }),
  bindMpPointTerminal: () => Promise.resolve({}),
  unbindMpPointTerminal: () => Promise.resolve({}),
  createMpPointStore: () => Promise.resolve({ storeId: '87482378' }),
}));

const registers = [{ id: 'dev-1', name: 'Caja principal', locationId: 'loc-1' }];
const locations = [{ id: 'loc-1', name: 'Chapultepec' }];

const account = (overrides = {}) => ({
  connected: true,
  mpUserId: '3696430142',
  expiresAt: '2027-03-15T12:00:00.000Z',
  daysUntilExpiry: 30,
  refreshFailedAt: null,
  refreshAttempts: 0,
  ...overrides,
});

const terminal = (overrides = {}) => ({
  terminalId: 'NEWLAND_N950__SBX0001',
  operatingMode: 'PDV',
  deviceId: 'dev-1',
  locationId: 'loc-1',
  storeId: null,
  posId: null,
  ...overrides,
});

const card = () =>
  renderToStaticMarkup(
    withI18n(
      <MercadoPagoPointCard
        refresh={0}
        onChanged={() => {}}
        registers={registers}
        locations={locations}
        branchId="loc-1"
      />,
    ),
  );

describe('Cuenta de Mercado Pago Point', () => {
  beforeEach(() => {
    mockState.data = { status: null, terminals: null };
    mockState.loading = false;
    mockState.error = null;
    mockState.loaded = true;
  });

  it('sin conectar ofrece conectar la cuenta, y no una lista de terminales', () => {
    mockState.data = {
      status: account({ connected: false, mpUserId: null, expiresAt: null, daysUntilExpiry: null }),
      terminals: null,
    };

    const markup = card();
    expect(markup).toContain('Sin conectar');
    expect(markup).toContain('Conectar cuenta');
    expect(markup).toContain('Conecta la cuenta para ver sus terminales.');
    // The vendor list is only readable with the café's own token, so a café with no account
    // has no list to be empty.
    expect(markup).not.toContain('no tiene terminales');
    expect(markup).not.toContain('Quitar del registro');
  });

  it('conectada muestra la cuenta, los días del servidor y el terminal con su registro', () => {
    // The token's own date is months away; the row must say the server's 3 days anyway,
    // because the client does not get to recompute what the alert watches.
    mockState.data = {
      status: account({ daysUntilExpiry: 3 }),
      terminals: [terminal()],
    };

    const markup = card();
    expect(markup).toContain('Conectado');
    expect(markup).toContain('3696430142');
    expect(markup).toContain('El acceso vence en 3 días');
    expect(markup).toContain('NEWLAND_N950__SBX0001');
    expect(markup).toContain('Caja principal');
    expect(markup).toContain('aria-label="Modo de operación del terminal"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('Autónomo');
    // The ROW's control, and its own words: it takes a terminal off a register. The
    // account-level unlink is a different control with different words — see below.
    expect(markup).toContain('Quitar del registro');
    expect(markup).toContain('Desconectar cuenta');
  });

  it('un terminal sin registro dice dónde se guardará el modo y no ofrece desconectar', () => {
    mockState.data = {
      status: account(),
      terminals: [terminal({ deviceId: null, locationId: null })],
    };

    const markup = card();
    expect(markup).toContain('Sin registro');
    expect(markup).toContain('Elige un registro');
    expect(markup).toContain('El modo se guarda al asignar un registro.');
    // NOT TOO BROAD: "Desconectar" alone would also match the account-level unlink button that
    // lives above the row, so the assertion names the ROW's own control.
    expect(markup).not.toContain('Quitar del registro');
  });

  it('sin cuenta no ofrece desvincular, y con cuenta sí', () => {
    mockState.data = {
      status: account({ connected: false, mpUserId: null, expiresAt: null, daysUntilExpiry: null }),
      terminals: null,
    };
    expect(card()).not.toContain('Desconectar cuenta');

    mockState.data = { status: account(), terminals: [terminal()] };
    expect(card()).toContain('Desconectar cuenta');
  });

  it('un terminal atado a un registro que esta sucursal no lista no se dice "sin registro"', () => {
    mockState.data = {
      status: account(),
      terminals: [terminal({ deviceId: 'dev-9', locationId: 'loc-9' })],
    };

    const markup = card();
    expect(markup).toContain('Otro registro');
    expect(markup).not.toContain('>Sin registro<');
    // The branch is unknown to this list, so no branch chip is invented for it.
    expect(markup).not.toContain('Sucursal');
    expect(markup).toContain('Desconectar');
  });

  it('una renovación fallida se dice con su fecha y su número de intentos', () => {
    mockState.data = {
      status: account({
        daysUntilExpiry: 9,
        refreshFailedAt: '2026-09-16T12:00:00.000Z',
        refreshAttempts: 2,
      }),
      terminals: [],
    };

    const markup = card();
    expect(markup).toContain('Conectado, con avisos');
    expect(markup).toContain('La última renovación falló');
    expect(markup).toContain('2 intentos');
  });

  it('una cuenta sin terminales lo dice', () => {
    mockState.data = { status: account(), terminals: [] };

    expect(card()).toContain('Esta cuenta de Mercado Pago no tiene terminales.');
  });

  it('conectada sin tienda ofrece crearla, y no enseña ningún id de tienda', () => {
    mockState.data = { status: account(), terminals: [terminal()] };

    const markup = card();
    expect(markup).toContain('Sin tienda');
    expect(markup).toContain('Crear tienda');
    // The prompt says WHY, not just that something is missing: the vendor needs the address.
    expect(markup).toContain('la dirección del negocio');
    // Nothing is claimed about a store that does not exist yet, and the sheet is not open.
    expect(markup).not.toContain('Tienda creada');
    expect(markup).not.toContain('aria-modal="true"');
  });

  it('la tienda que un terminal ya reporta se enseña tal cual, sin el comando', () => {
    // The vendor's id is the whole of what we know: no name is invented for it, and a store
    // that exists is not something the operator is invited to create again.
    mockState.data = {
      status: account(),
      terminals: [terminal({ storeId: '87482378', posId: '138301467' })],
    };

    const markup = card();
    expect(markup).toContain('Tienda creada');
    expect(markup).toContain('87482378');
    expect(markup).toContain('Este terminal está conciliado con esta tienda.');
    expect(markup).not.toContain('Crear tienda');
    expect(markup).not.toContain('Sin tienda');
  });

  it('cuenta cuántos terminales están conciliados con la tienda, y no más', () => {
    mockState.data = {
      status: account(),
      terminals: [
        terminal({ storeId: '87482378', posId: '138301467' }),
        terminal({ terminalId: 'NEWLAND_N950__SBX0002', storeId: '87482378', posId: '138301468' }),
        // A terminal the vendor lists but no register has bound yet: it reports no store, so
        // the line must not claim it either.
        terminal({ terminalId: 'NEWLAND_N950__SBX0003', deviceId: null, locationId: null }),
      ],
    };

    const markup = card();
    expect(markup).toContain('Estos 2 terminales están conciliados con esta tienda.');
    expect(markup).not.toContain('3 terminales');
  });

  it('sin cuenta no se ofrece crear la tienda', () => {
    mockState.data = {
      status: account({ connected: false, mpUserId: null, expiresAt: null, daysUntilExpiry: null }),
      terminals: null,
    };

    const markup = card();
    expect(markup).not.toContain('Crear tienda');
    expect(markup).not.toContain('Sin tienda');
  });

  it('una lectura fallida no se disfraza de cuenta sin conectar', () => {
    mockState.error = 'MP_POINT_PANIC';

    const markup = card();
    expect(markup).toContain('MP_POINT_PANIC');
    expect(markup).not.toContain('Sin conectar');
    expect(markup).not.toContain('no tiene terminales');
  });

  it('mientras la primera lectura viaja dice que está consultando', () => {
    mockState.loading = true;
    mockState.loaded = false;

    const markup = card();
    expect(markup).toContain('Consultando la cuenta…');
    expect(markup).not.toContain('Sin conectar');
  });
});

describe('Formulario de la tienda de Mercado Pago', () => {
  const sheet = () =>
    renderToStaticMarkup(withI18n(<MpPointStoreSheet onClose={() => {}} onCreated={() => {}} />));

  it('pide la dirección completa del negocio y deja la referencia como opcional', () => {
    const markup = sheet();
    for (const label of [
      'Nombre del negocio',
      'Calle',
      'Número',
      'Ciudad',
      'Estado de la dirección',
      'Latitud',
      'Longitud',
    ]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain('Referencia · opcional');
    expect(markup).toContain('Crear tienda');
    expect(markup).toContain('Cancelar');
    expect(markup).toContain('role="dialog"');
  });

  it('la ciudad es texto libre: ni lista cerrada ni normalización nuestra', () => {
    const markup = sheet();
    // The vendor's catalogue is the one with accents, and our own copy of it would go stale,
    // so the field is an <input> and there is not a <select> anywhere in this sheet.
    expect(markup).toMatch(/id="[^"]*-store-city"[^>]*>/);
    expect(markup).not.toContain('<select');
    // The city carries no pattern, no list and no data validation of ours.
    expect(markup).not.toContain('list=');
    expect(markup).not.toMatch(/id="[^"]*-store-city"[^>]*pattern=/);
    // The one validator in the path is named, and it is the VENDOR's.
    expect(markup).toContain('La dirección la valida Mercado Pago.');
  });

  it('la latitud y la longitud son numéricas y llevan sus límites', () => {
    const markup = sheet();
    expect(markup).toMatch(/id="[^"]*-store-latitude"[^>]*type="number"/);
    expect(markup).toMatch(/id="[^"]*-store-latitude"[^>]*min="-90"[^>]*max="90"/);
    expect(markup).toMatch(/id="[^"]*-store-longitude"[^>]*min="-180"[^>]*max="180"/);
  });
});

describe('Resultado del regreso de OAuth', () => {
  const notice = (result) =>
    renderToStaticMarkup(withI18n(<MpPointCallbackNotice result={result} onDismiss={() => {}} />));

  it('no dice nada cuando el callback no dejó nada', () => {
    expect(notice(null)).toBe('');
  });

  it('nombra cada desenlace del vocabulario del proveedor, con su código', () => {
    expect(notice({ outcome: 'connected', code: null })).toContain(
      'Cuenta de Mercado Pago conectada.',
    );
    expect(notice({ outcome: 'failed', code: 'invalid_scope' })).toContain(
      'Mercado Pago rechazó la conexión.',
    );
    expect(notice({ outcome: 'invalid_state', code: null })).toContain(
      'La invitación ya no era válida.',
    );
    expect(notice({ outcome: 'missing_code', code: null })).toContain(
      'Mercado Pago no devolvió el código de autorización.',
    );
    expect(notice({ outcome: 'unavailable', code: null })).toContain(
      'no está configurado para conectar cuentas de Mercado Pago',
    );
    // The vendor's refusal code rides beside the sentence, never instead of it.
    expect(notice({ outcome: 'failed', code: 'invalid_scope' })).toContain('invalid_scope');
  });

  it('un desenlace desconocido se reporta como desconocido en vez de adivinarse', () => {
    const markup = notice({ outcome: 'who_knows', code: 'mystery' });
    expect(markup).toContain('No se pudo confirmar la conexión con Mercado Pago.');
    expect(markup).toContain('mystery');
  });
});
