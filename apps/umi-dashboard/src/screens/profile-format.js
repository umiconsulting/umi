// Pure presentation helpers for the profile screen. No JSX and no user copy
// here, so the unit test can read them without a locale or a React tree.

/**
 * The two-letter monogram for the profile avatar.
 *
 * It follows the same idea as the sidebar avatar: the person's initials, read
 * from their name first and their email second. A one-word name gives its first
 * two letters; a two-word name gives the first letter of the first and last
 * word. With no name, the local part of the email stands in. With neither, a
 * dash — never an empty circle.
 */
export function initialsFrom(name, email) {
  const source = String(name || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (source) {
    const parts = source.split(' ').filter(Boolean);
    const letters =
      parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
    return letters.toUpperCase();
  }
  const local = String(email || '')
    .trim()
    .split('@')[0];
  if (local) return local.slice(0, 2).toUpperCase();
  return '—';
}
