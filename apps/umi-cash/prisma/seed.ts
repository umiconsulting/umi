import { PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync } from 'crypto';

const prisma = new PrismaClient();

// Canonical password hashing: scrypt, split into salt/hash/algorithm columns.
function hashPassword(password: string): {
  password_salt: string;
  password_hash: string;
  password_algorithm: string;
} {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { password_salt: salt, password_hash: hash, password_algorithm: 'scrypt-sha256-v1' };
}

function generateCardNumber(prefix: string): string {
  const num = Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000;
  return `${prefix}-${num}`;
}

/** Ensure a user has an active membership (+ role edge + staff_members row); returns staff_member id. */
async function ensureMembership(
  tenantId: string,
  userId: string,
  roleKey: string,
  staffName: string,
): Promise<string> {
  let membership = await prisma.tenant_memberships.findFirst({
    where: { tenant_id: tenantId, user_id: userId },
  });
  if (!membership) {
    membership = await prisma.tenant_memberships.create({
      data: { tenant_id: tenantId, user_id: userId, status: 'active' },
    });
  }
  const role = await prisma.roles.findFirst({
    where: { key: roleKey, OR: [{ tenant_id: tenantId }, { tenant_id: null }] },
  });
  if (role) {
    const exists = await prisma.membership_roles.findFirst({
      where: { membership_id: membership.id, role_id: role.id },
    });
    if (!exists) {
      await prisma.membership_roles.create({
        data: { membership_id: membership.id, role_id: role.id },
      });
    }
  }
  let staff = await prisma.staff_members.findFirst({
    where: { tenant_id: tenantId, user_id: userId },
  });
  if (!staff) {
    staff = await prisma.staff_members.create({
      data: { tenant_id: tenantId, user_id: userId, name: staffName, status: 'active' },
    });
  }
  return staff.id;
}

