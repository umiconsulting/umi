import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

function make() {
  const repo = {
    findCredentialByEmail: vi.fn(),
    findUserById: vi.fn(),
    findTenantsForUser: vi.fn().mockResolvedValue([]),
    insertResetToken: vi.fn().mockResolvedValue(undefined),
    findResetToken: vi.fn(),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    markResetTokenUsed: vi.fn().mockResolvedValue(undefined),
  };
  const passwords = { verify: vi.fn(), hash: vi.fn() };
  const jwt = {
    signAccess: vi.fn().mockResolvedValue('access-tok'),
    signRefresh: vi.fn().mockResolvedValue('refresh-tok'),
  };
  const email = { send: vi.fn().mockResolvedValue({ messageId: 'm1' }) };
  const config = { get: vi.fn().mockReturnValue('https://app.test') };
  const svc = new AuthService(
    repo as never,
    passwords as never,
    jwt as never,
    email as never,
    config as never,
  );
  return { svc, repo, passwords, jwt, email };
}

const CRED = {
  userId: 'u1',
  email: 'owner@kala.co',
  displayName: 'Owner',
  passwordSalt: 'salt',
  passwordHash: 'hash',
};

describe('AuthService.login', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('issues tokens + session on valid credentials (and lowercases username)', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue(CRED);
    h.passwords.verify.mockReturnValue(true);

    const r = await h.svc.login('  Owner@Kala.co ', 'pw');

    expect(h.repo.findCredentialByEmail).toHaveBeenCalledWith('owner@kala.co');
    expect(r.accessToken).toBe('access-tok');
    expect(r.refreshToken).toBe('refresh-tok');
    expect(r.user).toEqual({
      id: 'u1',
      email: 'owner@kala.co',
      displayName: 'Owner',
    });
  });

  it('401s on wrong password', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue(CRED);
    h.passwords.verify.mockReturnValue(false);
    await expect(h.svc.login('owner@kala.co', 'bad')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401s (no enumeration) on unknown user', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue(null);
    await expect(h.svc.login('nobody@x.co', 'pw')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthService.forgotPassword', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('does nothing (no email, no token) for an unknown address', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue(null);
    await h.svc.forgotPassword('ghost@x.co');
    expect(h.repo.insertResetToken).not.toHaveBeenCalled();
    expect(h.email.send).not.toHaveBeenCalled();
  });

  it('persists a token and sends the reset email for a real user', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue(CRED);
    await h.svc.forgotPassword('owner@kala.co');
    expect(h.repo.insertResetToken).toHaveBeenCalledOnce();
    expect(h.email.send).toHaveBeenCalledOnce();
    const arg = h.email.send.mock.calls[0][0];
    expect(arg.to).toBe('owner@kala.co');
    expect(arg.html).toContain('/reset-password?token=');
  });
});

describe('AuthService.resetPassword', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => {
    h = make();
    h.passwords.hash.mockReturnValue({ salt: 'ns', hash: 'nh' });
  });

  it('updates the password and consumes the token when valid', async () => {
    h.repo.findResetToken.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    });
    await h.svc.resetPassword('tok', 'newpassword');
    expect(h.repo.updatePassword).toHaveBeenCalledWith('u1', 'ns', 'nh');
    expect(h.repo.markResetTokenUsed).toHaveBeenCalledWith('t1');
  });

  it('rejects an unknown token', async () => {
    h.repo.findResetToken.mockResolvedValue(null);
    await expect(h.svc.resetPassword('x', 'newpassword')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an already-used token', async () => {
    h.repo.findResetToken.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(),
    });
    await expect(h.svc.resetPassword('x', 'newpassword')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(h.repo.updatePassword).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    h.repo.findResetToken.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      expiresAt: new Date(Date.now() - 1),
      usedAt: null,
    });
    await expect(h.svc.resetPassword('x', 'newpassword')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
