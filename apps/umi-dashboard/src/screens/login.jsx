import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { apiUrl, withCreds, errMessage } from '@/lib/config.js';
import { signIn, isMfaChallenge, verifyMfaCode } from '@/lib/auth.jsx';
import { LocaleSelect } from '@/shell.jsx';
import '@/styles.css';

const REMEMBER_KEY = 'umi.login.rememberedEmail';

/**
 * What to tell the person, for the method the server named.
 *
 * TWO methods ship. `10_umi.sql:75` permits `email_otp` and `totp`, and
 * `email_otp` ships FIRST, because it needs no enrolment ceremony. A screen that
 * names the authenticator application sends an email-code user to look in the
 * wrong place.
 *
 * An unknown method gets neutral words rather than a guess.
 */
function mfaInstruction(method) {
  if (method === 'email_otp') return msg`Te enviamos un código de seis dígitos a tu correo.`;
  if (method === 'totp')
    return msg`Escribe el código de seis dígitos de tu aplicación de autenticación.`;
  return msg`Escribe tu código de seis dígitos.`;
}

/* ---- icons (match login-elegant.html) ---- */
const WaveGlyph = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M4 15 C7 10.5,10 10.5,12 14.5 S18 18,20 13.5"
      stroke="#f4f7ff"
      strokeWidth="1.8"
      fill="none"
      strokeLinecap="round"
    />
    <path
      d="M4 10.5 C7 6,10 6,12 10 S18 13.5,20 9"
      stroke="#a8bbde"
      strokeWidth="1.8"
      fill="none"
      strokeLinecap="round"
      opacity=".8"
    />
  </svg>
);
const EyeIcon = ({ off }) =>
  off ? (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13.2 13.2 0 0 1-2.16 2.83" />
      <path d="M6.6 6.6A13.3 13.3 0 0 0 2 11s3.5 7 10 7a9 9 0 0 0 3.4-.65" />
      <path d="m2 2 20 20" />
    </svg>
  ) : (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
const AlertIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </svg>
);
const CheckIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const BackIcon = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </svg>
);
const MailIcon = () => (
  <svg
    width="26"
    height="26"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 6 12 13 2 6" />
    <rect x="2" y="4" width="20" height="16" rx="2" />
  </svg>
);

