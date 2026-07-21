import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { roleToSender } from './message-vocab';

/**
 * The message vocabulary bridge, and the regression guard for the bug that killed the
 * WhatsApp bot SILENTLY.
 *
 * `tenant.message.sender` speaks the café domain vocabulary — customer | bot | staff |
 * system. The LLM/turn engine speaks the Anthropic API vocabulary — user | assistant.
 * Writing an LLM word into the column violates the CHECK (the insert fails), and
 * FILTERING on one matches nothing (no error at all — just a bot that never replies and
 * 325 green tests). Neither failure announces itself, so it has to be asserted.
 *
 * The source-walk tests follow the same idiom as auth-substrate.d11.spec.ts: scan
 * production SQL text so a regression is caught at authoring time, in CI, rather than by
 * silence in production. They also cover the inline `CASE sender …` blocks, which are
 * deliberately NOT extracted into a shared fragment — a shared fragment would have to be
 * interpolated, and sql-preflight cannot PREPARE interpolated SQL (that blindness is
 * exactly how two dead contact_identity reads survived a "green" sweep).
 */

const SRC = resolve(__dirname, '..', '..');

function productionSources(): string[] {
  const out: string[] = [];
  for (const e of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.ts')) continue;
    if (
      e.name.endsWith('.spec.ts') ||
      e.name.endsWith('.integration.ts') ||
      e.name.endsWith('.d.ts')
    )
      continue;
    const dir =
      (e as unknown as { parentPath?: string }).parentPath ??
      (e as unknown as { path: string }).path;
    out.push(join(dir, e.name));
  }
  return out;
}

describe('message vocabulary (DB domain words vs LLM API words)', () => {
  it('maps every LLM role onto a sender the CHECK actually allows', () => {
    // The CHECK is (customer, bot, staff, system) — nothing else may be written.
    expect(roleToSender('user')).toBe('customer');
    expect(roleToSender('assistant')).toBe('bot');
    expect(roleToSender('staff')).toBe('staff');
    expect(roleToSender('system')).toBe('system');
  });

  it('never emits an LLM word, even for roles it has never seen', () => {
    const allowed = new Set(['customer', 'bot', 'staff', 'system']);
    for (const role of ['user', 'assistant', 'system', 'tool', 'function', '', 'weird']) {
      expect(allowed.has(roleToSender(role))).toBe(true);
    }
  });

  it('no production SQL writes or filters an LLM word on message.sender', () => {
    // `sender = 'user'` returns zero rows forever; `sender` VALUES 'assistant' fails the
    // CHECK. Both were live bugs. Catch either shape anywhere in production SQL.
    const offenders: string[] = [];
    const bad = /sender\s*(?:=|<>|!=)\s*'(user|assistant|tool)'/i;
    const badInsert = /VALUES\s*\([^)]*'(user|assistant)'/i;
    for (const file of productionSources()) {
      const text = readFileSync(file, 'utf8');
      if (!/tenant\.message|\bsender\b/.test(text)) continue;
      for (const [i, line] of text.split('\n').entries()) {
        if (bad.test(line) || (badInsert.test(line) && /tenant\.message/.test(text))) {
          offenders.push(`${relative(SRC, file)}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every inline sender→role CASE agrees with the canonical mapping', () => {
    // These are duplicated by design (see file header). Duplication is only safe while
    // the copies agree, so assert agreement instead of trusting review.
    const expected: Record<string, string> = {
      customer: 'user',
      bot: 'assistant',
      staff: 'assistant',
    };
    const caseBlock = /CASE\s+(?:\w+\.)?sender((?:\s+WHEN\s+'[a-z]+'\s+THEN\s+'[a-z]+')+)/gi;
    let found = 0;

    for (const file of productionSources()) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(caseBlock)) {
        found++;
        const arms = [...m[1].matchAll(/WHEN\s+'([a-z]+)'\s+THEN\s+'([a-z]+)'/gi)];
        const mapping = Object.fromEntries(arms.map((a) => [a[1], a[2]]));
        expect({ file: relative(SRC, file), mapping }).toEqual({
          file: relative(SRC, file),
          mapping: expected,
        });
      }
    }
    // If the CASEs are ever refactored away this must fail loudly, not pass vacuously.
    expect(found).toBeGreaterThan(0);
  });
});
