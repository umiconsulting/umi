import { describe, expect, it } from 'vitest';
import '@/test/i18n.jsx';
import {
  fmtLastSeenEs,
  locationName,
  mobilityLabel,
  platformLabel,
  posDeviceCard,
  posDeviceStatus,
  visiblePosEnrollmentRequests,
} from './device-utils.js';

describe('Solicitudes de registro de UmiPOS', () => {
  it('retira la solicitud en cuanto se completa', () => {
    const requests = [
      { id: 'completada', state: 'completed', createdAt: '2026-09-01T11:59:59.000Z' },
      { id: 'pendiente', state: 'awaiting_approval', createdAt: '2026-09-01T08:00:00.000Z' },
    ];

    expect(visiblePosEnrollmentRequests(requests).map((request) => request.id)).toEqual([
      'pendiente',
    ]);
  });

  it('conserva la solicitud aprobada que todavía no conecta', () => {
    const requests = [
      { id: 'aprobada', state: 'credential_ready' },
      { id: 'entregada', state: 'credential_delivered' },
    ];

    expect(visiblePosEnrollmentRequests(requests).map((request) => request.id)).toEqual([
      'aprobada',
      'entregada',
    ]);
  });

  it('conserva la solicitud que se mandó y nunca se aceptó', () => {
    const requests = [
      { id: 'creada', state: 'created' },
      { id: 'expirada', state: 'expired' },
      { id: 'denegada', state: 'denied' },
    ];

    expect(visiblePosEnrollmentRequests(requests)).toHaveLength(3);
  });

  it('acepta una lista vacía o ausente', () => {
    expect(visiblePosEnrollmentRequests(null)).toEqual([]);
    expect(visiblePosEnrollmentRequests([])).toEqual([]);
  });
});

describe('Tarjeta de caja UmiPOS', () => {
  const locations = [{ id: 'loc-1', name: 'Chapultepec' }];

  it('traduce plataforma y modalidad a las dos etiquetas de la tarjeta', () => {
    expect(platformLabel('web')).toBe('Web');
    expect(platformLabel('macos')).toBe('macOS');
    expect(mobilityLabel('static')).toBe('Estático');
    expect(mobilityLabel('mobile')).toBe('Móvil');
  });

  it('marca rotación pendiente y registrado, nunca en vivo', () => {
    expect(posDeviceStatus({ state: 'active', rotationRequired: false })).toBe('registered');
    expect(posDeviceStatus({ state: 'active', rotationRequired: true })).toBe('rotation');
    expect(posDeviceStatus({ state: 'rotation_required', rotationRequired: false })).toBe(
      'rotation',
    );
  });

  it('arma la tarjeta con el nombre, la sucursal y las dos etiquetas', () => {
    const now = new Date('2026-09-02T12:00:00.000Z').getTime();
    const card = posDeviceCard(
      {
        id: 'dev-1',
        publicId: 'pub-1',
        displayName: 'zaza',
        platform: 'web',
        mobility: 'mobile',
        locationId: 'loc-1',
        state: 'active',
        rotationRequired: false,
        credentialVersion: 1,
        lastSeenAt: '2026-09-02T11:30:00.000Z',
      },
      locations,
      now,
    );

    expect(card).toMatchObject({
      product: 'pos',
      name: 'zaza',
      platformLabel: 'Web',
      mobilityLabel: 'Móvil',
      locationName: 'Chapultepec',
      status: 'registered',
      last: 'hace 30 min',
    });
  });

  it('nombra la sucursal ausente en vez de dejarla en blanco', () => {
    expect(locationName(locations, null)).toBe('Sin sucursal');
    expect(locationName(locations, 'loc-1')).toBe('Chapultepec');
  });

  it('dice nunca cuando el dispositivo no se ha visto', () => {
    expect(fmtLastSeenEs(null)).toBe('nunca');
    const now = new Date('2026-09-02T12:00:00.000Z').getTime();
    expect(fmtLastSeenEs('2026-09-02T11:59:30.000Z', now)).toBe('hace un momento');
    expect(fmtLastSeenEs('2026-09-02T09:00:00.000Z', now)).toBe('hace 3 h');
    expect(fmtLastSeenEs('2026-08-31T12:00:00.000Z', now)).toBe('hace 2 d');
  });
});
