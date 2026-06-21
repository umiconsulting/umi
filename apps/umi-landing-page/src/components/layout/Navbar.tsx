"use client";

import { Menu, X, ArrowRight } from "lucide-react";
import { useState, useEffect } from "react";
import Link from "next/link";

const Logo = () => (
  <div className="flex items-center gap-2.5">
    <svg width="32" height="20" viewBox="0 0 44 28" fill="none">
      <path
        d="M4 18 C 10 10, 16 10, 22 18 S 34 26, 40 18"
        stroke="#223979"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M4 22 C 10 14, 16 14, 22 22 S 34 30, 40 22"
        stroke="#223979"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
        opacity="0.5"
      />
    </svg>
    <span className="font-sans font-extrabold text-[22px] lowercase leading-none text-umi-blue-deep">
      umi
    </span>
  </div>
);

const NAV_LINKS: Array<[string, string]> = [
  ["Productos", "#productos"],
  ["Sistema", "#proceso"],
  ["Diagnóstico", "#diagnostico"],
  ["Visión", "#testimonios"],
];

const Navbar = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? "py-2.5 bg-[#fffdf8]/90 backdrop-blur-xl border-b border-[var(--stroke)] shadow-[0_10px_30px_rgba(34,57,121,0.08)]"
          : "py-4 bg-transparent"
      }`}
    >
      <div className="container-wide flex items-center gap-10">
        <Link href="/" className="flex items-center">
          <Logo />
        </Link>

        <div className="hidden md:flex items-center gap-8 ml-auto">
          {NAV_LINKS.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="text-[14px] font-extrabold text-[rgba(20,33,66,0.72)] hover:text-umi-blue-deep transition-colors"
            >
              {label}
            </Link>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-5">
          <span className="text-[11px] uppercase font-extrabold text-[rgba(20,33,66,0.46)]">
            ES · EN
          </span>
          <Link href="#contacto" className="btn btn-primary btn-sm">
            Contactar <ArrowRight size={14} strokeWidth={1.8} />
          </Link>
        </div>

        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden ml-auto text-umi-blue-deep"
          aria-label="Menu"
        >
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-[#fffdf8]/95 backdrop-blur-xl border-b border-[var(--stroke)] py-4">
          <div className="container-wide flex flex-col gap-3">
            {NAV_LINKS.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className="text-[rgba(20,33,66,0.72)] hover:text-umi-blue-deep py-2 font-bold"
                onClick={() => setMobileOpen(false)}
              >
                {label}
              </Link>
            ))}
            <Link
              href="#contacto"
              className="btn btn-primary mt-2 inline-flex w-fit"
              onClick={() => setMobileOpen(false)}
            >
              Contactar
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
