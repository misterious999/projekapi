'use strict';

const crypto = require('crypto');
const { app } = require('../config/app');

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * Password disimpan sebagai scrypt$<salt>$<hash>. Tidak pernah disimpan mentah.
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [algorithm, salt, hash] = String(stored || '').split('$');
    if (algorithm !== 'scrypt' || !salt || !hash) return false;
    const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
    const expected = Buffer.from(hash, 'hex');
    if (expected.length !== derived.length) return false;
    return crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function encryptionKey() {
  return crypto.createHash('sha256').update(String(app.keySecret)).digest();
}

function encrypt(value) {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decrypt(payload) {
  if (!payload) return '';
  try {
    const [version, ivB64, tagB64, dataB64] = String(payload).split('.');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

const KEY_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomKeyPart(length = 36) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return out;
}

function generateApiKey() {
  return `nusa_${randomKeyPart(36)}`;
}

function validCustomKey(value) {
  const key = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) {
    return { ok: false, message: 'API key harus 8-80 karakter: huruf, angka, garis bawah, atau strip.' };
  }
  if (/^(free|freelimit|admin|test)$/i.test(key)) {
    return { ok: false, message: 'API key tersebut dicadangkan. Pilih yang lain.' };
  }
  return { ok: true, key };
}

function maskKey(key, visible = 4) {
  const value = String(key || '');
  if (!value) return 'Belum ada API key';
  if (value.length <= visible + 8) return value.slice(0, 4) + '...' + value.slice(-visible);
  return `${value.slice(0, 12)}…${value.slice(-visible)}`;
}

function clientIp(req) {
  const forwarded = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || req.ip || '-';
}

function normalizeIp(ip) {
  return String(ip || '')
    .replace(/^::ffff:/i, '')
    .replace(/^\[|\]$/g, '')
    .trim();
}

function ipToLong(ip) {
  const parts = normalizeIp(ip).split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return null;
    value = value * 256 + num;
  }
  return value;
}

/**
 * Mendukung IP persis dan CIDR IPv4 (contoh 103.10.0.0/24).
 */
function ipMatches(rule, ip) {
  const cleanRule = normalizeIp(rule);
  const cleanIp = normalizeIp(ip);
  if (!cleanRule || !cleanIp) return false;
  if (!cleanRule.includes('/')) return cleanRule === cleanIp;
  const [network, bitsRaw] = cleanRule.split('/');
  const bits = Number(bitsRaw);
  const networkLong = ipToLong(network);
  const ipLong = ipToLong(cleanIp);
  if (networkLong === null || ipLong === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (networkLong & mask) === (ipLong & mask);
}

function isIpAllowed(user, ip) {
  if (!user || user.allowAllIp !== false) return true;
  const list = Array.isArray(user.ipWhitelist) ? user.ipWhitelist : [];
  return list.some((entry) => ipMatches(entry, ip));
}

/**
 * Rate limiter in-memory sederhana. Untuk deployment multi-instance,
 * ganti dengan Redis/Upstash. Cukup untuk satu proses Node.
 */
class MemoryRateLimiter {
  constructor({ windowMs = 60_000, max = 60 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map();
    this.timer = setInterval(() => this.cleanup(), Math.max(windowMs, 60_000));
    if (this.timer.unref) this.timer.unref();
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
  }

  consume(key, cost = 1) {
    const now = Date.now();
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += cost;
    return {
      allowed: entry.count <= this.max,
      limit: this.max,
      remaining: Math.max(0, this.max - entry.count),
      resetAt: entry.resetAt,
      retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

module.exports = {
  hashPassword,
  verifyPassword,
  sha256,
  randomToken,
  encrypt,
  decrypt,
  generateApiKey,
  validCustomKey,
  maskKey,
  clientIp,
  normalizeIp,
  ipMatches,
  isIpAllowed,
  MemoryRateLimiter,
  safeEqual,
};
