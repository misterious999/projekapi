'use strict';

const express = require('express');
const crypto = require('crypto');
const { app, endpoints, getPlan } = require('../config/app');
const { handlers } = require('../services/handlers');
const store = require('../lib/store');
const { sha256, clientIp, isIpAllowed, MemoryRateLimiter } = require('../lib/security');
const {
  consumeUserQuota,
  consumeFreeLimit,
  isPlanAllowed,
  recordRequest,
  getFreeLimitState,
} = require('../lib/usage');
const { ApiError } = require('../lib/http');

const router = express.Router();

const accountLimiter = new MemoryRateLimiter({ windowMs: 60_000, max: 120 });
const freeLimitLimiter = new MemoryRateLimiter({ windowMs: 60_000, max: 20 });

router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-API-Key, Content-Type, Accept');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'X-Request-Id, X-Response-Time, X-Quota-Limit, X-Quota-Remaining, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset'
  );
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-API-Version', app.version);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  return next();
});

function extractKey(req) {
  const authorization = String(req.headers.authorization || '').trim();
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '').trim();
  const headerKey = req.headers['x-api-key'];
  if (headerKey) return String(headerKey).trim();
  return '';
}

function requestId() {
  return 'req_' + crypto.randomBytes(8).toString('hex');
}

function elapsed(start) {
  return Math.max(0, Number(process.hrtime.bigint() - start) / 1e6);
}

function setQuotaHeaders(res, quota) {
  if (!quota) return;
  if (quota.limit !== undefined) res.setHeader('X-Quota-Limit', String(quota.limit));
  if (quota.remaining !== undefined) res.setHeader('X-Quota-Remaining', String(quota.remaining));
  if (quota.used !== undefined) res.setHeader('X-Quota-Used', String(quota.used));
}

function sendError(req, res, error, context = {}) {
  const started = context.started || process.hrtime.bigint();
  const status = Number(error.status) || 500;
  const body = {
    status: false,
    code: status,
    error: error.code || 'internal_error',
    message: status >= 500 ? 'Terjadi kesalahan pada server. Coba lagi atau hubungi admin.' : error.message,
    ...(error.details ? { details: error.details } : {}),
    meta: {
      requestId: context.requestId,
      latencyMs: Math.round(elapsed(started)),
      ...(context.endpoint ? { endpoint: context.endpoint.id } : {}),
      ...(context.quota ? { quota: { limit: context.quota.limit, remaining: context.quota.remaining } } : {}),
      docs: `${app.url}/docs`,
    },
  };
  if (status === 429 && error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
  res.status(status).json(body);

  setImmediate(() => {
    recordRequest({
      uid: context.user ? context.user.uid : null,
      username: context.user ? context.user.username : 'public',
      endpoint: context.endpoint ? context.endpoint.id : 'unknown',
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status,
      ms: elapsed(started),
      ip: clientIp(req),
      keyType: context.keyType || 'none',
      requestId: context.requestId,
    }).catch((err) => console.warn('[api] gagal mencatat request:', err.message));
  });
}

async function guard(endpoint, req, res) {
  const context = {
    endpoint,
    requestId: requestId(),
    started: process.hrtime.bigint(),
    keyType: 'none',
    user: null,
    quota: null,
  };
  res.setHeader('X-Request-Id', context.requestId);

  if (endpoint.public) return context;

  const key = extractKey(req);
  if (!key) {
    throw Object.assign(
      new ApiError(
        401,
        'API key tidak ditemukan. Kirim header Authorization: Bearer <API_KEY> atau X-API-Key.',
        'missing_api_key'
      ),
      { context }
    );
  }

  const ip = clientIp(req);

  if (key.toLowerCase() === 'freelimit') {
    const limit = freeLimitLimiter.consume(`free:${ip}`);
    if (!limit.allowed) {
      const error = new ApiError(
        429,
        `Terlalu banyak request dari IP ini. Coba lagi dalam ${limit.retryAfter} detik.`,
        'rate_limited'
      );
      error.retryAfter = limit.retryAfter;
      error.context = context;
      throw error;
    }
    const settings = await store.getSettings();
    const quota = await consumeFreeLimit(settings.freeLimitDaily);
    if (!quota.ok) {
      const reset = new Date(quota.resetAt).toISOString();
      const error = new ApiError(
        429,
        `Kuota FreeLimit hari ini sudah habis. Reset pada ${reset} (00.00 WITA).`,
        'free_limit_exhausted'
      );
      error.details = { resetAt: quota.resetAt, limit: quota.limit };
      error.context = context;
      throw error;
    }
    context.keyType = 'freelimit';
    context.user = {
      uid: null,
      username: 'FreeLimit',
      name: 'FreeLimit Demo',
      plan: 'ultimate',
      role: 'user',
      isActive: true,
      isDemo: true,
      quotaLimit: quota.limit,
      quotaUsed: quota.used,
      expiresAt: null,
    };
    context.quota = { limit: quota.limit, remaining: quota.remaining, used: quota.used };
    res.setHeader('X-RateLimit-Limit', String(limit.limit));
    res.setHeader('X-RateLimit-Remaining', String(limit.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(limit.resetAt / 1000)));
    setQuotaHeaders(res, context.quota);
    return context;
  }

  const rate = accountLimiter.consume(`key:${sha256(key).slice(0, 24)}`);
  if (!rate.allowed) {
    const error = new ApiError(
      429,
      `Rate limit terlampaui. Coba lagi dalam ${rate.retryAfter} detik.`,
      'rate_limited'
    );
    error.retryAfter = rate.retryAfter;
    error.context = context;
    throw error;
  }
  res.setHeader('X-RateLimit-Limit', String(rate.limit));
  res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(rate.resetAt / 1000)));

  const record = await store.getApiKeyRecordByHash(sha256(key));
  if (!record || !record.uid) {
    const error = new ApiError(401, 'API key tidak valid atau sudah dirotasi.', 'invalid_api_key');
    error.context = context;
    throw error;
  }

  const user = await store.getUser(record.uid);
  if (!user) {
    const error = new ApiError(401, 'Akun pemilik API key tidak ditemukan.', 'invalid_api_key');
    error.context = context;
    throw error;
  }
  context.keyType = record.type || 'account';
  context.user = user;

  if (user.isActive === false) {
    const error = new ApiError(403, 'Akun sedang dinonaktifkan. Hubungi admin.', 'account_inactive');
    error.context = context;
    throw error;
  }
  if (user.expiresAt && Number(user.expiresAt) < Date.now()) {
    const error = new ApiError(403, 'Masa aktif paket sudah habis. Perpanjang paket untuk melanjutkan.', 'plan_expired');
    error.details = { expiresAt: user.expiresAt, upgradeUrl: `${app.url}/pricing` };
    error.context = context;
    throw error;
  }
  if (!isIpAllowed(user, ip)) {
    const error = new ApiError(
      403,
      'Alamat IP ini tidak ada di whitelist akun. Perbarui whitelist di dashboard.',
      'ip_not_allowed'
    );
    error.context = context;
    throw error;
  }
  if (!(await isPlanAllowed(user, endpoint.minPlan))) {
    const plan = getPlan(endpoint.minPlan);
    const error = new ApiError(
      403,
      `Endpoint ini membutuhkan paket ${plan.name} atau lebih tinggi.`,
      'plan_required'
    );
    error.details = { requiredPlan: plan.key, currentPlan: user.plan, upgradeUrl: `${app.url}/pricing` };
    error.context = context;
    throw error;
  }

  const quota = await consumeUserQuota(user.uid);
  context.user = quota.user || user;
  if (!quota.ok) {
    if (quota.code === 'quota') {
      const error = new ApiError(
        429,
        'Kuota request akun sudah habis. Upgrade atau redeem kode untuk menambah kuota.',
        'quota_exhausted'
      );
      error.details = {
        limit: Number(context.user.quotaLimit || 0),
        used: Number(context.user.quotaUsed || 0),
        upgradeUrl: `${app.url}/pricing`,
      };
      error.context = context;
      throw error;
    }
    if (quota.code === 'expired') {
      const error = new ApiError(403, 'Masa aktif paket sudah habis. Perpanjang paket untuk melanjutkan.', 'plan_expired');
      error.context = context;
      throw error;
    }
    if (quota.code === 'inactive') {
      const error = new ApiError(403, 'Akun sedang dinonaktifkan. Hubungi admin.', 'account_inactive');
      error.context = context;
      throw error;
    }
    const error = new ApiError(401, 'Akun tidak ditemukan.', 'invalid_api_key');
    error.context = context;
    throw error;
  }

  context.quota = { limit: quota.limit, remaining: quota.remaining, used: quota.used };
  setQuotaHeaders(res, context.quota);
  return context;
}

