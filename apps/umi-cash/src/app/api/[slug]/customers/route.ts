import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateCardNumber } from '@/lib/qr';
import { createSession } from '@/lib/auth';
import { getTenant, requireActiveSubscription } from '@/lib/tenant';
import { resolveContact, normalizePhone, findPersonByPhone } from '@/lib/identity';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { createHash, randomBytes } from 'crypto';
import { parseUserAgent } from '@/lib/user-agent';

const RegisterSchema = z.object({
  name: z.string().min(2).max(100),
  phone: z.string().min(7).max(20),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  // Rate limit: max 3 registrations per IP per hour
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = rateLimit(`register:${params.slug}:${ip}`, 3, 60 * 60 * 1000);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  // Device fingerprint rate limit: max 3 registrations per device per day
  const ua = req.headers.get('user-agent') ?? '';
  const deviceHash = createHash('sha256').update(`${ua}:${ip}`).digest('hex').slice(0, 16);
  const drl = rateLimit(`register-device:${deviceHash}`, 3, 24 * 60 * 60 * 1000);
  if (!drl.allowed) return rateLimitResponse(drl.resetAt);

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  const suspended = await requireActiveSubscription(tenant);
  if (suspended) return suspended;

  if (!tenant.selfRegistration) {
    return NextResponse.json({ error: 'El registro no está disponible' }, { status: 403 });
  }

  if (!tenant.programId) {
    return NextResponse.json({ error: 'Programa de lealtad no configurado' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const data = RegisterSchema.parse(body);

    // Normalize phone via the canonical DB normalizer so app + migration agree.
    const normalizedPhone = await normalizePhone(data.phone);
    if (!normalizedPhone) {
      return NextResponse.json({ error: 'Número de teléfono no válido' }, { status: 400 });
    }

    // If this phone already maps to a person who has a card, return a session so the
    // register page can show wallet buttons (same UX as the legacy duplicate flow).
    const existingPerson = await findPersonByPhone(tenant.id, normalizedPhone);
    if (existingPerson) {
      const existingAccount = await prisma.accounts.findFirst({
        where: { tenant_id: tenant.id, person_id: existingPerson.id, program_id: tenant.programId },
      });
      const existingCard = existingAccount
        ? await prisma.cards.findFirst({
            where: { tenant_id: tenant.id, account_id: existingAccount.id },
          })
        : null;
      if (existingCard) {
        // CUSTOMER session subject is the person id.
        const { accessToken } = await createSession(existingPerson.id, 'CUSTOMER', tenant.id);
        return NextResponse.json({
          error: 'Este teléfono ya está registrado',
          accessToken,
          user: {
            id: existingPerson.id,
            name: existingPerson.display_name,
            role: 'CUSTOMER',
          },
        }, { status: 409 });
      }
    }

    const { device, os } = parseUserAgent(ua);

    // Find-or-create the customer person (dedup by normalized phone) outside the
    // transaction — resolveContact is a self-contained idempotent RPC.
    const personId = await resolveContact({
      tenantId: tenant.id,
      kind: 'phone',
      rawValue: data.phone,
      displayName: data.name,
    });

    // Persist birth_date + device/os metadata on the person.
    await prisma.people.update({
      where: { id: personId },
      data: {
        display_name: data.name,
        birth_date: new Date(data.birthDate + 'T00:00:00'),
        metadata: { device, os },
      },
    });

    const result = await prisma.$transaction(async (tx) => {
      // account = (tenant, person, program); reuse if one already exists.
      const account =
        (await tx.accounts.findFirst({
          where: { tenant_id: tenant.id, person_id: personId, program_id: tenant.programId! },
        })) ??
        (await tx.accounts.create({
          data: {
            tenant_id: tenant.id,
            person_id: personId,
            program_id: tenant.programId!,
            status: 'active',
          },
        }));

      const card = await tx.cards.create({
        data: {
          tenant_id: tenant.id,
          account_id: account.id,
          card_number: generateCardNumber(tenant.cardPrefix ?? undefined),
          qr_token: randomBytes(16).toString('hex'),
          qr_issued_at: new Date(),
          status: 'active',
          visits_this_cycle: 0,
          total_visits: 0,
        },
      });

      return { account, card };
    });

    // Return session token directly — no separate login needed. CUSTOMER → person id.
    const { accessToken } = await createSession(personId, 'CUSTOMER', tenant.id);

    return NextResponse.json({
      userId: personId,
      cardId: result.card.id,
      cardNumber: result.card.card_number,
      accessToken,
      user: { id: personId, name: data.name, role: 'CUSTOMER' },
      message: `¡Bienvenido a ${tenant.name}!`,
    }, { status: 201 });

  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    console.error('[Register]', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Error al registrar' }, { status: 500 });
  }
}
