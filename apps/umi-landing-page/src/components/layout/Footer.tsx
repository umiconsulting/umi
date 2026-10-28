import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-width footer-grid">
        <div>
          <Link className="footer-logo" href="/#inicio">
            umi
          </Link>
          <p>Una operación clara para tu restaurante.</p>
        </div>
        <nav aria-label="Enlaces del pie de página">
          <Link href="/#clientes">Clientes</Link>
          <Link href="/#sistema">Sistema</Link>
          <Link href="/#demo">Solicitar demo</Link>
        </nav>
        <div className="footer-contact">
          <span>Hablemos</span>
          <a href="mailto:hola@umiconsulting.co">hola@umiconsulting.co</a>
          <Link href="/aviso-de-privacidad">Aviso de privacidad</Link>
        </div>
      </div>
      <div className="site-width footer-bottom">
        <span>© {new Date().getFullYear()} Umi</span>
        <span>Hecho para restaurantes en México.</span>
      </div>
    </footer>
  );
}
