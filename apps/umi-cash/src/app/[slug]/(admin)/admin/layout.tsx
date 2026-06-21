'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { useTenant } from '@/context/TenantContext';
import { isTokenValid, tokenSecondsLeft } from '@/lib/token';
import { refreshAccessToken, authedFetch } from '@/lib/authed-fetch';

function IconHome({ active }: { active: boolean }) {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function IconCamera({ active }: { active: boolean }) {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}


function IconUsers({ active }: { active: boolean }) {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function IconStar({ active }: { active: boolean }) {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function IconSettings({ active }: { active: boolean }) {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

function IconGift({ active }: { active: boolean }) {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 12 20 22 4 22 4 12" />
      <rect x="2" y="7" width="20" height="5" />
      <line x1="12" y1="22" x2="12" y2="7" />
      <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z" />
      <path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" />
    </svg>
  );
}

function IconMessage({ active }: { active: boolean }) {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconChart({ active }: { active: boolean }) {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
      <line x1="2" y1="20" x2="22" y2="20"/>
    </svg>
  );
}

function IconMore({ active }: { active: boolean }) {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="5"  cy="12" r={active ? 2 : 1.5} />
      <circle cx="12" cy="12" r={active ? 2 : 1.5} />
      <circle cx="19" cy="12" r={active ? 2 : 1.5} />
    </svg>
  );
}

const ALL_ITEMS = (slug: string) => [
  { href: `/${slug}/admin`,            label: 'Inicio',      exact: true,  Icon: IconHome,     roles: ['STAFF', 'ADMIN'] },
  { href: `/${slug}/admin/scan`,       label: 'Escanear',    exact: false, Icon: IconCamera,   roles: ['STAFF', 'ADMIN'] },
  { href: `/${slug}/admin/customers`,  label: 'Clientes',    exact: false, Icon: IconUsers,    roles: ['STAFF', 'ADMIN'] },
  { href: `/${slug}/admin/gift-cards`, label: 'Regalos',     exact: false, Icon: IconGift,     roles: ['STAFF', 'ADMIN'] },
  { href: `/${slug}/admin/rewards`,    label: 'Recompensas', exact: false, Icon: IconStar,     roles: ['ADMIN'] },
  { href: `/${slug}/admin/analytics`,  label: 'Analíticas',  exact: false, Icon: IconChart,    roles: ['ADMIN'] },
  { href: `/${slug}/admin/messages`,   label: 'Mensajes',    exact: false, Icon: IconMessage,  roles: ['ADMIN'] },
  { href: `/${slug}/admin/settings`,   label: 'Config',      exact: false, Icon: IconSettings, roles: ['ADMIN'] },
];

// Primary items always visible for ADMIN — the rest go into "More"
const ADMIN_PRIMARY = (slug: string) => new Set([
  `/${slug}/admin`,
  `/${slug}/admin/scan`,
  `/${slug}/admin/customers`,
  `/${slug}/admin/analytics`,
]);

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname();
  const tenant = useTenant();
  const [role, setRole] = useState<string | null>(null);
  const [suspended, setSuspended] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function initAuth() {
      let token = localStorage.getItem('accessToken');

      if (!token || !isTokenValid(token)) {
        token = await refreshAccessToken(slug);
      }

      if (!token || !isTokenValid(token)) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('userRole');
        window.location.href = `/${slug}/admin-login`;
        return;
      }

      // Verify token server-side — never trust localStorage role
      try {
        const r = await authedFetch(slug, `/api/${slug}/admin/stats`);
        if (r.status === 403) {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('userRole');
          window.location.href = `/${slug}/admin-login`;
          return;
        }
        if (r.status === 402) {
          setSuspended(true);
        }
        const data = await r.json().catch(() => null);
        const verifiedRole = data?.role;
        if (verifiedRole && ['STAFF', 'ADMIN'].includes(verifiedRole)) {
          setRole(verifiedRole);
          localStorage.setItem('userRole', verifiedRole);
        } else {
          const storedRole = localStorage.getItem('userRole');
          if (['STAFF', 'ADMIN'].includes(storedRole || '')) {
            setRole(storedRole);
          } else {
            window.location.href = `/${slug}/admin-login`;
          }
        }
      } catch {
        // Network error — use cached role if available
        const storedRole = localStorage.getItem('userRole');
        if (['STAFF', 'ADMIN'].includes(storedRole || '')) {
          setRole(storedRole);
        }
      }
    }
    initAuth();
  }, [slug]);

  // Proactively refresh when the tab returns to foreground — covers iOS Safari
  // backgrounding (which can purge localStorage) and tokens that expired while away.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      const token = localStorage.getItem('accessToken');
      if (!token || tokenSecondsLeft(token) < 5 * 60) {
        refreshAccessToken(slug);
      }
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [slug]);

  // Close sheet on route change
  useEffect(() => { setMoreOpen(false); }, [pathname]);

  // Close on Escape key
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  function handleLogout() {
    fetch(`/api/${slug}/auth/logout`, { method: 'POST' }).finally(() => {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('userRole');
      window.location.href = `/${slug}/admin-login`;
    });
  }

  const isItemActive = useCallback((item: ReturnType<typeof ALL_ITEMS>[number]) => {
    if (item.exact) return pathname === item.href;
    return pathname.startsWith(item.href) && item.href !== `/${slug}/admin`;
  }, [pathname, slug]);

  const allItems = ALL_ITEMS(slug).filter(i => i.roles.includes(role ?? ''));

  // STAFF gets all 5 items flat — no overflow needed
  // ADMIN gets 4 primary + "More" sheet with the rest
  const primarySet = ADMIN_PRIMARY(slug);
  const visibleItems = role === 'ADMIN'
    ? allItems.filter(i => primarySet.has(i.href))
    : allItems;
  const moreItems = role === 'ADMIN'
    ? allItems.filter(i => !primarySet.has(i.href))
    : [];

  const isMoreActive = moreItems.some(isItemActive);

  if (!role) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--color-surface)' }}>
        <div style={{ color: 'var(--color-ink-light)' }}>Verificando acceso...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-surface)' }}>
      <header
        className="px-5 py-3 flex items-center justify-between sticky top-0 z-50"
        style={{
          background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-surface-dark)',
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="uppercase"
            style={{
              fontFamily: '"Domus", serif',
              fontWeight: 400,
              fontSize: 14,
              letterSpacing: '0.04em',
              color: 'var(--color-brand-dark)',
            }}
          >
            {tenant.name}
          </span>
          <span
            className="uppercase"
            style={{
              fontSize: 9,
              letterSpacing: '0.14em',
              fontWeight: 600,
              color: 'var(--color-ink-light)',
            }}
          >
            · {role === 'ADMIN' ? 'Admin' : 'Personal'}
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="text-sm hover:opacity-80"
          style={{ color: 'var(--color-ink-light)' }}
        >
          Salir
        </button>
      </header>

      {suspended && (
        <div className="px-4 py-3 text-sm text-center" style={{ background: 'var(--color-danger)', color: '#fff' }}>
          <strong>Cuenta suspendida.</strong> Contacta a Umi Cash para reactivar tu acceso: <a href="mailto:hola@umiconsulting.co" className="underline">hola@umiconsulting.co</a>
        </div>
      )}

      <main className="pb-20 min-h-[calc(100vh-120px)]">{children}</main>

      {/* Bottom nav */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50"
        style={{ background: '#fff', borderTop: '1px solid var(--color-surface-dark)' }}
        aria-label="Navegación principal"
      >
        <div className="flex">
          {visibleItems.map((item) => {
            const isActive = isItemActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 flex flex-col items-center py-2.5 px-1 text-xs transition-colors active:scale-95 touch-manipulation ${
                  isActive ? 'nav-active font-semibold' : ''
                }`}
                style={!isActive ? { color: 'var(--color-ink-light)' } : undefined}
                aria-current={isActive ? 'page' : undefined}
              >
                <item.Icon active={isActive} />
                <span className="mt-1">{item.label}</span>
              </Link>
            );
          })}

          {moreItems.length > 0 && (
            <button
              onClick={() => setMoreOpen(o => !o)}
              className={`flex-1 flex flex-col items-center py-2.5 px-1 text-xs transition-colors active:scale-95 touch-manipulation ${
                isMoreActive || moreOpen ? 'nav-active font-semibold' : ''
              }`}
              style={!(isMoreActive || moreOpen) ? { color: 'var(--color-ink-light)' } : undefined}
              aria-label="Más opciones"
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
            >
              <IconMore active={isMoreActive || moreOpen} />
              <span className="mt-1">Más</span>
            </button>
          )}
        </div>
      </nav>

      {/* Backdrop */}
      {moreOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 animate-fade-in"
          onClick={() => setMoreOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* More sheet */}
      {moreOpen && (
        <div
          ref={sheetRef}
          role="dialog"
          aria-modal="true"
          aria-label="Navegación adicional"
          className="fixed bottom-[56px] left-0 right-0 z-50 rounded-t-2xl shadow-2xl animate-sheet-up"
          style={{ background: '#fff' }}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1" aria-hidden="true">
            <div className="w-10 h-1 rounded-full" style={{ background: 'var(--color-surface-dark)' }} />
          </div>

          <div className="px-2 pb-6 pt-2">
            {moreItems.map((item) => {
              const isActive = isItemActive(item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={`flex items-center gap-4 px-4 py-3.5 rounded-xl min-h-[56px] transition-colors active:scale-[0.98] touch-manipulation ${
                    isActive ? 'nav-active font-semibold' : ''
                  }`}
                  style={{ background: isActive ? 'var(--color-surface)' : undefined, color: isActive ? undefined : 'var(--color-ink)' }}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <item.Icon active={isActive} />
                  <span className="text-base">{item.label}</span>
                  {isActive && (
                    <span
                      className="ml-auto w-2 h-2 rounded-full"
                      style={{ background: 'var(--color-accent)' }}
                      aria-hidden="true"
                    />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