async function seedTenant({
  slug,
  name,
  city,
  cardPrefix,
  primaryColor,
  secondaryColor,
  logoUrl,
  stripImageUrl,
  passStyle,
  promoMessage,
  locations,
  rewardConfig,
  admin,
  staff,
  demoCustomer,
}: {
  slug: string;
  name: string;
  city: string;
  cardPrefix: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl?: string;
  stripImageUrl?: string;
  passStyle?: string;
  promoMessage?: string;
  locations: { name: string; address: string; latitude?: number; longitude?: number }[];
  rewardConfig: { visitsRequired: number; rewardName: string; rewardDescription: string };
  admin: { email: string; password: string };
  staff: { email: string; name: string; password: string };
  demoCustomer: { name: string; phone: string };
}) {
  // core.tenants
  const tenant = await prisma.tenants.upsert({
    where: { slug },
    update: { name },
    create: { slug, name, status: 'active', timezone: 'America/Mexico_City' },
  });
  console.log(`Tenant: ${tenant.name} (${tenant.slug})`);

  // ops.businesses (brand profile)
  await prisma.businesses.upsert({
    where: { tenant_id: tenant.id },
    update: { name, city },
    create: {
      tenant_id: tenant.id,
      name,
      city,
      branding: {
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        logo_url: logoUrl ?? null,
        strip_image_url: stripImageUrl ?? null,
        pass_style: passStyle ?? 'default',
        promo_message: promoMessage ?? null,
      },
    },
  });

  // loyalty.programs
  let program = await prisma.programs.findFirst({ where: { tenant_id: tenant.id } });
  if (!program) {
    program = await prisma.programs.create({
      data: {
        tenant_id: tenant.id,
        name: 'Loyalty',
        card_prefix: cardPrefix,
        topup_enabled: true,
        self_registration: true,
        pass_style: passStyle ?? 'default',
        branding: { primary_color: primaryColor, secondary_color: secondaryColor },
      },
    });
  }

  // grow.subscriptions
  await prisma.subscriptions.upsert({
    where: { tenant_id: tenant.id },
    update: {},
    create: { tenant_id: tenant.id, plan: 'standard', status: 'active' },
  });

  // loyalty.reward_configs (default active)
  const reward = await prisma.reward_configs.findFirst({
    where: { tenant_id: tenant.id, is_active: true },
  });
  if (!reward) {
    await prisma.reward_configs.create({
      data: {
        tenant_id: tenant.id,
        program_id: program.id,
        visits_required: rewardConfig.visitsRequired,
        reward_name: rewardConfig.rewardName,
        reward_description: rewardConfig.rewardDescription,
        is_active: true,
      },
    });
  }

  // core.locations
  for (const loc of locations) {
    const existing = await prisma.locations.findFirst({
      where: { tenant_id: tenant.id, name: loc.name },
    });
    if (!existing) {
      await prisma.locations.create({
        data: {
          tenant_id: tenant.id,
          name: loc.name,
          address: loc.address,
          lat: loc.latitude ?? null,
          lng: loc.longitude ?? null,
          status: 'active',
        },
      });
    }
  }

  // Admin + staff logins (core.users + memberships + staff_members)
  const adminUser = await prisma.users.upsert({
    where: { auth_subject: `seed:${slug}:admin` },
    update: {},
    create: { auth_subject: `seed:${slug}:admin`, email: admin.email, display_name: 'Admin', ...hashPassword(admin.password) },
  });
  await ensureMembership(tenant.id, adminUser.id, 'admin', 'Admin');
  console.log(`  Admin: ${admin.email}`);

  const staffUser = await prisma.users.upsert({
    where: { auth_subject: `seed:${slug}:staff` },
    update: {},
    create: { auth_subject: `seed:${slug}:staff`, email: staff.email, display_name: staff.name, ...hashPassword(staff.password) },
  });
  const staffMemberId = await ensureMembership(tenant.id, staffUser.id, 'staff', staff.name);
  console.log(`  Staff: ${staff.email}`);

  // Demo customer (people + account + card + visits + initial balance via ledger)
  const demoCardNumber = `${cardPrefix}-SEED00001`;
  const existingCard = await prisma.cards.findUnique({ where: { card_number: demoCardNumber } });
  if (!existingCard) {
    const person = await prisma.people.create({
      data: { tenant_id: tenant.id, display_name: demoCustomer.name, normalized_phone: demoCustomer.phone },
    });
    await prisma.contact_methods.create({
      data: {
        tenant_id: tenant.id,
        person_id: person.id,
        kind: 'phone',
        normalized_value: demoCustomer.phone,
        display_value: demoCustomer.phone,
        is_primary: true,
      },
    });
    const account = await prisma.accounts.create({
      data: { tenant_id: tenant.id, person_id: person.id, program_id: program.id },
    });
    const card = await prisma.cards.create({
      data: {
        tenant_id: tenant.id,
        account_id: account.id,
        card_number: demoCardNumber,
        qr_token: randomBytes(16).toString('hex'),
        total_visits: 7,
        visits_this_cycle: 7,
      },
    });

    const now = new Date();
    for (let i = 7; i >= 1; i--) {
      await prisma.visit_events.create({
        data: {
          tenant_id: tenant.id,
          loyalty_card_id: card.id,
          staff_member_id: staffMemberId,
          occurred_at: new Date(now.getTime() - i * 2 * 24 * 60 * 60 * 1000),
        },
      });
    }

    // Initial wallet balance: append-only ledger + derived caches.
    const initial = 15000;
    await prisma.points_ledger.create({
      data: {
        tenant_id: tenant.id,
        loyalty_card_id: card.id,
        delta: initial,
        reason: 'topup',
        source_type: 'seed',
        idempotency_key: `seed_topup_${card.id}`,
      },
    });
    await prisma.wallet_transactions.create({
      data: {
        tenant_id: tenant.id,
        loyalty_card_id: card.id,
        staff_member_id: staffMemberId,
        type: 'topup',
        amount_cents: initial,
        description: 'Recarga inicial en tienda',
      },
    });
    await prisma.balances.upsert({
      where: { loyalty_card_id: card.id },
      create: { tenant_id: tenant.id, loyalty_card_id: card.id, balance: initial },
      update: { balance: initial },
    });
    await prisma.cards.update({ where: { id: card.id }, data: { balance_cents: initial } });

    console.log(`  Demo customer card: ${card.card_number}`);
  }

  return { tenant, adminUser, staffUser };
}

