import { describe, expect, it } from 'vitest';
import { formatWhatsApp, tokenizeWhatsApp } from './whatsapp-format.jsx';

describe('tokenizeWhatsApp', () => {
  it('returns a single text node for plain text', () => {
    expect(tokenizeWhatsApp('hola mundo')).toEqual([{ t: 'text', v: 'hola mundo' }]);
  });

  it('parses *bold*, _italic_ and ~strike~ with the text around them', () => {
    expect(tokenizeWhatsApp('hola *mundo*')).toEqual([
      { t: 'text', v: 'hola ' },
      { t: 'strong', children: [{ t: 'text', v: 'mundo' }] },
    ]);
    expect(tokenizeWhatsApp('_x_')).toEqual([{ t: 'em', children: [{ t: 'text', v: 'x' }] }]);
    expect(tokenizeWhatsApp('~x~')).toEqual([{ t: 'del', children: [{ t: 'text', v: 'x' }] }]);
  });

  it('parses monospace (``` and single backtick) without re-parsing markers inside', () => {
    expect(tokenizeWhatsApp('```a*b*c```')).toEqual([{ t: 'code', v: 'a*b*c' }]);
    expect(tokenizeWhatsApp('`c`')).toEqual([{ t: 'code', v: 'c' }]);
    // a wrapping newline is trimmed
    expect(tokenizeWhatsApp('```\ncode\n```')).toEqual([{ t: 'code', v: 'code' }]);
  });

  it('nests emphasis', () => {
    expect(tokenizeWhatsApp('*_b_*')).toEqual([
      { t: 'strong', children: [{ t: 'em', children: [{ t: 'text', v: 'b' }] }] },
    ]);
  });

  it('auto-links URLs and leaves trailing punctuation outside the link', () => {
    expect(tokenizeWhatsApp('ve a https://a.com ya')).toEqual([
      { t: 'text', v: 've a ' },
      { t: 'link', href: 'https://a.com', label: 'https://a.com' },
      { t: 'text', v: ' ya' },
    ]);
    expect(tokenizeWhatsApp('(https://a.com).')).toEqual([
      { t: 'text', v: '(' },
      { t: 'link', href: 'https://a.com', label: 'https://a.com' },
      { t: 'text', v: ').' },
    ]);
  });

  it('prefixes bare www links with https and does not italicise underscores inside a URL', () => {
    expect(tokenizeWhatsApp('www.a.com/a_b_c')).toEqual([
      { t: 'link', href: 'https://www.a.com/a_b_c', label: 'www.a.com/a_b_c' },
    ]);
  });

  it('does not treat spaced asterisks as bold', () => {
    expect(tokenizeWhatsApp('2 * 3 * 4')).toEqual([{ t: 'text', v: '2 * 3 * 4' }]);
  });

  it('is empty for empty or nullish input', () => {
    expect(tokenizeWhatsApp('')).toEqual([]);
    expect(tokenizeWhatsApp(null)).toEqual([]);
    expect(tokenizeWhatsApp(undefined)).toEqual([]);
  });
});

describe('formatWhatsApp (React output)', () => {
  it('returns null for empty input', () => {
    expect(formatWhatsApp('')).toBeNull();
    expect(formatWhatsApp(null)).toBeNull();
  });

  it('wraps bold text in a <strong> element', () => {
    const nodes = formatWhatsApp('*hi*');
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes[0].type).toBe('strong');
  });

  it('renders a safe external link (http/https only, noopener)', () => {
    const nodes = formatWhatsApp('https://a.com');
    const link = nodes[0];
    expect(link.type).toBe('a');
    expect(link.props.href).toBe('https://a.com');
    expect(link.props.target).toBe('_blank');
    expect(link.props.rel).toContain('noopener');
  });
});
