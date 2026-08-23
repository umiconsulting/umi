import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Sidebar } from './shell.jsx';

describe('Dashboard shell accessibility', () => {
  it('uses native navigation buttons with the active page state', () => {
    const markup = renderToStaticMarkup(
      <Sidebar
        active="operations"
        onChange={() => {}}
        collapsed={false}
        onToggleCollapse={() => {}}
        merchantName="Café Piloto"
        navItems={[
          { id: 'operations', label: 'Centro operativo', icon: 'Activity', section: 'OPERACIONES' },
        ]}
      />,
    );
    expect(markup).toContain('<button type="button"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).not.toContain('role="button"');
  });
});
