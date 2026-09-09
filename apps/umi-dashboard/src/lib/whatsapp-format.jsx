/**
 * Render WhatsApp-style rich text (the markup the bot writes) as React nodes.
 *
 * WhatsApp markup: *bold*, _italic_, ~strikethrough~, ```monospace``` (and single
 * `backtick`). URLs are auto-linked. Newlines are left as-is — the transcript
 * bubble already renders with `white-space: pre-wrap`, so adding <br> would
 * double-space.
 *
 * SAFE BY CONSTRUCTION: the text only ever becomes React text nodes, and only a
 * fixed set of wrapper elements (<strong>/<em>/<del>/<code>/<a>) is created. No
 * caller-supplied HTML is ever injected (no dangerouslySetInnerHTML), and link
 * hrefs are restricted to http/https, so bot or customer text cannot inject markup
 * or a javascript: URL.
 */

// Trailing punctuation that should fall OUTSIDE an auto-linked URL ("(https://x.com).").
const TRAIL_RE = /[.,!?:;)\]}'"]+$/;

// Inline patterns, in priority order. Monospace first so markers inside a code span
// are not re-parsed; URLs before emphasis so underscores/tildes inside a link do not
// turn into italics/strikethrough. Emphasis requires a non-space just inside each
// marker (WhatsApp's own rule), which stops "2 * 3 * 4" from becoming bold.
const INLINE = [
  { re: /```([\s\S]+?)```/, type: 'code' },
  { re: /`([^`\n]+)`/, type: 'code' },
  { re: /(https?:\/\/[^\s<]+|www\.[^\s<]+)/i, type: 'link' },
  { re: /\*(\S(?:[^*\n]*\S)?)\*/, type: 'strong' },
  { re: /_(\S(?:[^_\n]*\S)?)_/, type: 'em' },
  { re: /~(\S(?:[^~\n]*\S)?)~/, type: 'del' },
];

/**
 * Parse WhatsApp markup into a plain AST (data only, no React) so it is trivially
 * unit-testable. Node shapes:
 *   { t: 'text', v }
 *   { t: 'code', v }
 *   { t: 'link', href, label }
 *   { t: 'strong' | 'em' | 'del', children: [...] }
 */
export function tokenizeWhatsApp(input) {
  const text = String(input ?? '');
  if (!text) return [];

  let best = null;
  for (const p of INLINE) {
    const m = p.re.exec(text);
    if (m && (best === null || m.index < best.m.index)) best = { p, m };
  }
  if (!best) return [{ t: 'text', v: text }];

  const { p, m } = best;
  const out = [];
  if (m.index > 0) out.push({ t: 'text', v: text.slice(0, m.index) });

  let consumed = m[0].length;
  if (p.type === 'code') {
    // Drop a single wrapping newline so ```\ncode\n``` renders tidily.
    out.push({ t: 'code', v: m[1].replace(/^\n/, '').replace(/\n$/, '') });
  } else if (p.type === 'link') {
    let raw = m[0];
    const trail = (raw.match(TRAIL_RE) || [''])[0];
    if (trail) raw = raw.slice(0, raw.length - trail.length);
    if (raw) {
      const href = raw.startsWith('www.') ? 'https://' + raw : raw;
      out.push({ t: 'link', href, label: raw });
      consumed = raw.length; // leave the trailing punctuation in the stream
    } else {
      out.push({ t: 'text', v: m[0] }); // all punctuation — treat as plain text
    }
  } else {
    out.push({ t: p.type, children: tokenizeWhatsApp(m[1]) });
  }

  const rest = text.slice(m.index + consumed);
  if (rest) out.push(...tokenizeWhatsApp(rest));
  return out;
}

function renderNodes(nodes, keyBase) {
  return nodes.map((n, i) => renderNode(n, keyBase + '.' + i));
}

function renderNode(node, key) {
  switch (node.t) {
    case 'text':
      return node.v; // string child — no key needed
    case 'code':
      return (
        <code key={key} className="wa-mono">
          {node.v}
        </code>
      );
    case 'link':
      return (
        <a key={key} href={node.href} target="_blank" rel="noopener noreferrer nofollow">
          {node.label}
        </a>
      );
    case 'strong':
      return <strong key={key}>{renderNodes(node.children, key)}</strong>;
    case 'em':
      return <em key={key}>{renderNodes(node.children, key)}</em>;
    case 'del':
      return <del key={key}>{renderNodes(node.children, key)}</del>;
    default:
      return null;
  }
}

/** WhatsApp markup → React nodes for rendering. Null for empty input. */
export function formatWhatsApp(body) {
  if (body == null || body === '') return null;
  return renderNodes(tokenizeWhatsApp(body), 'wa');
}
