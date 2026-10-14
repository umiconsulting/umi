import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { MercadoPagoPointTransport } from '../apps/umi-api/src/modules/tender/providers/mercado-pago-point.transport.ts';

// Use the existing Orders transport. The virtual terminal cannot accept a physical card.
const API = 'https://api.mercadopago.com';
const TERMINAL = 'NEWLAND_N950__SBX0000001';
const MERCHANT = 'onca-sandbox';
const STATES = ['processed', 'failed', 'canceled', 'expired', 'action_required', 'refunded'];

const HELP = `Pruebas de Mercado Pago Point para ONCa (Node >= 22.18).

Configura MERCADO_PAGO_POINT_SANDBOX_ACCESS_TOKEN con el Access Token de prueba.
Usa .env.mp-point-sandbox para mantenerlo separado del servidor de Umi.

  node --env-file=.env.mp-point-sandbox scripts/mp-point-sandbox.mjs check
  node --env-file=.env.mp-point-sandbox scripts/mp-point-sandbox.mjs run processed

Estados: ${STATES.join(', ')}.
check consulta la cuenta; run crea una order virtual de 5.00 MXN y simula el estado.
La cuenta debe tener test_user y pertenecer a México. No se usa la terminal física.
Este comando prueba el transporte; el POS, los webhooks y la caja se verifican por separado.`;

/** Test-only runner. The caller can supply fetch and delay for offline verification. */
export async function runSandbox({
  args = process.argv.slice(2),
  token = process.env.MERCADO_PAGO_POINT_SANDBOX_ACCESS_TOKEN,
  fetchImpl = globalThis.fetch,
  delayImpl = delay,
  log = console.log,
} = {}) {
  const [command, state = 'processed'] = args;
  if (!command || command === '--help' || command === '-h') {
    log(HELP);
    return;
  }
  if (!['check', 'run'].includes(command) || args.length > 2 || !STATES.includes(state)) {
    throw new Error('Usa check o run con uno de los estados disponibles. Consulta --help.');
  }
  if (!token?.trim()) {
    throw new Error('Falta MERCADO_PAGO_POINT_SANDBOX_ACCESS_TOKEN en .env.mp-point-sandbox.');
  }
  token = token.trim();

  const request = async (path, body) => {
    const response = await fetchImpl(`${API}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      // Never print the response body or the Authorization header.
      throw new Error(`Mercado Pago respondió HTTP ${response.status} en ${path}.`);
    }
    return response;
  };

  const account = await (await request('/users/me')).json();
  if (!Array.isArray(account.tags) || !account.tags.includes('test_user')) {
    throw new Error(
      'La credencial corresponde a una cuenta sin test_user. No se creó ninguna order.',
    );
  }
  if (account.site_id !== 'MLM') {
    throw new Error(
      'La cuenta de prueba debe pertenecer a México (MLM). No se creó ninguna order.',
    );
  }
  log(
    JSON.stringify({
      accountId: account.id,
      site: account.site_id,
      testAccount: true,
      terminal: TERMINAL,
    }),
  );
  if (command === 'check') return;

  const transport = new MercadoPagoPointTransport({
    accessToken: token,
    terminalId: TERMINAL,
    baseUrl: API,
    expirationTime: 'PT3M',
    fetchImpl,
  });
  const reference = `onca_sandbox_${randomUUID()}`;
  const created = await transport.createOrder({
    merchantId: MERCHANT,
    externalReference: reference,
    amountMinorUnits: 500,
    currency: 'MXN',
    description: 'ONCa - prueba de integracion',
  });
  log(
    JSON.stringify({
      orderId: created.orderId,
      externalReference: reference,
      status: created.status,
    }),
  );

  const simulate = async (target) => {
    const body =
      target === 'processed' || target === 'failed'
        ? {
            status: target,
            payment_method_type: 'credit_card',
            installments: 1,
            payment_method_id: 'visa',
          }
        : { status: target };
    const response = await request(
      `/v1/orders/${encodeURIComponent(created.orderId)}/events`,
      body,
    );
    if (response.status !== 204) {
      throw new Error(`La simulación respondió HTTP ${response.status}; se esperaba 204.`);
    }
    const deadline = Date.now() + 55_000;
    while (Date.now() < deadline) {
      const snapshot = await transport.readOrder(created.orderId, MERCHANT);
      if (snapshot.status === target) {
        log(
          JSON.stringify({
            orderId: snapshot.orderId,
            status: snapshot.status,
            statusDetail: snapshot.statusDetail,
            paymentId: snapshot.paymentId,
            paidAmountMinorUnits: snapshot.paidAmountMinorUnits,
          }),
        );
        return snapshot;
      }
      await delayImpl(2000);
    }
    throw new Error(
      `La order ${created.orderId} sigue pendiente. Consulta su estado antes de repetir run.`,
    );
  };

  if (state === 'refunded') await simulate('processed');
  const result = await simulate(state);
  // Release the virtual terminal after the action_required scenario.
  if (state === 'action_required') await simulate('canceled');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSandbox().catch((error) => {
    const token = process.env.MERCADO_PAGO_POINT_SANDBOX_ACCESS_TOKEN?.trim();
    const message = error instanceof Error ? error.message : 'La prueba no terminó.';
    console.error(token ? message.replaceAll(token, '[REDACTED]') : message);
    process.exitCode = 1;
  });
}
