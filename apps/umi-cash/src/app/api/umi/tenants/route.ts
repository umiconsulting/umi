import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { verifyUmiSession } from '@/lib/umi-auth';
import tzlookup from 'tz-lookup';

const LocationSchema = z.object({
  name: z.string().min(1).max(100),
  address: z.string().max(200).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});

const CreateTenantSchema = z.object({
  slug: z.string().min(2).max(30).regex(/^[a-z0-9-]+$/, 'Solo letras minúsculas, números y guiones'),
  name: z.string().min(2).max(100),
  city: z.string().max(100).optional(),
  cardPrefix: z.string().min(2).max(5).regex(/^[A-Z]+$/, 'Solo letras mayúsculas').transform(s => s.toUpperCase()),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color inválido'),
  secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color inválido').optional(),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8).max(100),
  visitsRequired: z.number().int().min(1).max(50).default(10),
  rewardName: z.string().min(2).max(100).default('Bebida gratis'),
  trialEndsAt: z.string().datetime().optional(),
  locations: z.array(LocationSchema).optional(),
});

/**
 * Split a `hashPassword()` output ("scrypt:salt:hash") into the canonical
 * `core.users` password columns. The scrypt format is the only one we ever write.
 */
function splitPassword(stored: string): { salt: string; hash: string; algorithm: string } {
  const parts = stored.split(':');
  // "scrypt:salt:hash"
  const [, salt, hash] = parts;
  return { salt, hash, algorithm: 'scrypt-sha256-v1' };
}

export async function POST(req: NextRequest) {
  if (!await verifyUmiSession(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const data = CreateTenantSchema.parse(body);

    // Check slug uniqueness
    const existing = await prisma.tenants.findUnique({ where: { slug: data.slug } });
    if (existing) return NextResponse.json({ error: 'Este slug ya existe' }, { status: 409 });

    // The global `admin` role (tenant_id IS NULL) — seeded in DDL. The owner user
    // created here gets this role edge, mirroring the Cash ADMIN → admin mapping.
    const adminRole = await prisma.roles.findFirst({ where: { tenant_id: null, key: 'admin' } });
    if (!adminRole) {
      return NextResponse.json({ error: 'Rol "admin" no configurado' }, { status: 500 });
    }

    // Derive timezone from first location with coordinates (default kept otherwise).
    let timezone = 'America/Mexico_City';
    const locWithCoords = data.locations?.find((l) => l.latitude != null && l.longitude != null);
    if (locWithCoords && locWithCoords.latitude != null && locWithCoords.longitude != null) {
      const tz = tzlookup(locWithCoords.latitude, locWithCoords.longitude);
      if (tz) timezone = tz;
    }

    const pw = splitPassword(hashPassword(data.adminPassword));

    const tenant = await prisma.$transaction(async (tx) => {
      // 1. core.tenants — identity
      const newTenant = await tx.tenants.create({
        data: {
          slug: data.slug,
          name: data.name,
          status: 'active',
          timezone,
        },
      });

      // 2. loyalty.programs — loyalty program config + branding
      const program = await tx.programs.create({
        data: {
          tenant_id: newTenant.id,
          name: 'Loyalty',
          card_prefix: data.cardPrefix,
          self_registration: true,
          branding: {
            primary_color: data.primaryColor,
            ...(data.secondaryColor ? { secondary_color: data.secondaryColor } : {}),
          },
        },
      });

      // 3. ops.businesses — city + wallet/brand styling
      await tx.businesses.create({
        data: {
          tenant_id: newTenant.id,
          name: data.name,
          city: data.city ?? null,
          branding: {
            primary_color: data.primaryColor,
            ...(data.secondaryColor ? { secondary_color: data.secondaryColor } : {}),
          },
        },
      });

      // 4. grow.subscriptions — trial vs active (legacy TRIAL ↔ canonical trialing)
      await tx.subscriptions.create({
        data: {
          tenant_id: newTenant.id,
          plan: 'standard',
          ...(data.trialEndsAt
            ? { status: 'trialing', trial_ends_at: new Date(data.trialEndsAt) }
            : { status: 'active' }),
        },
      });

      // 5. loyalty.reward_configs — default active reward config (scoped to program)
      await tx.reward_configs.create({
        data: {
          tenant_id: newTenant.id,
          program_id: program.id,
          visits_required: data.visitsRequired,
          reward_name: data.rewardName,
          is_active: true,
        },
      });

      // 6. core.locations
      if (data.locations && data.locations.length > 0) {
        for (const loc of data.locations) {
          await tx.locations.create({
            data: {
              tenant_id: newTenant.id,
              name: loc.name,
              address: loc.address ?? null,
              lat: loc.latitude ?? null,
              lng: loc.longitude ?? null,
              status: 'active',
            },
          });
        }
      }

      // 7. Owner: core.users (login, scrypt password) + tenant_memberships
      //    + membership_roles (→ global admin role) + staff_members (operational id)
      const ownerUser = await tx.users.create({
        data: {
          email: data.adminEmail,
          display_name: 'Admin',
          password_salt: pw.salt,
          password_hash: pw.hash,
          password_algorithm: pw.algorithm,
          status: 'active',
        },
      });

      const membership = await tx.tenant_memberships.create({
        data: {
          tenant_id: newTenant.id,
          user_id: ownerUser.id,
          status: 'active',
        },
      });

      await tx.membership_roles.create({
        data: {
          membership_id: membership.id,
          role_id: adminRole.id,
        },
      });

      await tx.staff_members.create({
        data: {
          tenant_id: newTenant.id,
          user_id: ownerUser.id,
          name: 'Admin',
          email: data.adminEmail,
          status: 'active',
        },
      });

      return newTenant;
    });

    return NextResponse.json({ ok: true, slug: tenant.slug }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    console.error('[CreateTenant]', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Error al crear tenant' }, { status: 500 });
  }
}
