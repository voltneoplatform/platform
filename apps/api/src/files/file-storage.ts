import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHmac, hkdfSync, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { APP_CONFIG, type AppConfig, type FileStorageConfig } from '../config/app-config';

/**
 * Private file storage (spec section 7: private cloud storage with short-lived
 * links). Files are never served directly: an authorised route issues a
 * signed link that expires after FILE_LINK_TTL_SECONDS, and the API streams
 * the file. LocalFileStorage is for development and tests; hosted servers use
 * S3FileStorage (a private Lightsail bucket in Mumbai).
 */
export interface FileStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  open(key: string): Promise<{ stream: Readable; size: number }>;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');

const KEY_RE = /^[a-z0-9-]+\/[a-z0-9-]+\/[a-f0-9-]{36}\.(jpg|png|webp|pdf)$/;

function checkKey(key: string): void {
  if (!KEY_RE.test(key)) throw new Error('Invalid storage key');
}

export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  private pathFor(key: string): string {
    checkKey(key);
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root + '/')) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, data, { mode: 0o600, flag: 'wx' });
  }

  async open(key: string) {
    const path = this.pathFor(key);
    const info = await stat(path);
    return { stream: createReadStream(path), size: info.size };
  }
}

/** The parts of the S3 client this adapter uses, so tests can pass a stand-in. */
export interface S3Like {
  send(command: PutObjectCommand | GetObjectCommand): Promise<unknown>;
}

export class S3FileStorage implements FileStorage {
  private readonly client: S3Like;

  constructor(
    private readonly config: Extract<FileStorageConfig, { kind: 's3' }>,
    client?: S3Like,
  ) {
    this.client =
      client ??
      new S3Client({
        region: config.region,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
      });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    checkKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        ContentLength: data.length,
        // Keys are random, so this only guards against a bug ever overwriting a document.
        IfNoneMatch: '*',
      }),
    );
  }

  async open(key: string) {
    checkKey(key);
    const out = (await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    )) as { Body?: unknown; ContentLength?: number };
    if (!(out.Body instanceof Readable)) throw new Error('Unexpected S3 response body');
    return { stream: out.Body, size: out.ContentLength ?? 0 };
  }
}

/** Picks the adapter from the configuration. */
export function fileStorageFor(config: AppConfig): FileStorage {
  return config.fileStorage.kind === 's3'
    ? new S3FileStorage(config.fileStorage)
    : new LocalFileStorage(config.fileStorage.dir);
}

// ---------------------------------------------------------------------------
// Upload checks: the file's own bytes decide its type, not its name or header.
// ---------------------------------------------------------------------------

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const SIGNATURES: {
  ext: 'jpg' | 'png' | 'webp' | 'pdf';
  mime: string;
  test: (b: Buffer) => boolean;
}[] = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: 'png',
    mime: 'image/png',
    test: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: 'webp',
    mime: 'image/webp',
    test: (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  {
    ext: 'pdf',
    mime: 'application/pdf',
    test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  },
];

export interface CheckedUpload {
  ext: 'jpg' | 'png' | 'webp' | 'pdf';
  mime: string;
  size: number;
  originalName: string;
}

export function checkUpload(
  file: { buffer: Buffer; size: number; originalname: string } | undefined,
): CheckedUpload {
  if (!file || !file.buffer?.length) throw new BadRequestException('Attach a file (photo or PDF)');
  if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('File is larger than 10 MB');
  const sig = SIGNATURES.find((s) => s.test(file.buffer));
  if (!sig) throw new BadRequestException('Only JPEG, PNG, WebP photos or PDF files are accepted');
  const originalName =
    file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || `file.${sig.ext}`;
  return { ext: sig.ext, mime: sig.mime, size: file.size, originalName };
}

export function newFileKey(folder: string, ownerId: string, ext: string): string {
  return `${folder}/${ownerId}/${randomUUID()}.${ext}`;
}

// ---------------------------------------------------------------------------
// Short-lived signed links
// ---------------------------------------------------------------------------

interface LinkPayload {
  k: string; // storage key
  t: string; // content type
  n: string; // download name
  e: number; // expiry, epoch seconds
}

@Injectable()
export class FileLinks {
  private readonly secret: Buffer;
  readonly ttlSeconds: number;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.secret = Buffer.from(
      hkdfSync('sha256', config.jwtAccessSecret, 'voltneo-files', 'links-v1', 32),
    );
    this.ttlSeconds = config.fileLinkTtlSeconds;
  }

  issue(key: string, contentType: string, name: string): { url: string; expiresAt: string } {
    const exp = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    const body = Buffer.from(
      JSON.stringify({ k: key, t: contentType, n: name, e: exp } satisfies LinkPayload),
    ).toString('base64url');
    const sig = createHmac('sha256', this.secret).update(body).digest('base64url');
    return { url: `/v1/files/${body}.${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
  }

  verify(token: string): LinkPayload | null {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = createHmac('sha256', this.secret).update(body).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LinkPayload;
      return p.e * 1000 > Date.now() ? p : null;
    } catch {
      return null;
    }
  }
}