function endpointHandler(endpoint) {
  const handler = handlers[endpoint.id];
  return async (req, res) => {
    const started = process.hrtime.bigint();
    let context = {
      endpoint,
      requestId: requestId(),
      started,
      keyType: endpoint.public ? 'public' : 'none',
      user: null,
      quota: null,
    };
    try {
      context = await guard(endpoint, req, res);
      context.started = started;

      const input = { ...(req.query || {}), ...(req.body && typeof req.body === 'object' ? req.body : {}) };
      const data = await handler(input, {
        req,
        user: context.user,
        requestId: context.requestId,
        endpoint,
      });

      const latency = Math.round(elapsed(started));
      res.setHeader('X-Request-Id', context.requestId);
      res.setHeader('X-Response-Time', `${latency}ms`);
      res.status(200).json({
        status: true,
        code: 200,
        message: 'success',
        data,
        meta: {
          requestId: context.requestId,
          endpoint: endpoint.id,
          latencyMs: latency,
          ...(context.quota
            ? { quota: { limit: context.quota.limit, remaining: context.quota.remaining, used: context.quota.used } }
            : {}),
        },
      });

      setImmediate(() => {
        recordRequest({
          uid: context.user ? context.user.uid : null,
          username: context.user ? context.user.username : 'public',
          endpoint: endpoint.id,
          method: req.method,
          path: req.originalUrl.split('?')[0],
          status: 200,
          ms: latency,
          ip: clientIp(req),
          keyType: context.keyType,
          requestId: context.requestId,
        }).catch((err) => console.warn('[api] gagal mencatat request:', err.message));
      });
    } catch (error) {
      if (error.context) {
        context = { ...context, ...error.context, started };
      }
      const status = error instanceof ApiError ? error.status : 500;
      if (status >= 500) {
        console.error('[api]', endpoint.id, error);
      }
      sendError(req, res, error, context);
    }
  };
}

// Public status endpoint.
const statusEndpoint = endpoints.find((item) => item.id === 'status');
router.get('/status', endpointHandler(statusEndpoint));

// Semua endpoint lain melalui guard API key.
for (const endpoint of endpoints) {
  if (endpoint.public) continue;
  const path = endpoint.path.replace(/^\/api/, '');
  router.all(path, endpointHandler(endpoint));
}

router.use((req, res) => {
  res.status(404).json({
    status: false,
    code: 404,
    error: 'endpoint_not_found',
    message: `Endpoint ${req.method} ${req.originalUrl.split('?')[0]} tidak ditemukan.`,
    meta: { docs: `${app.url}/docs` },
  });
});

module.exports = router;
