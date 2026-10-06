import assert from 'node:assert/strict';
import test from 'node:test';
import { readinessStatus, validateProfile } from './umipos-pilot-readiness.mjs';

const base = {
  schemaVersion: 1,
  profileType: 'pilot',
  environment: 'pilot',
  merchant: { timezone: 'America/Mazatlan', currency: 'MXN', locale: 'es-MX' },
  locations: [{ name: 'Centro' }],
  policies: {},
  featureFlags: {},
};

test('acepta un perfil de piloto sin secretos', () =>
  assert.deepEqual(validateProfile(base), { errors: [], warnings: [] }));
test('rechaza campos secretos', () =>
  assert.match(validateProfile({ ...base, apiToken: 'x' }).errors.join(), /secreto/));
test('rechaza decisiones sin resolver en un perfil activo', () =>
  assert.match(
    validateProfile({
      ...base,
      merchant: { ...base.merchant, name: 'OWNER_DECISION_REQUIRED' },
    }).errors.join(),
    /decisiones/,
  ));
test('calcula los tres resultados', () => {
  assert.equal(readinessStatus([{ level: 'pass' }]), 'READY');
  assert.equal(readinessStatus([{ level: 'warn' }]), 'READY WITH WARNINGS');
  assert.equal(readinessStatus([{ level: 'fail' }]), 'NOT READY');
});
