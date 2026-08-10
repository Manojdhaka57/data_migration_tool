/**
 * Encryption for secrets stored in the metadata database — currently database
 * connection passwords.
 *
 * Deliberately NOT the same cipher as TransformationEngine's PII encryption.
 * That one derives its IV from the plaintext so identical values encrypt
 * identically, which is required for equality lookups on migrated columns but
 * leaks whether two records share a value. Stored credentials have no such
 * requirement, so this uses a random IV per encryption — the same password
 * encrypted twice produces different ciphertext.
 *
 * Key comes from APP_SECRET_KEY, kept separate from ENCRYPTION_KEY so rotating
 * the credential key never touches already-migrated PII.
 *
 * Format: base64( version(1) || iv(12) || ciphertext || tag(16) )
 */
import * as crypto from 'crypto';

const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

export class MissingSecretKeyError extends Error {
  constructor() {
    super(
      'APP_SECRET_KEY is not set. It is required to store connection credentials ' +
      'encrypted. Generate one with: openssl rand -base64 32',
    );
    this.name = 'MissingSecretKeyError';
  }
}

/**
 * Accepts a 32-byte base64 key. Anything else is hashed to 32 bytes so a
 * passphrase still works, though a generated key is strongly preferred.
 */
function resolveKey(): Buffer {
  const raw = process.env.APP_SECRET_KEY?.trim();
  if (!raw) throw new MissingSecretKeyError();

  try {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === KEY_LEN) return decoded;
  } catch {
    // fall through to the digest below
  }
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

export function hasSecretKey(): boolean {
  return !!process.env.APP_SECRET_KEY?.trim();
}

export function encryptSecret(plaintext: string): string {
  const key = resolveKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([Buffer.from([VERSION]), iv, ciphertext, tag]).toString('base64');
}

export function decryptSecret(blob: string): string {
  const key = resolveKey();
  const buf = Buffer.from(blob, 'base64');

  if (buf.length < 1 + IV_LEN + TAG_LEN) {
    throw new Error('Encrypted secret is malformed (too short)');
  }
  const version = buf[0];
  if (version !== VERSION) {
    throw new Error(`Unsupported encrypted secret version: ${version}`);
  }

  const iv = buf.subarray(1, 1 + IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(1 + IV_LEN, buf.length - TAG_LEN);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
