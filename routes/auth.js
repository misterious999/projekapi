'use strict';

const express = require('express');
const { app } = require('../config/app');
const store = require('../lib/store');
const { hashPassword, verifyPassword, clientIp, MemoryRateLimiter, randomToken, safeEqual } = require('../lib/security');
const { loginSession, logoutSession, setFlash, requireGuest, safeNext } = require('../lib/auth');
const { fetchJson } = require('../lib/http');

const router = express.Router();

const loginLimiter = new MemoryRateLimiter({ windowMs: 15 * 60 * 1000, max: 12 });
const registerLimiter = new MemoryRateLimiter({ windowMs: 60 * 60 * 1000, max: 6 });
const oauthLimiter = new MemoryRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Password minimal 8 karakter.';
  if (value.length > 128) return 'Password maksimal 128 karakter.';
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return 'Password harus berisi huruf dan angka.';
  return '';
}

router.get('/login', requireGuest, async (req, res, next) => {
  try {
    const settings = await store.getSettings();
    res.render('login', {
      title: `Masuk — ${app.name}`,
      description: 'Masuk ke dashboard API ZeroixApi.',
      bodyClass: 'page-auth',
      settings,
      next: safeNext(req.query.next || '', '/dashboard'),
      loggedOut: req.query.logout === '1',
      registered: req.query.registered === '1',
      ref: String(req.query.ref || '').trim(),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login', requireGuest, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const nextUrl = safeNext(req.body.next || req.query.next || '', '/dashboard');
    const limit = loginLimiter.consume(`${clientIp(req)}:${email}`);
    if (!limit.allowed) {
      setFlash(req, 'error', `Terlalu banyak percobaan login. Coba lagi dalam ${limit.retryAfter} detik.`);
      return res.redirect('/login');
    }
    if (!email || !password) {
      setFlash(req, 'error', 'Email dan password wajib diisi.');
      return res.redirect(`/login?next=${encodeURIComponent(nextUrl)}`);
    }

    const user = await store.getUserByEmail(email);
    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      setFlash(req, 'error', 'Email atau password salah.');
      return res.redirect(`/login?next=${encodeURIComponent(nextUrl)}`);
    }
    if (user.isActive === false) {
      setFlash(req, 'error', 'Akun ini sedang dinonaktifkan. Hubungi admin untuk bantuan.');
      return res.redirect('/login');
    }

    await loginSession(req, user.uid);
    setFlash(req, 'success', `Selamat datang kembali, ${user.name || user.username}!`);
    return res.redirect(nextUrl);
  } catch (error) {
    return next(error);
  }
});

router.get('/register', requireGuest, async (req, res, next) => {
  try {
    const settings = await store.getSettings();
    res.render('register', {
      title: `Daftar — ${app.name}`,
      description: 'Buat akun gratis dan dapatkan API key pertamamu.',
      bodyClass: 'page-auth',
      settings,
      ref: String(req.query.ref || '').trim(),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/register', requireGuest, async (req, res, next) => {
  try {
    const settings = await store.getSettings();
    if (!settings.registrationOpen) {
      setFlash(req, 'error', 'Pendaftaran sedang ditutup sementara. Coba lagi nanti.');
      return res.redirect('/register');
    }

    const limit = registerLimiter.consume(clientIp(req));
    if (!limit.allowed) {
      setFlash(req, 'error', `Terlalu banyak pendaftaran dari IP ini. Coba lagi dalam ${limit.retryAfter} detik.`);
      return res.redirect('/register');
    }

    const name = String(req.body.name || '').trim().slice(0, 60);
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm || '');
    const ref = String(req.body.ref || req.query.ref || '').trim().toUpperCase();
    const agree = req.body.agree === 'on' || req.body.agree === 'true';

    if (!name || !username || !email || !password) {
      setFlash(req, 'error', 'Semua field wajib diisi.');
      return res.redirect('/register');
    }
    if (!/^[a-z0-9_.-]{3,24}$/i.test(username)) {
      setFlash(req, 'error', 'Username 3-24 karakter: huruf, angka, titik, garis bawah, atau strip.');
      return res.redirect('/register');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFlash(req, 'error', 'Format email tidak valid.');
      return res.redirect('/register');
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      setFlash(req, 'error', passwordError);
      return res.redirect('/register');
    }
    if (password !== confirm) {
      setFlash(req, 'error', 'Konfirmasi password tidak cocok.');
      return res.redirect('/register');
    }
    if (!agree) {
      setFlash(req, 'error', 'Kamu perlu menyetujui syarat dan kebijakan privasi.');
      return res.redirect('/register');
    }
    if (ref) {
      const referrer = await store.getUserByReferralCode(ref);
      if (!referrer) {
        setFlash(req, 'error', 'Kode referral tidak valid.');
        return res.redirect('/register');
      }
    }

    const created = await store.createUser({
      email,
      username,
      name,
      passwordHash: hashPassword(password),
      plan: 'free',
      quotaLimit: app.freePlanQuota,
      referredBy: ref || '',
      ip: clientIp(req),
    });

    await loginSession(req, created.uid);
    req.session.newApiKey = created.__firstApiKey;
    setFlash(req, 'success', 'Akun berhasil dibuat. API key pertamamu sudah siap.');
    return res.redirect('/dashboard/api');
  } catch (error) {
    if (error && error.message && /sudah|valid|karakter/i.test(error.message)) {
      setFlash(req, 'error', error.message);
      return res.redirect('/register');
    }
    return next(error);
  }
});

router.post('/logout', async (req, res) => {
  await logoutSession(req);
  res.redirect('/login?logout=1');
});

router.get('/forgot-password', requireGuest, async (req, res, next) => {
  try {
    const settings = await store.getSettings();
    res.render('forgot', {
      title: `Lupa Password — ${app.name}`,
      description: 'Panduan reset password akun ZeroixApi.',
      bodyClass: 'page-auth',
      settings,
    });
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ */
/* OAuth                                                              */
/* ------------------------------------------------------------------ */

function oauthState(req, provider) {
  const state = randomToken(24);
  req.session.oauthState = { state, provider, createdAt: Date.now() };
  return state;
}

function validOauthState(req, provider) {
  const saved = req.session.oauthState;
  if (!saved || saved.provider !== provider) return false;
  if (Date.now() - Number(saved.createdAt || 0) > 10 * 60 * 1000) return false;
  return String(req.query.state || '') === saved.state;
}

function clearOauthState(req) {
  if (req.session) delete req.session.oauthState;
}

function oauthRedirectUri(provider) {
  return `${app.url}/auth/${provider}/callback`;
}

router.get('/auth/google', requireGuest, (req, res) => {
  if (!app.oauth.google.enabled) {
    setFlash(req, 'error', 'Login Google belum dikonfigurasi. Isi GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET.');
    return res.redirect('/login');
  }
  const limit = oauthLimiter.consume(clientIp(req));
  if (!limit.allowed) {
    setFlash(req, 'error', 'Terlalu banyak percobaan. Coba lagi nanti.');
    return res.redirect('/login');
  }
  const state = oauthState(req, 'google');
  const params = new URLSearchParams({
    client_id: app.oauth.google.clientId,
    redirect_uri: oauthRedirectUri('google'),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    access_type: 'online',
  });
  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/auth/google/callback', async (req, res) => {
  try {
    if (req.query.error) {
      setFlash(req, 'error', 'Login Google dibatalkan.');
      return res.redirect('/login');
    }
    if (!app.oauth.google.enabled || !validOauthState(req, 'google')) {
      setFlash(req, 'error', 'Sesi login Google tidak valid. Coba lagi.');
      return res.redirect('/login');
    }
    clearOauthState(req);

    const token = await fetchJson(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(req.query.code || ''),
          client_id: app.oauth.google.clientId,
          client_secret: app.oauth.google.clientSecret,
          redirect_uri: oauthRedirectUri('google'),
          grant_type: 'authorization_code',
        }).toString(),
      },
      15000
    );
    if (!token.access_token) throw new Error('Google tidak mengembalikan access token.');
    const profile = await fetchJson('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    }, 15000);

    if (!profile.email) throw new Error('Email Google tidak tersedia.');
    if (profile.email_verified === false) throw new Error('Email Google belum terverifikasi.');

    const user = await store.findOrCreateUserForProvider({
      provider: 'google',
      providerId: profile.sub,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture,
    });
    if (user.isActive === false) throw new Error('Akun sedang dinonaktifkan.');
    await loginSession(req, user.uid);
    setFlash(req, 'success', `Selamat datang, ${user.name || user.username}!`);
    return res.redirect('/dashboard');
  } catch (error) {
    console.error('[oauth:google]', error.message);
    setFlash(req, 'error', 'Gagal masuk dengan Google: ' + error.message);
    return res.redirect('/login');
  }
});

router.get('/auth/github', requireGuest, (req, res) => {
  if (!app.oauth.github.enabled) {
    setFlash(req, 'error', 'Login GitHub belum dikonfigurasi. Isi GITHUB_CLIENT_ID dan GITHUB_CLIENT_SECRET.');
    return res.redirect('/login');
  }
  const limit = oauthLimiter.consume(clientIp(req));
  if (!limit.allowed) {
    setFlash(req, 'error', 'Terlalu banyak percobaan. Coba lagi nanti.');
    return res.redirect('/login');
  }
  const state = oauthState(req, 'github');
  const params = new URLSearchParams({
    client_id: app.oauth.github.clientId,
    redirect_uri: oauthRedirectUri('github'),
    scope: 'read:user user:email',
    state,
  });
  return res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

router.get('/auth/github/callback', async (req, res) => {
  try {
    if (req.query.error) {
      setFlash(req, 'error', 'Login GitHub dibatalkan.');
      return res.redirect('/login');
    }
    if (!app.oauth.github.enabled || !validOauthState(req, 'github')) {
      setFlash(req, 'error', 'Sesi login GitHub tidak valid. Coba lagi.');
      return res.redirect('/login');
    }
    clearOauthState(req);

    const token = await fetchJson(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: app.oauth.github.clientId,
          client_secret: app.oauth.github.clientSecret,
          code: String(req.query.code || ''),
          redirect_uri: oauthRedirectUri('github'),
        }),
      },
      15000
    );
    if (!token.access_token) throw new Error(token.error_description || 'GitHub tidak mengembalikan access token.');

    const profile = await fetchJson('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json' },
    }, 15000);

    let email = profile.email;
    if (!email) {
      const emails = await fetchJson('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json' },
      }, 15000);
      const primary = Array.isArray(emails) ? emails.find((item) => item.primary && item.verified) : null;
      email = primary ? primary.email : null;
    }
    if (!email) throw new Error('Email GitHub tidak tersedia. Publikasikan email atau hubungi admin.');

    const user = await store.findOrCreateUserForProvider({
      provider: 'github',
      providerId: profile.id,
      email,
      name: profile.name || profile.login,
      avatarUrl: profile.avatar_url,
    });
    if (user.isActive === false) throw new Error('Akun sedang dinonaktifkan.');
    await loginSession(req, user.uid);
    setFlash(req, 'success', `Selamat datang, ${user.name || user.username}!`);
    return res.redirect('/dashboard');
  } catch (error) {
    console.error('[oauth:github]', error.message);
    setFlash(req, 'error', 'Gagal masuk dengan GitHub: ' + error.message);
    return res.redirect('/login');
  }
});

module.exports = router;