async function main() {
  console.log('Seeding database...');

  await seedTenant({
    slug: 'elgranribera',
    name: 'El Gran Ribera',
    city: 'Culiacán, Sinaloa',
    cardPrefix: 'EGR',
    primaryColor: '#B5605A',
    secondaryColor: '#F5E6D3',
    logoUrl: '/logos/ribera-logo-transparent.png',
    stripImageUrl: '/logos/ribera-strip.png',
    passStyle: 'stamps',
    locations: [
      { name: 'Sucursal Principal', address: 'Culiacán, Sinaloa', latitude: 24.8049, longitude: -107.3940 },
    ],
    rewardConfig: {
      visitsRequired: 10,
      rewardName: 'Bebida gratis',
      rewardDescription: 'Elige cualquier bebida del menú. ¡Te lo has ganado!',
    },
    admin: {
      email: process.env.EGR_ADMIN_EMAIL || 'admin@elgranribera.mx',
      password: process.env.EGR_ADMIN_PASSWORD || 'ElGranRibera2024!',
    },
    staff: { email: 'barista@elgranribera.mx', name: 'Barista', password: 'Barista2024!' },
    demoCustomer: { name: 'María García', phone: '+5215512345678' },
  });

  await seedTenant({
    slug: 'kalalacafe',
    name: 'Kalala Café',
    city: 'Culiacán, Sinaloa',
    cardPrefix: 'KLC',
    primaryColor: '#2D5A3D',
    secondaryColor: '#F06080',
    logoUrl: '/logos/kalala-logo.png',
    passStyle: 'stamps',
    locations: [
      { name: 'Sucursal Centro', address: 'Centro, Culiacán, Sinaloa', latitude: 24.8090, longitude: -107.3890 },
      { name: 'Sucursal Norte', address: 'Norte, Culiacán, Sinaloa', latitude: 24.8300, longitude: -107.3800 },
    ],
    rewardConfig: {
      visitsRequired: 8,
      rewardName: 'Bebida gratis',
      rewardDescription: 'Elige cualquier bebida del menú. ¡Te lo has ganado!',
    },
    admin: {
      email: process.env.KLC_ADMIN_EMAIL || 'admin@kalalacafe.mx',
      password: process.env.KLC_ADMIN_PASSWORD || 'KalalaCafe2024!',
    },
    staff: { email: 'barista@kalalacafe.mx', name: 'Barista Kalala', password: 'Barista2024!' },
    demoCustomer: { name: 'Carlos López', phone: '+5216871234567' },
  });

  await seedTenant({
    slug: 'nectarcafe',
    name: 'Néctar Café',
    city: 'Culiacán, Sinaloa',
    cardPrefix: 'NEC',
    primaryColor: '#5C1A2B',
    secondaryColor: '#F5E6D8',
    logoUrl: '/logos/nectarcafe-logo.png',
    passStyle: 'stamps',
    promoMessage: '15% de descuento en tu primera visita',
    locations: [
      { name: 'Sucursal Principal', address: 'Av Agustín Melgar 140, Chapultepec, 80040 Culiacán Rosales, Sin.', latitude: 24.815688, longitude: -107.392437 },
    ],
    rewardConfig: {
      visitsRequired: 10,
      rewardName: 'Bebida gratis',
      rewardDescription: '15% de descuento en tu primera visita y una bebida gratis al llegar a 10 visitas.',
    },
    admin: {
      email: process.env.NEC_ADMIN_EMAIL || 'admin@nectarcafe.mx',
      password: process.env.NEC_ADMIN_PASSWORD || 'N3ctarCafeA2026!',
    },
    staff: { email: 'barista@nectarcafe.mx', name: 'Barista Néctar', password: 'N3ctarCafeBr2026!' },
    demoCustomer: { name: 'Ana Torres', phone: '+5216677654321' },
  });

  console.log('Seeding complete!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
