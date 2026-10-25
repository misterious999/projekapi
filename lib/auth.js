'use strict';

const { app } = require('../config/app');
const store = require('./store');
const { randomToken, safeEqual } = require('./security');

const onlineTouch = new Map();

function setFlash(req, type, message) {
  if (!req.session) return;
  req.session.flash = { type, message };
}

function setFlashOnce(req, type, message) {
  setFlash(req, type, message);
}

async function loadUser(req, res, next) {
  res.locals.currentPath = req.path;
  res.locals.user = null;
  res.locals.flash = null;
  res.locals.csrf = '';
  res.locals.settings = res.locals.settings || null;

  if (!req.session) return next();

  if (!req.session.csrf) req.session.csrf = randomToken(24);
  res.locals.csrf = req.session.csrf;

  if (req.session.flash) {
    res.locals.flash = req.session.flash;
    delete req.session.flash;
  }

  if (req.session.uid) {
    try {
      const user = await store.getUser(req.session.uid);
      if (!user) {
        delete req.session.uid;
      } else if (user.isActive === false) {
        delete req.session.uid;
        res.locals.flash = {
          type: 'error',
          message: 'Akun kamu sedang dinonaktifkan. Hubungi admin untuk informasi lebih lanjut.',
        };
      } else {
        req.user = user;
        res.locals.user = store.safeUser(user);
        const last = onlineTouch.get(user.uid) || 0;
        if (Date.now() - last > 5 * 60 * 1000) {
          onlineTouch.set(user.uid, Date.now());
          store.update(`users/${user.uid}`, { lastSeenAt: Date.now() }).catch(() => {});
        }
      }
    } catch (error) {
      console.error('[auth] loadUser gagal:', error.message);
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  return next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  setFlash(req, 'error', 'Silakan login terlebih dahulu.');
  const nextUrl = encodeURIComponent(req.originalUrl || '/dashboard');
  return res.redirect(`/login?next=${nextUrl}`);
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    setFlash(req, 'error', 'Silakan login terlebih dahulu.');
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl || '/admin')}`);
  }
  if (req.user.role !== 'admin') {
    return res.status(403).render('error', {
      title: 'Akses ditolak',
      status: 403,
      message: 'Halaman ini hanya bisa diakses admin.',
      backUrl: '/dashboard',
    });
  }
  return next();
}

function requireGuest(req, res, next) {
  if (req.user) return res.redirect('/dashboard');
  return next();
}

function csrfProtection(req, res, next) {
  if (!req.session) return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/api/')) return next();

  const token =
    (req.body && (req.body._csrf || req.body.csrf)) ||
    req.headers['x-csrf-token'] ||
    req.headers['csrf-token'];

  if (!token || !req.session.csrf || !safeEqual(token, req.session.csrf)) {
    if (req.accepts('json') && !req.accepts('html')) {
      return res.status(403).json({ status: false, message: 'CSRF token tidak valid. Muat ulang halaman.' });
    }
    return res.status(403).render('error', {
      title: 'Sesi kedaluwarsa',
      status: 403,
      message: 'Token keamanan tidak valid atau sesi sudah kedaluwarsa. Muat ulang halaman lalu coba lagi.',
      backUrl: req.get('referer') || '/',
    });
  }
  return next();
}

async function loginSession(req, uid) {
  await new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
  req.session.uid = uid;
  req.session.csrf = randomToken(24);
  req.session.loggedInAt = Date.now();
  await new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
  await store.update(`users/${uid}`, { lastLoginAt: Date.now(), lastSeenAt: Date.now() }).catch(() => {});
}

async function logoutSession(req) {
  await new Promise((resolve) => {
    req.session.destroy(() => resolve());
  });
}

function safeNext(value, fallback = '/dashboard') {
  const next = String(value || '');
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  return next;
}

function isAdmin(req) {
  return Boolean(req.user && req.user.role === 'admin');
}

function planBadge(user) {
  if (!user) return 'Guest';
  if (user.role === 'admin') return 'Admin';
  return app.name + ' ' + String(user.plan || 'free').toUpperCase();
}

module.exports = {
  setFlash,
  setFlashOnce,
  loadUser,
  requireAuth,
  requireAdmin,
  requireGuest,
  csrfProtection,
  loginSession,
  logoutSession,
  safeNext,
  isAdmin,
  planBadge,
};
