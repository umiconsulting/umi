import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redactSupportValue } from './lib/support-redaction.mjs';

describe('pilot support bundle', () => {
  it('redacts secrets and customer contacts recursively', () => {
    const value = redactSupportValue({
      release: '6.0.0',
      token: 'private-token',
      nested: { databasePassword: 'private-password', email: 'person@example.com' },
    });
    assert.equal(value.release, '6.0.0');
    assert.equal(value.token, '[REDACTED]');
    assert.equal(value.nested.databasePassword, '[REDACTED]');
    assert.equal(value.nested.email, '[REDACTED]');
    assert.equal(JSON.stringify(value).includes('private'), false);
    assert.equal(JSON.stringify(value).includes('person@example.com'), false);
  });
});
