/**
 * Bearer-passphrase authentication for /api/v1.
 *
 * The passphrase is stretched with the same PBKDF2/HKDF recipe as the client.
 * Only its SHA-256 digest is used as a cache key; the passphrase and derived
 * keys are never logged.
 */

import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { findUser, type UserRow } from '../db.js';
import { authKeyHash, keysFor, type SyncKeys } from '../space/crypto.js';

export interface ApiAuth {
  user: UserRow;
  keys: SyncKeys;
}

export interface ApiRequest extends Request {
  apiAuth: ApiAuth;
}

const KEY_CACHE_MS = 10 * 60 * 1000;
const KEY_CACHE_MAX = 50;
const REQUEST_LIMIT = 120;
const DERIVE_LIMIT = 20;

interface CacheEntry {
  user: UserRow;
  keys: SyncKeys;
  expiresAt: number;
}

const keyCache = new Map<string, CacheEntry>();
const requestBuckets = new Map<string, { count: number; resetAt: number }>();
const deriveBuckets = new Map<string, { count: number; resetAt: number }>();

function limited(
  buckets: Map<string, { count: number; resetAt: number }>,
  key: string,
  limit: number,
): boolean {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function unauthorized(res: Response, code: string, message: string): void {
  res.status(401).json({ error: code, message });
}

async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? '';
  const passphrase = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (passphrase.length < 8) {
    unauthorized(res, 'unauthorized', 'A bearer passphrase of at least 8 characters is required.');
    return;
  }

  const ip = clientIp(req);
  const cacheKey = createHash('sha256').update(passphrase).digest('hex');
  let entry = keyCache.get(cacheKey);
  if (entry && entry.expiresAt <= Date.now()) {
    keyCache.delete(cacheKey);
    entry = undefined;
  }

  if (!entry) {
    if (limited(deriveBuckets, ip, DERIVE_LIMIT)) {
      res.status(429).json({ error: 'rate_limited', message: 'Too many key derivations. Try again shortly.' });
      return;
    }

    const keys = await keysFor(passphrase);
    const user = findUser(authKeyHash(keys.authKey));
    if (!user) {
      unauthorized(res, 'unknown_sync_space', 'No sync space matches this passphrase.');
      return;
    }

    entry = { user, keys, expiresAt: Date.now() + KEY_CACHE_MS };
    keyCache.set(cacheKey, entry);

    const now = Date.now();
    for (const [cachedKey, cached] of keyCache) {
      if (cached.expiresAt <= now) keyCache.delete(cachedKey);
    }
    while (keyCache.size > KEY_CACHE_MAX) {
      const oldest = keyCache.keys().next().value;
      if (oldest === undefined) break;
      keyCache.delete(oldest);
    }
  }

  if (limited(requestBuckets, `${entry.user.key_hash}:${ip}`, REQUEST_LIMIT)) {
    res.status(429).json({ error: 'rate_limited', message: 'Too many requests. Slow down.' });
    return;
  }

  (req as ApiRequest).apiAuth = { user: entry.user, keys: entry.keys };
  next();
}

export function apiAuth(req: Request, res: Response, next: NextFunction): void {
  void authenticate(req, res, next).catch(() => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal', message: 'Authentication failed.' });
    }
  });
}
