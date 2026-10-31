interface ContactContext {
  request: Request;
  env: { API_ORIGIN?: string };
}

export async function onRequestPost({ request, env }: ContactContext): Promise<Response> {
  if (!env.API_ORIGIN) {
    return Response.json({ error: 'El formulario no está disponible.' }, { status: 503 });
  }

  try {
    const target = new URL('/api/contact', env.API_ORIGIN);
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await request.text(),
      redirect: 'manual',
    });

    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return Response.json(
      { error: 'No pudimos enviar tu solicitud. Inténtalo de nuevo.' },
      { status: 502 },
    );
  }
}
