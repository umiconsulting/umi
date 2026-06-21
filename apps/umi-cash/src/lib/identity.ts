/**
 * Identity resolution on the canonical schema.
 *
 * Customers are `core.people` (one per tenant, deduped by normalized phone via the
 * shared `core.resolve_contact()` RPC). Staff/admin are `core.users` (login) linked
 * to a tenant through `core.tenant_memberships` (+ `membership_roles`) and an
 * operational `core.staff_members` row. Sessions are `core.sessions` (refresh JWT).
 *
 * Phone normalization always goes through the DB's `core.normalize_phone()` so the
 * app and the migration agree (one normalizer).
 */
import { prisma } from './prisma';

export type ContactKind = 'phone' | 'whatsapp' | 'email';

/** E.164 via the canonical DB normalizer (NULL if unparseable). */
export async function normalizePhone(raw: string | null | undefined): Promise<string | null> {
  if (!raw) return null;
  const rows = await prisma.$queryRaw<{ n: string | null }[]>`select core.normalize_phone(${raw}) as n`;
  return rows[0]?.n ?? null;
}

/**
 * Find-or-create a customer `core.people` row for (tenant, contact), idempotent and
 * dedup-safe. Returns the person id. Writes a `core.contact_methods` row too.
 */
export async function resolveContact(args: {
  tenantId: string;
  kind: ContactKind;
  rawValue: string;
  displayName?: string | null;
  sourceSystem?: string | null;
  externalId?: string | null;
}): Promise<string> {
  const rows = await prisma.$queryRaw<{ person_id: string }[]>`
    select core.resolve_contact(
      ${args.tenantId}::uuid,
      ${args.kind},
      ${args.rawValue},
      ${args.displayName ?? null},
      ${args.sourceSystem ?? 'umi-cash'},
      ${args.externalId ?? null}
    ) as person_id`;
  return rows[0].person_id;
}

/** Lookup an existing person in a tenant by phone (normalized). Null if none. */
export async function findPersonByPhone(tenantId: string, rawPhone: string) {
  const normalized = await normalizePhone(rawPhone);
  if (!normalized) return null;
  return prisma.people.findFirst({
    where: { tenant_id: tenantId, normalized_phone: normalized },
  });
}

/** Lookup a person by email (normalized lowercase) in a tenant. */
export async function findPersonByEmail(tenantId: string, email: string) {
  const normalized = email.trim().toLowerCase();
  return prisma.people.findFirst({
    where: { tenant_id: tenantId, normalized_email: normalized },
  });
}

/* ── Staff / admin (login) ─────────────────────────────────────────────────── */

/**
 * Find the login user for a tenant by email, with their role keys. Returns null if
 * no active membership in that tenant. Replaces the old `User where role in
 * (STAFF,ADMIN)` query.
 */
export async function findLoginUser(tenantId: string, email: string) {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.users.findFirst({
    where: {
      email: { equals: normalized, mode: 'insensitive' },
      tenant_memberships: { some: { tenant_id: tenantId, status: 'active' } },
    },
  });
  if (!user) return null;
  const membership = await prisma.tenant_memberships.findFirst({
    where: { tenant_id: tenantId, user_id: user.id, status: 'active' },
    include: { membership_roles: true },
  });
  const roleIds = (membership?.membership_roles ?? []).map((mr) => mr.role_id);
  const roles = roleIds.length
    ? await prisma.roles.findMany({ where: { id: { in: roleIds } } })
    : [];
  const roleKeys = roles.map((r) => r.key);
  return { user, membership, roleKeys };
}

/** The operational staff_members row for an authenticated user in a tenant (for attribution). */
export async function getStaffMemberId(tenantId: string, userId: string): Promise<string | null> {
  const sm = await prisma.staff_members.findFirst({
    where: { tenant_id: tenantId, user_id: userId, status: 'active' },
    select: { id: true },
  });
  return sm?.id ?? null;
}

/* ── Sessions (refresh tokens) ─────────────────────────────────────────────── */

export async function createSession(args: {
  tenantId: string;
  token: string;
  expiresAt: Date;
  userId?: string | null;
  personId?: string | null;
}) {
  return prisma.sessions.create({
    data: {
      tenant_id: args.tenantId,
      token: args.token,
      expires_at: args.expiresAt,
      user_id: args.userId ?? null,
      person_id: args.personId ?? null,
    },
  });
}

export function findSessionByToken(token: string) {
  return prisma.sessions.findUnique({ where: { token } });
}

export function deleteSessionByToken(token: string) {
  return prisma.sessions.deleteMany({ where: { token } });
}

/** Opportunistic cleanup of expired sessions. */
export function deleteExpiredSessions() {
  return prisma.sessions.deleteMany({ where: { expires_at: { lt: new Date() } } });
}
