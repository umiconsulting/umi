// Base URL for the centralized umi-api backend (Phase 5 cutover).
//
// When NEXT_PUBLIC_UMI_API_BASE is set (e.g. https://api.umiconsulting.co), the
// public forms POST cross-origin to umi-api's leads module. When unset, calls
// stay same-origin against the local Next API routes — byte-identical to the
// pre-cutover behavior, so this is a pure reversible Vercel-env flip (mirrors the
// dashboard's VITE_AUTH_MODE gate). umi-api must include this origin in its
// CORS_ORIGINS. These endpoints use no cookies, so no credentials are needed.
export const UMI_API_BASE = (process.env.NEXT_PUBLIC_UMI_API_BASE ?? '').replace(
  /\/+$/,
  '',
);

/** Prefix a same-origin API path with the umi-api base when configured. */
export function apiUrl(path: string): string {
  return UMI_API_BASE ? `${UMI_API_BASE}${path}` : path;
}
