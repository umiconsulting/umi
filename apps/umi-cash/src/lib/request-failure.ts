/**
 * Turning a thrown fetch into something the operator can act on, and telling the
 * server it happened.
 *
 * Every admin flow used to collapse each of these into the same "Error de conexión",
 * which reads as "nothing happened". For anything that writes, that claim is not ours
 * to make: the request may have committed and lost only its response, so the honest
 * answer is "we don't know — go look". Saying otherwise is what sent staff back to
 * re-scan a card that had already been stamped.
 */

export type FailureKind =
  /** The device knows it has no link. */
  | 'offline'
  /** The request left (or may have left) and no response came back. */
  | 'unreachable'
  /** A response arrived but was not the JSON we expected — the write may still have landed. */
  | 'malformed';

export type FailureText = { message: string; detail: string };

export function classifyFailure(err: unknown): FailureKind {
  // res.json() on an HTML error page / empty body. The server answered, so whatever
  // was requested may well have been applied.
  if (err instanceof SyntaxError) return 'malformed';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return 'unreachable';
}

/**
 * Wording for a read-only call. Retrying is free, so this can stay blunt.
 */
export function describeReadFailure(err: unknown): FailureText {
  return classifyFailure(err) === 'offline'
    ? { message: 'Sin conexión', detail: 'Revisa la señal del dispositivo e intenta de nuevo.' }
    : { message: 'Error de conexión', detail: 'No se pudo leer la tarjeta. Intenta de nuevo.' };
}

/**
 * Wording for a call that may have written.
 *
 * Note what is deliberately absent: any promise that nothing was applied. Even when
 * the device reports itself offline, the request may have gone out just before the
 * link dropped and committed server-side — `navigator.onLine` describes now, not the
 * moment of the send.
 */
export function describeWriteFailure(err: unknown, verifyHint: string): FailureText {
  switch (classifyFailure(err)) {
    case 'offline':
      return { message: 'Sin conexión', detail: `No pudimos confirmar el resultado. ${verifyHint}` };
    case 'malformed':
      return { message: 'No se pudo confirmar', detail: `El servidor respondió algo inesperado. ${verifyHint}` };
    default:
      return { message: 'No se pudo confirmar', detail: `Se perdió la conexión antes de recibir respuesta. ${verifyHint}` };
  }
}

/**
 * Best-effort note to the server that a call failed on the client.
 *
 * Deliberately not authedFetch: a reporter must never refresh a token or bounce the
 * operator to the login screen mid-scan. It never awaits, never throws, and never
 * retries — over a flaky link the report is as droppable as the call that failed. It
 * exists so the next occurrence leaves a trace at all; a fully offline device will
 * still go unrecorded.
 */
export function reportFailure(
  slug: string,
  payload: { action: string; kind: FailureKind; detail: string },
): void {
  try {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : null;
    void fetch(`/api/${slug}/admin/client-error`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        ...payload,
        online: typeof navigator !== 'undefined' ? navigator.onLine : null,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting a failure must never itself become one.
  }
}

/** Shorthand: classify, report, and return the operator-facing text for a write. */
export function handleWriteFailure(
  err: unknown,
  opts: { slug: string; action: string; verifyHint: string },
): FailureText {
  const kind = classifyFailure(err);
  reportFailure(opts.slug, {
    action: opts.action,
    kind,
    detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
  });
  return describeWriteFailure(err, opts.verifyHint);
}
