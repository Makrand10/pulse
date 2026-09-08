import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../../config';
import { ValidationErrorShape } from '../../lib/errors';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const raw = config.encryptionKey;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY is not set');
  }
  const key = base64ToKey(raw);
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to a 32-byte (AES-256) key');
  }
  return key;
}

function base64ToKey(raw: string): Buffer {
  const base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptSecret(blob: string): string {
  const key = getKey();
  const raw = Buffer.from(blob, 'base64');
  if (raw.length < IV_LENGTH + TAG_LENGTH) {
    throw new ValidationErrorShape('encrypted value is malformed');
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function generateEncryptionKey(): string {
  return randomBytes(32).toString('base64');
}