import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { KYC_DOC_INFO, normaliseDocNumber, type KycDocType } from '@voltneo/shared';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

const KEY_VERSION = 'v1';

export interface ProtectedNumber {
  /** AES-256-GCM ciphertext, or null when the type keeps only the last 4 (Aadhaar). */
  encrypted: string | null;
  last4: string;
  /** Keyed fingerprint for finding the same document on two drivers. */
  index: string;
}

/**
 * Protects KYC ID numbers (spec section 7: encrypted in the database, masked
 * on screen). Two keys are derived from KYC_ENCRYPTION_KEY: one encrypts, the
 * other makes fingerprints, so the fingerprint cannot be reversed without the key.
 */
@Injectable()
export class KycCryptoService {
  private readonly encKey: Buffer;
  private readonly indexKey: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const derive = (info: string) =>
      Buffer.from(hkdfSync('sha256', config.kycEncryptionKey, 'voltneo-kyc', info, 32));
    this.encKey = derive('encrypt-v1');
    this.indexKey = derive('index-v1');
  }

  protect(type: KycDocType, rawNumber: string): ProtectedNumber {
    const n = normaliseDocNumber(rawNumber);
    return {
      encrypted: KYC_DOC_INFO[type].storeLast4Only ? null : this.encrypt(n),
      last4: n.slice(-4),
      index: this.fingerprint(type, n),
    };
  }

  fingerprint(type: KycDocType, rawNumber: string): string {
    return createHmac('sha256', this.indexKey)
      .update(`${type}:${normaliseDocNumber(rawNumber)}`)
      .digest('hex');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `${KEY_VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`;
  }

  decrypt(stored: string): string {
    const [version, body] = stored.split(':');
    if (version !== KEY_VERSION || !body) throw new Error('Unknown KYC encryption version');
    const buf = Buffer.from(body, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  }
}
