'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const {
  app: config,
  plans,
  categories,
  endpoints,
  getPlan,
  planRank,
  formatIDR,
  formatNumber,
  formatDate,
  formatDateTime,
  formatBytes,
  formatUptime,
  timeAgo,
  initials,
} = require('./config/app');
const { db } = require('./config/firebase');
const store = require('./lib/store');
const { loadUser, csrfProtection } = require('./lib/auth');
const { FirebaseSessionStore } = require('./lib/session-store');

const publicRoutes = require('./routes/public');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const docsRoutes = require('./routes/docs');
const monitorRoutes = require('./routes/monitor');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.locals.app = config;
app.locals.plans = plans;
app.locals.categories = categories;
app.locals.endpoints = endpoints;
app.locals.getPlan = getPlan;
app.locals.planRank = planRank;
app.locals.formatIDR = formatIDR;
app.locals.formatNumber = formatNumber;
app.locals.formatDate = formatDate;
app.locals.formatDateTime = formatDateTime;
app.locals.formatBytes = formatBytes;
app.locals.formatUptime = formatUptime;
app.locals.timeAgo = timeAgo;
app.locals.initials = initials;
app.locals.currentYear = config.year;
app.locals.settings = null;

// Header keamanan dasar. CSP mengizinkan font Google dan Lucide dari CDN.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://wa.me",
    ].join('; ')
  );
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: config.isProd ? '7d' : 0,
    etag: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

app.use(express.json({ limit: '128kb' }));
app.use(express.urlencoded({ extended: false, limit: '128kb' }));

const sessionStore = new FirebaseSessionStore({
  ttlMs: config.sessionDays * 24 * 60 * 60 * 1000,
});

app.use(
  session({
    name: 'nusa.sid',
    secret: config.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
    },
  })
);

app.use(loadUser);
app.use(csrfProtection);

app.use('/', publicRoutes);
app.use('/', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/docs', docsRoutes);
app.use('/monitor', monitorRoutes);
app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);

// 404
app.use(async (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      status: false,
      code: 404,
      error: 'not_found',
      message: 'Endpoint tidak ditemukan.',
    });
  }
  let settings = null;
  try {
    settings = await store.getSettings();
  } catch {
    settings = null;
  }
  return res.status(404).render('error', {
    title: `Halaman tidak ditemukan — ${config.name}`,
    status: 404,
    message: 'Halaman yang kamu cari tidak ada atau sudah dipindahkan.',
    backUrl: '/',
    settings,
  });
});

// Error handler
app.use(async (error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('[error]', req.method, req.originalUrl, error);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({
      status: false,
      code: 500,
      error: 'internal_error',
      message: 'Terjadi kesalahan pada server.',
    });
  }
  let settings = null;
  try {
    settings = await store.getSettings();
  } catch {
    settings = null;
  }
  return res.status(500).render('error', {
    title: `Terjadi kesalahan — ${config.name}`,
    status: 500,
    message: config.isProd ? 'Terjadi kesalahan pada server. Coba beberapa saat lagi.' : error.message,
    backUrl: req.get('referer') || '/',
    settings,
  });
});

let server = null;

async function start() {
  await store.seed();

  if (!config.isProd) {
    if (config.sessionSecret.includes('change-me')) {
      console.warn('[warn] SESSION_SECRET masih default. Ganti sebelum production.');
    }
    if (config.keySecret.includes('change-me')) {
      console.warn('[warn] KEY_ENCRYPTION_SECRET masih default. Ganti sebelum production.');
    }
  }

  server = app.listen(config.port, '0.0.0.0', () => {
    console.log('');
    console.log(`  ${config.name} v${config.version}`);
    console.log(`  ${config.url}`);
    console.log(`  Admin: ${config.adminEmail}`);
    console.log(`  Docs : ${config.url}/docs`);
    console.log(`  Mode : ${config.env}`);
    console.log('');
  });
  return server;
}

async function shutdown(signal) {
  console.log(`\n[${signal}] Menutup server...`);
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    await db.app.delete();
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

if (require.main === module) {
  start().catch((error) => {
    console.error('Gagal menjalankan aplikasi:', error);
    process.exit(1);
  });
}

module.exports = { app, start };