export default function LoginScreen() {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const [view, setView] = useState('login'); // 'login' | 'mfa' | 'forgot' | 'sent'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [forgot, setForgot] = useState('');
  // The half-authenticated challenge from the first login step. It is NOT a
  // session: it opens no screen and carries no cookie. It lives in state only,
  // so a reload throws it away and the person starts again.
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(false);

  // Honest "remember": persist only the email for prefill (session lifetime is
  // owned by the rolling refresh, not this checkbox).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        setEmail(saved);
        setRemember(true);
      }
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  // The challenge dies on the server after `expiresInSeconds`. Return to the
  // login view at that moment and say so. Without this the field stays open over
  // a dead token, every code is refused, and the message blames the code.
  useEffect(() => {
    if (view !== 'mfa' || !challenge) return undefined;
    const ms = Number(challenge.expiresInSeconds) * 1000;
    if (!isFinite(ms) || ms <= 0) return undefined;
    const timer = setTimeout(() => {
      setChallenge(null);
      setCode('');
      setPassword('');
      setView('login');
      setError(t`Tu código venció. Inicia sesión otra vez.`);
    }, ms);
    return () => clearTimeout(timer);
  }, [view, challenge, t]);

  const persistRemember = (addr) => {
    try {
      if (remember && addr) localStorage.setItem(REMEMBER_KEY, addr);
      else localStorage.removeItem(REMEMBER_KEY);
    } catch {
      /* localStorage unavailable */
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const addr = email.trim();
      persistRemember(addr);
      const outcome = await signIn(addr, password, remember);
      // The account holds a second factor. There is no session yet, so do NOT
      // navigate — ask for the code.
      if (isMfaChallenge(outcome)) {
        setChallenge(outcome);
        setCode('');
        setView('mfa');
        return;
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || t`Correo o contraseña incorrectos. Revísalos e inténtalo otra vez.`);
    } finally {
      setLoading(false);
    }
  };

  const handleMfa = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await verifyMfaCode(challenge.challengeToken, code.trim(), remember);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || t`Código incorrecto o vencido.`);
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(
        apiUrl('/api/auth/local/forgot-password'),
        withCreds({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: forgot.trim() }),
        }),
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(errMessage(data, t`Error al enviar el correo`));
      }
      setView('sent');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const go = (v) => {
    setView(v);
    setError(null);
  };

  const alertBox = error && (
    <div className="login-alert" role="alert">
      <AlertIcon />
      <span>{error}</span>
    </div>
  );
  const submitBtn = (label, busy) => (
    <button
      className="btn btn-primary btn-tall login-submit focusable"
      type="submit"
      disabled={loading}
    >
      {loading && <span className="login-spinner" />}
      <span>{loading ? busy : label}</span>
    </button>
  );

  return (
    <div className="login-wrap">
      {/* Left — brand panel */}
      <aside className="login-brand">
        <div className="login-brandmark">
          <WaveGlyph />
          <span className="word">umi</span>
        </div>
        <div className="login-hero">
          <h1>
            <Trans>
              Tu operación,
              <br />
              en tiempo real.
            </Trans>
          </h1>
          <p>
            <Trans>Supervisa la operación de tu negocio al momento, desde un solo panel.</Trans>
          </p>
        </div>
        <svg
          className="login-waves"
          viewBox="0 0 600 220"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0 130 C120 78,240 178,360 118 S560 66,600 128 L600 220 L0 220 Z"
            fill="rgba(118,146,203,.20)"
          />
          <path
            d="M0 160 C140 118,260 200,380 150 S560 118,600 168 L600 220 L0 220 Z"
            fill="rgba(168,187,222,.12)"
          />
        </svg>
      </aside>

      {/* Right — form */}
      <main className="login-form-pane">
        <div className="login-form">
          {/* The language control sits above the form: a person who cannot read the
              screen yet must be able to change it before anything else. */}
          <div className="login-locale">
            <LocaleSelect />
          </div>
          {view === 'login' && (
            <section className="login-view" key="login">
              <h2>
                <Trans>Hola de nuevo</Trans>
              </h2>
              <p className="sub">
                <Trans>Inicia sesión para entrar a tu panel.</Trans>
              </p>
              <form onSubmit={handleSubmit} noValidate>
                <div className="field">
                  <label htmlFor="login-email">
                    <Trans>Correo</Trans>
                  </label>
                  <input
                    id="login-email"
                    className="input tall"
                    type="email"
                    autoComplete="email"
                    placeholder="admin@tunegocio.mx"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label htmlFor="login-pw">
                    <Trans>Contraseña</Trans>
                  </label>
                  <div className="login-pw">
                    <input
                      id="login-pw"
                      className="input tall"
                      type={showPw ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder={t`Tu contraseña`}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="login-reveal"
                      onClick={() => setShowPw((s) => !s)}
                      aria-label={showPw ? t`Ocultar contraseña` : t`Mostrar contraseña`}
                    >
                      <EyeIcon off={showPw} />
                    </button>
                  </div>
                </div>
                <div className="login-row-between">
                  <label className="login-remember">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                    />
                    <span className="box">
                      <CheckIcon />
                    </span>
                    <Trans>Recordarme</Trans>
                  </label>
                  <button type="button" className="login-link" onClick={() => go('forgot')}>
                    <Trans>¿Olvidaste tu contraseña?</Trans>
                  </button>
                </div>
                {alertBox}
                {submitBtn(t`Entrar`, t`Entrando…`)}
              </form>
            </section>
          )}

          {view === 'mfa' && (
            <section className="login-view" key="mfa">
              <h2>
                <Trans>Verifica que eres tú</Trans>
              </h2>
              <p className="sub">{i18n._(mfaInstruction(challenge && challenge.method))}</p>
              <form onSubmit={handleMfa} noValidate>
                <div className="field">
                  <label htmlFor="login-mfa">
                    <Trans>Código</Trans>
                  </label>
                  <input
                    id="login-mfa"
                    className="input tall"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    required
                    autoFocus
                  />
                </div>
                {alertBox}
                {submitBtn(t`Verificar`, t`Verificando…`)}
              </form>
              <button
                type="button"
                className="btn btn-ghost login-back"
                onClick={() => {
                  // Drop the challenge. It is a credential, however short-lived.
                  setChallenge(null);
                  setCode('');
                  setPassword('');
                  go('login');
                }}
              >
                <BackIcon /> <Trans>Volver a iniciar sesión</Trans>
              </button>
            </section>
          )}

          {view === 'forgot' && (
            <section className="login-view" key="forgot">
              <h2>
                <Trans>¿Olvidaste tu contraseña?</Trans>
              </h2>
              <p className="sub">
                <Trans>Escríbenos tu correo y te mandamos un enlace para recuperarla.</Trans>
              </p>
              <form onSubmit={handleForgot} noValidate>
                <div className="field">
                  <label htmlFor="forgot-email">
                    <Trans>Correo</Trans>
                  </label>
                  <input
                    id="forgot-email"
                    className="input tall"
                    type="email"
                    autoComplete="email"
                    placeholder="admin@tunegocio.mx"
                    value={forgot}
                    onChange={(e) => setForgot(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                {alertBox}
                {submitBtn(t`Enviar enlace`, t`Enviando…`)}
              </form>
              <button
                type="button"
                className="btn btn-ghost login-back"
                onClick={() => go('login')}
              >
                <BackIcon /> <Trans>Volver a iniciar sesión</Trans>
              </button>
            </section>
          )}

          {view === 'sent' && (
            <section className="login-view" key="sent">
              <div className="login-success-ico">
                <MailIcon />
              </div>
              <h2>
                <Trans>Revisa tu correo</Trans>
              </h2>
              <p className="sub">
                <Trans>
                  Si hay una cuenta con ese correo, te mandamos un enlace para reestablecer tu
                  contraseña. Caduca en 15&nbsp;minutos.
                </Trans>
              </p>
              <button
                type="button"
                className="btn btn-ghost login-back"
                style={{ marginTop: 0 }}
                onClick={() => go('login')}
              >
                <BackIcon /> <Trans>Volver a iniciar sesión</Trans>
              </button>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
