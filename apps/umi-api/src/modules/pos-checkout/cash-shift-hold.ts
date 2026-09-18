import type { RegisterHold } from '@umi/contract';
import type { PoolClient } from 'pg';

/**
 * WHICH DRAWER IS THIS TERMINAL HOLDING, AND WHAT BECAME OF THE TERMINAL THAT
 * HOLDS IT, read where a charge is refused so the refusal can say what to do.
 *
 * The till can reach the end of a money path with a cash tender and no shift on
 * the request. The common shape is not "the cashier forgot to open a drawer":
 * it is a till that restarted (crash, update, power cycle, handover) and minted
 * a NEW operator session, while the shift it opened a minute ago is still open
 * and still held by this very device, only `operator_session_id` points at the
 * session that is gone. `CASH_SHIFT_REQUIRED` therefore has to carry more than
 * its name: without the register and its hold, the operator sees a server fault
 * and a retry that re-sends the same broken payload.
 *
 * The vocabulary is `RegisterHold` from `@umi/contract` (the neighbouring cash
 * module reads the same shape for every register on the till): the four states
 * `free | held_by_this_device | held_by_active_till | held_by_orphaned_till`,
 * and `reclaimable` true only for an orphaned hold. "That terminal is gone" is
 * proven SERVER-SIDE from `merchant.device_is_usable`, the same database
 * function the cash module's register guard calls, never asserted by a client.
 */
export interface DeviceRegisterHold {
  registerId: string | null;
  registerName: string | null;
  registerPublicReference: string | null;
  hold: RegisterHold;
}

const FREE_HOLD: RegisterHold = {
  state: 'free',
  shiftId: null,
  shiftStatus: null,
  openedAt: null,
  deviceId: null,
  deviceName: null,
  deviceStatus: null,
  operatorSessionId: null,
  reclaimable: false,
};

interface HoldRow {
  registerId: string;
  registerName: string;
  registerPublicReference: string;
  shiftId: string | null;
  shiftStatus: string | null;
  openedAt: string | null;
  holdingDeviceId: string | null;
  holdingOperatorSessionId: string | null;
  deviceName: string | null;
  deviceStatus: string | null;
  deviceUsable: boolean;
}

export interface DeviceRegisterScope {
  merchantId: string;
  locationId: string;
  /** The terminal in front of the operator, from the caller's authorization. */
  deviceId: string;
}

/**
 * Resolve the one register this terminal is standing at.
 *
 * A device may be assigned a register (`assignment_policy='device_required'`) or
 * choose among several (`operator_selects`). The register a cash charge is
 * missing a shift for is the one the device currently holds an open shift on; a
 * device that holds none falls back to the register assigned to it, so a till
 * that never got a drawer still gets a register named in the refusal. At most
 * one row comes back: a device holds one drawer at a time.
 */
export const resolveDeviceRegisterHold = async (
  client: PoolClient,
  scope: DeviceRegisterScope,
): Promise<DeviceRegisterHold> => {
  const { rows } = await client.query<HoldRow>(
    `SELECT r.id::text AS "registerId",r.display_name AS "registerName",
            r.public_reference AS "registerPublicReference",
            s.id::text AS "shiftId",s.status AS "shiftStatus",
            s.opened_at::text AS "openedAt",
            s.holding_device_id::text AS "holdingDeviceId",
            s.operator_session_id::text AS "holdingOperatorSessionId",
            d.name AS "deviceName",d.status AS "deviceStatus",
            merchant.device_is_usable(s.holding_device_id) AS "deviceUsable"
       FROM merchant.physical_register r
       LEFT JOIN merchant.cash_shift s
         ON s.register_id=r.id AND s.merchant_id=r.merchant_id
        AND s.status NOT IN ('closed','blocked','recovered')
       LEFT JOIN merchant.device d
         ON d.id=s.holding_device_id AND d.merchant_id=s.merchant_id
      WHERE r.merchant_id=$1::uuid AND r.location_id=$2::uuid
        AND r.active AND r.archived_at IS NULL
        AND (s.holding_device_id=$3::uuid OR r.assigned_device_id=$3::uuid)
      ORDER BY (s.holding_device_id=$3::uuid) DESC NULLS LAST,
               s.opened_at DESC NULLS LAST
      LIMIT 1`,
    [scope.merchantId, scope.locationId, scope.deviceId],
  );
  const row = rows[0];
  if (!row) {
    return { registerId: null, registerName: null, registerPublicReference: null, hold: FREE_HOLD };
  }
  const hold: RegisterHold =
    row.shiftId === null
      ? FREE_HOLD
      : {
          state: row.deviceUsable
            ? row.holdingDeviceId === scope.deviceId
              ? 'held_by_this_device'
              : 'held_by_active_till'
            : 'held_by_orphaned_till',
          shiftId: row.shiftId,
          shiftStatus: row.shiftStatus as RegisterHold['shiftStatus'],
          openedAt: row.openedAt,
          deviceId: row.holdingDeviceId,
          deviceName: row.deviceName,
          deviceStatus: row.deviceStatus,
          operatorSessionId: row.holdingOperatorSessionId,
          reclaimable: !row.deviceUsable,
        };
  return {
    registerId: row.registerId,
    registerName: row.registerName,
    registerPublicReference: row.registerPublicReference,
    hold,
  };
};

/**
 * The hold flattened into the scalar bag an error `details` allows (`ApiError`).
 * Field names match the cash module's `holdDetails`, so a client reads one
 * vocabulary whether the hold arrives on a register or inside a refusal.
 */
export const deviceRegisterHoldDetails = (
  value: DeviceRegisterHold,
): Record<string, string | number | boolean | null> => ({
  registerId: value.registerId,
  registerName: value.registerName,
  registerPublicReference: value.registerPublicReference,
  holdState: value.hold.state,
  shiftId: value.hold.shiftId,
  shiftStatus: value.hold.shiftStatus,
  shiftOpenedAt: value.hold.openedAt,
  holdingDeviceId: value.hold.deviceId,
  holdingDeviceName: value.hold.deviceName,
  holdingDeviceStatus: value.hold.deviceStatus,
  holdingOperatorSessionId: value.hold.operatorSessionId,
  reclaimable: value.hold.reclaimable,
});
