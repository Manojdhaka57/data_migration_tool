import { describe, it, expect, beforeAll } from 'vitest';
import { encryptSecret, decryptSecret, MissingSecretKeyError } from './secretBox';
import { hashPassword, verifyPassword } from './auth';
import { deriveRunStatus } from './runRecorder';

describe('secretBox (credentials at rest)', () => {
  beforeAll(() => {
    process.env.APP_SECRET_KEY = Buffer.alloc(32, 3).toString('base64');
  });

  it('round-trips a password', () => {
    expect(decryptSecret(encryptSecret('example-db-password'))).toBe('example-db-password');
  });

  it('uses a random IV — the same input encrypts differently each time', () => {
    // Unlike the PII cipher, which is deliberately deterministic so migrated
    // values stay comparable, stored credentials must not leak that two
    // connections share a password.
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('handles unicode and empty strings', () => {
    expect(decryptSecret(encryptSecret(''))).toBe('');
    expect(decryptSecret(encryptSecret('pä$$wörd–✓'))).toBe('pä$$wörd–✓');
  });

  it('rejects tampered ciphertext rather than returning garbage', () => {
    const blob = Buffer.from(encryptSecret('secret'), 'base64');
    blob[blob.length - 1] ^= 0xff; // corrupt the GCM tag
    expect(() => decryptSecret(blob.toString('base64'))).toThrow();
  });

  it('rejects a malformed blob', () => {
    expect(() => decryptSecret('tooshort')).toThrow(/malformed/i);
  });

  it('explains itself when no key is configured', () => {
    const saved = process.env.APP_SECRET_KEY;
    delete process.env.APP_SECRET_KEY;
    try {
      expect(() => encryptSecret('x')).toThrow(MissingSecretKeyError);
    } finally {
      process.env.APP_SECRET_KEY = saved;
    }
  });
});

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    expect(await verifyPassword('correct horse battery', await hashPassword('correct horse battery'))).toBe(true);
  });

  it('rejects a wrong password', async () => {
    expect(await verifyPassword('wrong', await hashPassword('correct horse battery'))).toBe(false);
  });

  it('salts — the same password hashes differently each time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('never stores the plaintext', async () => {
    const hash = await hashPassword('sup3rSecret!');
    expect(hash).not.toContain('sup3rSecret!');
    expect(hash.startsWith('scrypt$')).toBe(true);
  });

  it('rejects a malformed stored hash instead of throwing', async () => {
    expect(await verifyPassword('x', 'not-a-real-hash')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
});

describe('deriveRunStatus', () => {
  it('is COMPLETED only when every table succeeded', () => {
    expect(deriveRunStatus(['success', 'success'], false)).toBe('COMPLETED');
    expect(deriveRunStatus(['success', 'skipped'], false)).toBe('COMPLETED');
  });

  it('is PARTIALLY_COMPLETED when any table fell short', () => {
    // A run that finished is not the same as a run that moved all the data.
    expect(deriveRunStatus(['success', 'partial'], false)).toBe('PARTIALLY_COMPLETED');
    expect(deriveRunStatus(['success', 'failed'], false)).toBe('PARTIALLY_COMPLETED');
  });

  it('is FAILED when everything failed, or the job threw', () => {
    expect(deriveRunStatus(['failed', 'failed'], false)).toBe('FAILED');
    expect(deriveRunStatus(['success'], true)).toBe('FAILED');
  });
});
