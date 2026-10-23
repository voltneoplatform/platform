import { loadConfig } from '../config/app-config';
import { KycCryptoService } from '../kyc/kyc-crypto.service';
import { FileLinks, checkUpload, newFileKey } from './file-storage';

const config = loadConfig({
  DATABASE_URL: 'postgresql://x@localhost/db',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  OTP_HASH_SECRET: 'b'.repeat(40),
  KYC_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  FILE_LINK_TTL_SECONDS: '60',
});

describe('signed file links', () => {
  afterEach(() => vi.useRealTimers());

  it('opens before expiry and refuses after', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T10:00:00Z'));
    const links = new FileLinks(config);
    const { url, expiresAt } = links.issue(
      'kyc/d/00000000-0000-0000-0000-000000000000.png',
      'image/png',
      'a.png',
    );
    expect(expiresAt).toBe('2026-10-23T10:01:00.000Z');
    const token = url.replace('/v1/files/', '');
    expect(links.verify(token)?.k).toBe('kyc/d/00000000-0000-0000-0000-000000000000.png');
    vi.setSystemTime(new Date('2026-10-23T10:01:01Z'));
    expect(links.verify(token)).toBeNull();
  });

  it('refuses links signed with another secret', () => {
    const other = new FileLinks({ ...config, jwtAccessSecret: 'z'.repeat(40) });
    const token = other.issue('kyc/d/x.png', 'image/png', 'a.png').url.replace('/v1/files/', '');
    expect(new FileLinks(config).verify(token)).toBeNull();
  });
});

describe('upload checks', () => {
  it('names files by a random key, never by the uploaded name', () => {
    expect(newFileKey('kyc', 'driver-1', 'png')).toMatch(/^kyc\/driver-1\/[0-9a-f-]{36}\.png$/);
  });

  it('cleans uploaded file names', () => {
    const pdf = Buffer.from('%PDF-1.7 body');
    expect(
      checkUpload({ buffer: pdf, size: pdf.length, originalname: '../../etc/pass<wd>.pdf' })
        .originalName,
    ).toBe('.._.._etc_pass_wd_.pdf');
  });
});

describe('KYC number protection', () => {
  const crypto = new KycCryptoService(config);

  it('encrypts with a fresh nonce each time and decrypts back', () => {
    const a = crypto.encrypt('WBX1234567');
    const b = crypto.encrypt('WBX1234567');
    expect(a).not.toBe(b);
    expect(crypto.decrypt(a)).toBe('WBX1234567');
  });

  it('detects tampering', () => {
    const c = crypto.encrypt('ABCDE1234F');
    const body = Buffer.from(c.slice(3), 'base64');
    body[body.length - 1]! ^= 1;
    expect(() => crypto.decrypt(`v1:${body.toString('base64')}`)).toThrow();
  });

  it('makes the same fingerprint for the same number however it is typed, per document type', () => {
    expect(crypto.fingerprint('PAN', 'abcde 1234 f')).toBe(crypto.fingerprint('PAN', 'ABCDE1234F'));
    expect(crypto.fingerprint('PAN', 'ABCDE1234F')).not.toBe(
      crypto.fingerprint('OTHER_ID', 'ABCDE1234F'),
    );
  });

  it('never keeps a full Aadhaar number', () => {
    expect(crypto.protect('AADHAAR', '2345 6789 0123')).toMatchObject({
      encrypted: null,
      last4: '0123',
    });
  });
});
