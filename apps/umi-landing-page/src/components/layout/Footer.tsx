import Link from "next/link";

const Logo = () => (
  <div className="flex items-center gap-2.5">
    <svg width="36" height="22" viewBox="0 0 44 28" fill="none">
      <path
        d="M4 18 C 10 10, 16 10, 22 18 S 34 26, 40 18"
        stroke="#BFD1F2"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M4 22 C 10 14, 16 14, 22 22 S 34 30, 40 22"
        stroke="#BFD1F2"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
        opacity="0.5"
      />
    </svg>
    <span className="font-sans font-extrabold text-2xl lowercase text-umi-ink leading-none">
      umi
    </span>
  </div>
);

const Compass = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4">
    <circle cx="12" cy="12" r="10" />
    <path d="M16 8l-2 6-6 2 2-6 6-2z" />
  </svg>
);

const SOCIAL = [
  {
    name: "LinkedIn",
    path:
      "M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z",
  },
  {
    name: "Twitter",
    path:
      "M8.29 20.251c7.547 0 11.675-6.253 11.675-11.675 0-.178 0-.355-.012-.53A8.348 8.348 0 0022 5.92a8.19 8.19 0 01-2.357.646 4.118 4.118 0 001.804-2.27 8.224 8.224 0 01-2.605.996 4.107 4.107 0 00-6.993 3.743 11.65 11.65 0 01-8.457-4.287 4.106 4.106 0 001.27 5.477A4.072 4.072 0 012.8 9.713v.052a4.105 4.105 0 003.292 4.022 4.095 4.095 0 01-1.853.07 4.108 4.108 0 003.834 2.85A8.233 8.233 0 012 18.407a11.616 11.616 0 006.29 1.84",
  },
];

const SERVICE_LINKS: Array<[string, string]> = [
  ["ConversaFlow", "#productos"],
  ["Umi KDS", "#productos"],
  ["Umi Cash", "#productos"],
  ["Dashboard + Logs", "#productos"],
  ["Diagnóstico", "#diagnostico"],
];

const Footer = () => {
  return (
    <footer className="bg-[#050B1C] pt-20 pb-8 px-6 sm:px-8 lg:px-10 border-t border-[var(--stroke)] relative z-[2]">
      <div className="container-wide">
        <div className="grid grid-cols-2 md:grid-cols-[2fr_1fr_1fr_1fr] gap-12 pb-14 border-b border-[var(--stroke)]">
          <div>
            <Logo />
            <p className="text-[14px] leading-[1.65] font-medium text-white/68 max-w-[300px] mt-5">
              Sistema operativo para restaurantes conectados. Culiacán · Ciudad de México · Desde 2021.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-[11px] uppercase text-[#BFD1F2] font-extrabold mb-2">
              Umi
            </div>
            {["Misión", "Equipo", "Prensa", "Contacto"].map((t) => (
              <Link key={t} href="#" className="text-sm text-white/68 hover:text-umi-ink transition-colors">
                {t}
              </Link>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-[11px] uppercase text-[#BFD1F2] font-extrabold mb-2">
              Productos
            </div>
            {SERVICE_LINKS.map(([t, h]) => (
              <Link key={t} href={h} className="text-sm text-white/68 hover:text-umi-ink transition-colors">
                {t}
              </Link>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-[11px] uppercase text-[#BFD1F2] font-extrabold mb-2">
              Legal
            </div>
            {["Aviso de privacidad", "Términos", "Cookies"].map((t) => (
              <Link key={t} href="#" className="text-sm text-white/68 hover:text-umi-ink transition-colors">
                {t}
              </Link>
            ))}
          </div>
        </div>

        <div className="pt-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-[12px] text-white/48">
          <span>© {new Date().getFullYear()} Umi · Todos los derechos reservados</span>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-white/48">
              <Compass /> N 19.43° · W 99.13°
            </div>
            <div className="flex gap-4">
              {SOCIAL.map((s) => (
                <Link
                  key={s.name}
                  href="#"
                  aria-label={s.name}
                  className="text-white/68 hover:text-umi-ink transition-colors"
                >
                  <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
                    <path d={s.path} fillRule="evenodd" clipRule="evenodd" />
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
