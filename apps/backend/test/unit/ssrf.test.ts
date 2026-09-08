import { describe, expect, it } from 'vitest';
import { assertUrlProbeable, isPublicIp } from '../../src/lib/ssrf';

describe('ssrf guard - assertUrlProbeable', () => {
  it('accepts a public https URL', () => {
    expect(() => assertUrlProbeable('https://example.com/health')).not.toThrow();
  });

  it('accepts a public http URL with port', () => {
    expect(() => assertUrlProbeable('http://example.com:8080/')).not.toThrow();
  });

  it('rejects non-http(s) schemes', () => {
    expect(() => assertUrlProbeable('ftp://example.com/')).toThrow();
    expect(() => assertUrlProbeable('file:///etc/passwd')).toThrow();
    expect(() => assertUrlProbeable('gopher://example.com/')).toThrow();
  });

  it('rejects malformed URLs', () => {
    expect(() => assertUrlProbeable('not-a-url')).toThrow();
    expect(() => assertUrlProbeable('')).toThrow();
  });

  it('rejects URL with no hostname', () => {
    expect(() => assertUrlProbeable('http://')).toThrow();
    expect(() => assertUrlProbeable('https://:8080')).toThrow();
  });

  it.each(['http://localhost', 'https://localhost:3000', 'http://LOCALHOST'])(
    'rejects hostname %s',
    (url) => {
      expect(() => assertUrlProbeable(url)).toThrow();
    },
  );

  it.each(['http://foo.local', 'http://svc.internal/heartbeat', 'http://printer.lan'])(
    'rejects private-looking hostname %s',
    (url) => {
      expect(() => assertUrlProbeable(url)).toThrow();
    },
  );

  it.each([
    'http://127.0.0.1:7000',
    'http://10.25.0.1/app',
    'http://172.16.5.4:3000/',
    'http://192.168.1.25/x',
    'http://169.254.169.254/latest/meta-data',
    'http://0.0.0.0/',
    'http://[::1]:8080/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
  ])('rejects private/loopback IP literal %s', (url) => {
    expect(() => assertUrlProbeable(url)).toThrow();
  });

  it('rejects AWS metadata IP', () => {
    expect(() => assertUrlProbeable('http://169.254.169.254/latest/meta-data/')).toThrow();
  });

  it('rejects IPv4-mapped IPv6 loopback', () => {
    expect(() => assertUrlProbeable('http://[::ffff:127.0.0.1]/')).toThrow();
  });

  it('rejects documentation range 2001:db8::/32', () => {
    expect(() => assertUrlProbeable('http://[2001:db8::1]/')).toThrow();
  });
});

describe('ssrf guard - isPublicIp', () => {
  it('classifies public addresses as public', () => {
    expect(isPublicIp('8.8.8.8')).toBe(true);
    expect(isPublicIp('1.1.1.1')).toBe(true);
    expect(isPublicIp('2606:4700:4700::1111')).toBe(true);
  });

  it('classifies private/loopback as non-public', () => {
    expect(isPublicIp('127.0.0.1')).toBe(false);
    expect(isPublicIp('10.0.0.1')).toBe(false);
    expect(isPublicIp('192.168.1.1')).toBe(false);
    expect(isPublicIp('172.16.0.1')).toBe(false);
    expect(isPublicIp('100.64.0.1')).toBe(false);
    expect(isPublicIp('::1')).toBe(false);
    expect(isPublicIp('fe80::1')).toBe(false);
    expect(isPublicIp('fd00::1')).toBe(false);
  });
});