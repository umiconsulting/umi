/**
 * Client-side fetch wrapper for admin/staff pages.
 *
 * Reads the access token from localStorage and attaches it as a Bearer header.
 * On 401, transparently calls /api/{slug}/auth/refresh, stores the new token,
 * and retries the request once. Concurrent 401s share a single refresh.
 *
 * If refresh fails, clears local auth state and redirects to admin-login.
 */

let refreshInflight: Promise<string | null> | null = null;

export async function refreshAccessToken(slug: string): Promise<string | null> {
  if (refreshInflight) return refreshInflight;
  refreshInflight = (async () => {
    try {
      const res = await fetch(`/api/${slug}/auth/refresh`, { method: 'POST' });
      if (!res.ok) return null;
      const { accessToken } = await res.json();
      if (typeof accessToken === 'string') {
        localStorage.setItem('accessToken', accessToken);
        return accessToken;
      }
      return null;
    } catch {
      return null;
    }
  })();
  try {
    return await refreshInflight;
  } finally {
    refreshInflight = null;
  }
}

function redirectToLogin(slug: string) {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('userRole');
  if (typeof window !== 'undefined') {
    window.location.href = `/${slug}/admin-login`;
  }
}

export async function authedFetch(
  slug: string,
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  const buildHeaders = (token: string | null): Headers => {
    const h = new Headers(init.headers);
    if (token) h.set('Authorization', `Bearer ${token}`);
    return h;
  };

  const token = localStorage.getItem('accessToken');
  let res = await fetch(input, { ...init, headers: buildHeaders(token) });
  if (res.status !== 401) return res;

  const newToken = await refreshAccessToken(slug);
  if (!newToken) {
    redirectToLogin(slug);
    return res;
  }
  res = await fetch(input, { ...init, headers: buildHeaders(newToken) });
  if (res.status === 401) {
    redirectToLogin(slug);
  }
  return res;
}
