import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateLocationDto } from './update-location.dto';

/**
 * THE STATUSES A LOCATION CAN ACTUALLY HOLD.
 *
 * `merchant.location.status` is `check (status in ('active','closed'))`. This
 * suite exists because the DTO said something else — it accepted 'inactive' and
 * 'archived' and rejected 'closed' — so the one legal way to close a branch was
 * a 400 and the two the DTO allowed were a 23514 the operator saw as a 500.
 *
 * Neither typecheck nor `sql-preflight` can see this: the values are DATA, and
 * Postgres only tests a CHECK at run time. Only a test that names the constraint's
 * own vocabulary can.
 */
function errorsFor(payload: Record<string, unknown>) {
  return validateSync(plainToInstance(UpdateLocationDto, payload));
}

describe('UpdateLocationDto.status', () => {
  it.each(['active', 'closed'])('accepts %s, which the CHECK allows', (status) => {
    expect(errorsFor({ status })).toEqual([]);
  });

  it.each(['inactive', 'archived', 'open', ''])(
    'rejects %s, which the CHECK would refuse as a 23514',
    (status) => {
      expect(errorsFor({ status })).not.toEqual([]);
    },
  );
});

/**
 * THE PRESENCE FLAG HAS TO SURVIVE THE DTO.
 *
 * `updateLocation` distinguishes "not sent" from "clear it" with
 * `hasOwnProperty`. That distinction is only real if class-transformer leaves an
 * absent field absent. With `useDefineForClassFields` on, a declared field becomes
 * an own property initialised to `undefined` — every patch would then look like it
 * carried every field, and editing an alias would silently erase the address.
 *
 * This pins the behaviour the repository depends on, at the layer that decides it.
 */
describe('UpdateLocationDto presence', () => {
  it('an unsent field arrives as undefined, which the repository reads as untouched', () => {
    const dto = plainToInstance(UpdateLocationDto, { name: 'Centro' });
    expect(dto.address).toBeUndefined();
    expect(dto.latitude).toBeUndefined();
    expect(dto.descriptor).toBeUndefined();
  });

  it('the KEY is present either way — which is why the flag cannot test for it', () => {
    // Not an aspiration, a measurement: at ES2023 `useDefineForClassFields` is on,
    // so class-transformer materialises every declared field. If this ever reports
    // false, the compiler target moved and the repository comment about it is stale.
    const dto = plainToInstance(UpdateLocationDto, { name: 'Centro' });
    expect(Object.prototype.hasOwnProperty.call(dto, 'address')).toBe(true);
  });

  it('an explicit null survives, which is how a café clears its address', () => {
    const dto = plainToInstance(UpdateLocationDto, { address: null });
    expect(dto.address).toBeNull();
    expect(validateSync(dto)).toEqual([]);
  });

  it('a null coordinate is legal, and a nonsense one is not', () => {
    expect(validateSync(plainToInstance(UpdateLocationDto, { latitude: null }))).toEqual([]);
    expect(validateSync(plainToInstance(UpdateLocationDto, { latitude: 120 }))).not.toEqual([]);
  });
});
