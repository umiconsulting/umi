import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./loyalty-value.css', import.meta.url), 'utf8');

describe('Cash table alignment and narrow layout', () => {
  it('lets the right-aligned number class win over the base cell rule', () => {
    expect(css).toContain('.cash-table .cash-num');
    expect(css).toContain('text-align: right;');
  });

  it('tightens the table below 1180px so the action column stays inside the panel', () => {
    expect(css).toContain('@media (max-width: 1180px)');
    expect(css).toContain('.cash-table td.cash-cell-action');
    expect(css).toContain('width: 44px;');
  });

  it('keeps the panel scrollable instead of clipping a wide table', () => {
    expect(css).toMatch(/\.cash-panel\s*\{[^}]*overflow-x: auto;/s);
  });

  it('turns the table rows into labelled cards at 390px', () => {
    expect(css).toContain('@media (max-width: 560px)');
    expect(css).toContain('.cash-table td[data-label]::before');
    expect(css).toContain('.cash-table td.cash-cell-action');
  });

  it('compacts the summary and account control on a phone', () => {
    expect(css).toMatch(/\.cash-summary\s*\{\s*grid-template-columns: 1fr 1fr;/s);
    expect(css).toContain('.app:has(.cash-screen) .profile-toggle-name');
  });

  it('flushes the first mobile field and styles the Cash settings panel', () => {
    expect(css).toMatch(/\.cash-table td:first-child\s*\{[^}]*padding-left: 0;/s);
    expect(css).toContain('.cash-settings-grid');
    expect(css).toContain('.cash-settings-save');
  });
});
