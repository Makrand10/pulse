import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../../src/modules/apis/crypto';

describe('encryptSecret / decryptSecret (AES-256-GCM)', () => {
  it('round-trips a secret', () => {
    const secret = 'sk-secret-token-123';
    const blob = encryptSecret(secret);
    expect(blob).not.toContain(secret);
    expect(decryptSecret(blob)).toBe(secret);
  });

  it('produces unique ciphertext for the same input (random IV)', () => {
    const a = encryptSecret('same-input');
    const b = encryptSecret('same-input');
    expect(a).not.toBe(b);
  });

  it('encrypts an empty-increment boundary and long values', () => {
    const long = 'x'.repeat(4000);
    expect(decryptSecret(encryptSecret(long))).toBe(long);
    expect(decryptSecret(encryptSecret(''))).toBe('');
  });

  it('throws on tampered ciphertext (GCM auth tag)', () => {
    const blob = encryptSecret('integrity');
    const buf = Buffer.from(blob, 'base64');
    buf[buf.length - 1] ^= 0xff;
    expect(() => decryptSecret(buf.toString('base64'))).toThrow();
  });

  it('throws on malformed blob', () => {
    expect(() => decryptSecret('aGk=')).toThrow();
    expect(() => decryptSecret('')).toThrow();
  });
});