-- ───────────────────────────────────────────────────────────────────────────
-- Reference data: core.roles
--
-- Not user data — the fixed set of roles the application resolves against, and
-- the reason this file exists at all. A schema-only dump omits it, and its
-- absence does not announce itself: prisma/seed.ts looks a role up by key and
-- silently skips the link when it finds nothing (`if (role) { ... }`), so
-- seeding reports success while creating logins that can never authenticate —
-- login resolves membership → roles → legacyRole() and 401s on an empty set
-- before it ever checks the password.
--
-- Nothing else in the repository writes these rows; they were inserted by hand
-- into the platform DB at the June 2026 cutover. This is their only record.
--
-- Keys are load-bearing: login maps owner|admin → ADMIN and staff|cashier →
-- STAFF. tenant_id NULL means the role is global rather than per-tenant.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO "core"."roles" ("id", "tenant_id", "key", "name", "description", "created_at") VALUES
	('4a742b40-b81e-b01d-3495-f08dfd62dad5', NULL, 'owner', 'Owner', 'Full tenant administration', '2026-06-20 06:37:10.95025+00'),
	('8587445d-48de-2391-6b92-224bce07d6e4', NULL, 'admin', 'Admin', 'Tenant administration', '2026-06-20 06:37:10.95025+00'),
	('ce305b6d-66ea-88e2-d77c-7512e65e7105', NULL, 'staff', 'Staff', 'Operational staff', '2026-06-20 06:37:10.95025+00'),
	('41e36fd4-43e3-261a-f211-52de848e339c', NULL, 'viewer', 'Viewer', 'Read-only dashboard access', '2026-06-20 06:37:10.95025+00')
ON CONFLICT ("id") DO NOTHING;
