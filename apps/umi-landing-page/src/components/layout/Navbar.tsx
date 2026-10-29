'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { label: 'Clientes', href: '/#clientes' },
  { label: 'Sistema', href: '/#sistema' },
  { label: 'Umi Cash', href: '/#cash' },
];

export default function Navbar() {
  const isHome = usePathname() === '/';
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 32);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  return (
    <header className={`site-header${!isHome || scrolled || open ? ' site-header-solid' : ''}`}>
      <nav className="site-width nav-inner" aria-label="Navegación principal">
        <Link className="site-logo" href="/#inicio" aria-label="Umi, inicio">
          <svg viewBox="0 0 44 28" width="32" height="22" fill="none" aria-hidden="true">
            <path
              d="M4 15c6-8 12-8 18 0s12 8 18 0M4 22c6-8 12-8 18 0s12 8 18 0"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <span>umi</span>
        </Link>
        <div className="nav-links">
          {links.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </div>
        <Link className="nav-cta" href="/#demo">
          Solicitar demo <ArrowUpRight size={17} aria-hidden="true" />
        </Link>
        <button
          className="nav-menu-button"
          type="button"
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </nav>
      {open && (
        <nav id="mobile-nav" className="mobile-nav" aria-label="Navegación móvil">
          {links.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </Link>
          ))}
          <Link href="/#demo" onClick={() => setOpen(false)}>
            Solicitar demo <ArrowUpRight size={17} aria-hidden="true" />
          </Link>
        </nav>
      )}
    </header>
  );
}
