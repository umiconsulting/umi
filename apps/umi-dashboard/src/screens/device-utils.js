/**
 * A completed request leaves the list the moment it completes.
 *
 * `completed` is the state the API writes when the terminal has taken its credential
 * and acknowledged it — the enrolment is over and the register is in service. From then
 * on the device itself is the thing to show, and it appears in the device grid with its
 * own name, branch and status. Keeping the finished request beside it showed one
 * terminal twice and made an expired request from days ago read as a live register.
 *
 * Every other state stays: a request that was issued and never accepted — `created`,
 * `awaiting_approval`, and the terminal states `denied` / `expired` / `cancelled` —
 * is still the only record that someone asked for a code, and hiding it would leave
 * the owner with nothing to act on. `credential_ready` and `credential_delivered` stay
 * too: those are approved but not yet connected, and the enrolment can still fail.
 */
export function visiblePosEnrollmentRequests(requests) {
  return (requests || []).filter((request) => request.state !== 'completed');
}

export function locationName(locations, locationId) {
  if (!locationId) return 'Sin sucursal';
  return (locations || []).find((location) => location.id === locationId)?.name || 'Sucursal';
}

const PLATFORM_LABELS = {
  web: 'Web',
  android: 'Android',
  ios: 'iOS',
  linux: 'Linux',
  macos: 'macOS',
  windows: 'Windows',
};

export function platformLabel(platform) {
  return PLATFORM_LABELS[platform] || platform || 'Sin plataforma';
}

/** The floor-use label. Two values, because the register is either fixed or carried. */
export function mobilityLabel(mobility) {
  return mobility === 'mobile' ? 'Móvil' : 'Estático';
}

/**
 * A POS terminal has no heartbeat. A KDS iPad reports every five seconds, so live /
 * slow / offline is a real measurement there; a register only touches the server when
 * it boots or authenticates, and reading those same thresholds against `lastSeenAt`
 * would paint every working terminal red. So the POS card states what the registry
 * knows: the device is enrolled, or its credential is due for rotation.
 */
export function posDeviceStatus(device) {
  if (device.rotationRequired || device.state === 'rotation_required') return 'rotation';
  return 'registered';
}

const LAST_SEEN_MINUTE = 60_000;
const LAST_SEEN_HOUR = 3_600_000;
const LAST_SEEN_DAY = 86_400_000;

export function fmtLastSeenEs(isoTimestamp, now = Date.now()) {
  if (!isoTimestamp) return 'nunca';
  const ms = now - new Date(isoTimestamp).getTime();
  if (!Number.isFinite(ms)) return 'nunca';
  if (ms < LAST_SEEN_MINUTE) return 'hace un momento';
  if (ms < LAST_SEEN_HOUR) return `hace ${Math.floor(ms / LAST_SEEN_MINUTE)} min`;
  if (ms < LAST_SEEN_DAY) return `hace ${Math.floor(ms / LAST_SEEN_HOUR)} h`;
  return `hace ${Math.floor(ms / LAST_SEEN_DAY)} d`;
}

/**
 * One shape for the device grid, so a KDS card and a POS card render from the same
 * fields. `product` is what the card switches on: it decides the icon, the second chip,
 * and which detail panel opens — not a chain of `if (device.station)` guesses.
 */
export function posDeviceCard(device, locations, now = Date.now()) {
  return {
    product: 'pos',
    id: device.id,
    name: device.displayName,
    platform: device.platform,
    platformLabel: platformLabel(device.platform),
    mobility: device.mobility,
    mobilityLabel: mobilityLabel(device.mobility),
    locationId: device.locationId,
    locationName: locationName(locations, device.locationId),
    status: posDeviceStatus(device),
    last: fmtLastSeenEs(device.lastSeenAt, now),
    lastSeenAt: device.lastSeenAt,
    state: device.state,
    publicId: device.publicId,
    credentialVersion: device.credentialVersion,
    _raw: device,
  };
}
