import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A quién se le avisa que un platillo está listo.
 *
 * La consulta no se puede ejercer contra una base en la suite de unidades, así que
 * esta prueba fija su forma, que es lo que se rompió: el destinatario se elige por
 * el ROL del operador (mesero), nunca por quién capturó la línea.
 *
 * Medido en el piloto de ONCA el 2026-10-14: la caja envió ocho cuentas a cocina y
 * el aviso de "listo" se dirigió a la caja — al operador que envió — mientras el
 * mesero del POS portátil no recibía nada. Por eso el destinatario ya no se lee de
 * `pos_cart_line.fired_by_user_id`.
 */
describe('POS push recipients', () => {
  const source = readFileSync(join(__dirname, 'pos-push.repository.ts'), 'utf8');
  const recipients = source.slice(
    source.indexOf('async recipients('),
    source.indexOf('return result.rows'),
  );

  it('notifies the branch waiters, not the operator who fired the line', () => {
    expect(recipients).toContain("waiter.key='waiter'");
    expect(recipients).toContain('st.merchant_role_id');
    expect(recipients).not.toContain('fired_by_user_id');
    expect(recipients).not.toContain('pos_cart_line');
  });

  it('counts only a live token: open session, active device, this environment', () => {
    expect(recipients).toContain("os.state IN ('active','locked')");
    expect(recipients).toContain('os.expires_at>now()');
    expect(recipients).toContain('p.revoked_at IS NULL');
    expect(recipients).toContain("d.status='active'");
    expect(recipients).toContain('p.environment=$4');
    expect(recipients).toContain('p.project_id=$5');
  });

  it('still refuses to announce a cancelled account', () => {
    expect(recipients).toContain("c.lifecycle_state<>'cancelled'");
    expect(recipients).toContain("ki.status='ready'");
  });
});
