import {
  TableOrderMenu,
  TableOrderPlaced,
  PlaceTableOrderRequest,
  PublicMenuResponse,
} from '@umi/contract';
import { routes } from '@umi/contract/routes';

const origin = __UMI_API_ORIGIN__;
export class MenuApiError extends Error {
  constructor(message, status = 0, uncertain = false) {
    super(message);
    this.status = status;
    this.uncertain = uncertain;
  }
}

export function resolveContext(url) {
  const token = url.searchParams.get('token');
  const qr = url.pathname.match(/^\/(?:table-order|qr)\/([^/]+)\/?$/);
  if (token !== null || qr) {
    let value = token;
    try {
      value ??= decodeURIComponent(qr[1]);
    } catch {
      throw new MenuApiError('El enlace de mesa no es válido. Escanea de nuevo el QR.');
    }
    if (!/^[A-Za-z0-9_-]{20,120}$/.test(value))
      throw new MenuApiError('El enlace de mesa no es válido. Escanea de nuevo el QR.');
    return { kind: 'table', token: value };
  }
  const browse = url.pathname.match(/^\/([a-zA-Z0-9][a-zA-Z0-9-]{0,79})\/menu\/?$/);
  if (!browse) throw new MenuApiError('Abre el enlace del restaurante o escanea el QR de tu mesa.');
  const locationId = url.searchParams.get('locationId');
  if (
    locationId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(locationId)
  )
    throw new MenuApiError('La sucursal del enlace no es válida.');
  return { kind: 'browse', handle: browse[1], locationId };
}

async function request(path, schema, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(origin + path, {
      method: body ? 'POST' : 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      const message =
        response.status === 429
          ? 'Hay muchas solicitudes. Espera un momento y vuelve a intentar.'
          : [401, 403, 404, 410].includes(response.status)
            ? 'Este menú o QR no está disponible. Consulta al personal.'
            : response.status === 409
              ? 'El pedido requiere revisión. Revisa la disponibilidad y consulta al personal si el envío sigue pendiente.'
              : response.status === 400 || response.status === 422
                ? 'Revisa los productos y las opciones del pedido.'
                : 'El servicio no está disponible. Inténtalo de nuevo.';
      throw new MenuApiError(
        message,
        response.status,
        Boolean(body) &&
          (response.status >= 500 || response.status === 409 || response.status === 429),
      );
    }
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success)
      throw new MenuApiError(
        'No pudimos comprobar la respuesta del restaurante.',
        response.status,
        Boolean(body),
      );
    return parsed.data;
  } catch (error) {
    if (error instanceof MenuApiError) throw error;
    throw new MenuApiError(
      body
        ? 'No pudimos confirmar el envío. Reintenta el mismo pedido para comprobarlo sin duplicarlo.'
        : 'No pudimos cargar el menú. Revisa tu conexión e inténtalo de nuevo.',
      0,
      Boolean(body),
    );
  } finally {
    clearTimeout(timer);
  }
}

export function loadMenu(context) {
  return context.kind === 'table'
    ? request(routes.tableOrder.menu(context.token), TableOrderMenu)
    : request(
        routes.publicMenu.menu(context.handle) +
          (context.locationId ? `?locationId=${encodeURIComponent(context.locationId)}` : ''),
        PublicMenuResponse,
      );
}
export function placeOrder(context, body) {
  if (context.kind !== 'table') throw new MenuApiError('Para pedir, escanea el QR de tu mesa.');
  return request(
    routes.tableOrder.place(context.token),
    TableOrderPlaced,
    PlaceTableOrderRequest.parse(body),
  );
}
export async function contextKey(context) {
  const value =
    context.kind === 'table' ? context.token : `${context.handle}:${context.locationId ?? ''}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `umi-menu-live-v1:${context.kind}:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
export const parsePending = (body) => PlaceTableOrderRequest.parse(body);
export const parseReceipt = (value) => {
  const result = TableOrderPlaced.safeParse(value);
  return result.success ? result.data : null;
};

export const parseCart = (value) => PlaceTableOrderRequest.shape.lines.parse(value);
