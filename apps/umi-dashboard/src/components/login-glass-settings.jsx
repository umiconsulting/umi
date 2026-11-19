import { useEffect, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { getGlassTints, setGlassTint, subscribeGlassTints } from '@/lib/login-glass/preferences.js';

// The owner authorized this control. Existing login fields keep their markup.
export default function LoginGlassSettings() {
  const [tints, setTints] = useState(getGlassTints);
  useEffect(() => subscribeGlassTints(setTints), []);
  useEffect(() => {
    const close = (event) => {
      document.querySelectorAll('.login-glass-settings[open]').forEach((details) => {
        if (event.type === 'keydown' ? event.key === 'Escape' : !details.contains(event.target)) {
          details.open = false;
          if (event.type === 'keydown') details.querySelector('summary').focus();
        }
      });
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  return (
    <details className="login-glass-settings">
      <summary className="btn btn-ghost focusable">
        <Trans>Vidrio</Trans>
      </summary>
      <div className="login-glass-settings-panel">
        <label htmlFor="login-glass-light">
          <Trans>Tinte en modo claro</Trans>
          <output htmlFor="login-glass-light">{Math.round(tints.light * 100)}%</output>
        </label>
        <input
          className="range-control"
          id="login-glass-light"
          type="range"
          min="0"
          max="1.5"
          step="0.05"
          value={tints.light}
          onChange={(event) => setGlassTint('light', Number(event.target.value))}
        />
        <label htmlFor="login-glass-dark">
          <Trans>Tinte en modo oscuro</Trans>
          <output htmlFor="login-glass-dark">{Math.round(tints.dark * 100)}%</output>
        </label>
        <input
          className="range-control"
          id="login-glass-dark"
          type="range"
          min="0"
          max="1.5"
          step="0.05"
          value={tints.dark}
          onChange={(event) => setGlassTint('dark', Number(event.target.value))}
        />
      </div>
    </details>
  );
}
