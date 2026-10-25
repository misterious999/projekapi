'use strict';

const express = require('express');
const crypto = require('crypto');
const { app, plans, getPlan, formatIDR, buildOrderMessage, initials } = require('../config/app');
const store = require('../lib/store');
const {
  requireAuth,
  setFlash,
  logoutSession,
  safeNext,
} = require('../lib/auth');
const {
  hashPassword,
  verifyPassword,
  clientIp,
  normalizeIp,
  isIpAllowed,
  decrypt,
} = require('../lib/security');
const { quotaForUser, getUsageSeries } = require('../lib/usage');

const router = express.Router();
router.use(requireAuth);

async function baseData(req) {
  const settings = await store.getSettings();
  return {
    settings,
    planData: getPlan(req.user.plan),
    quota: quotaForUser(req.user),
    announcement: settings.announcementActive === false ? '' : settings.announcement || '',
    bodyClass: 'page-dashboard',
  };
}

async function ownLogs(uid, limit = 6) {
  const logs = await store.getRecentLogs(200);
  return logs.filter((item) => item.uid === uid).slice(0, limit);
}

function validateNewPassword(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Password minimal 8 karakter.';
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return 'Password harus berisi huruf dan angka.';
  return '';
}

function validAvatarUrl(value) {
  if (!value) return true;
  if (value.startsWith('/')) return true;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function validIpRule(value) {
  const clean = normalizeIp(value);
  if (!clean) return false;
  if (clean.includes('/')) {
    const [address, bitsRaw] = clean.split('/');
    const octets = address.split('.');
    const bits = Number(bitsRaw);
    return (
      octets.length === 4 &&
      octets.every((part) => Number.isInteger(Number(part)) && Number(part) >= 0 && Number(part) <= 255) &&
      Number.isInteger(bits) &&
      bits >= 0 &&
      bits <= 32
    );
  }
  if (clean.includes(':')) return /^[0-9a-f:]+$/i.test(clean);
  const octets = clean.split('.');
  return octets.length === 4 && octets.every((part) => Number.isInteger(Number(part)) && Number(part) >= 0 && Number(part) <= 255);
}

router.get('/', async (req, res, next) => {
  try {
    const base = await baseData(req);
    const [usageSeries, recentRequests, transactions, tickets, referral, testimonial] = await Promise.all([
      getUsageSeries(req.user.uid, 14),
      ownLogs(req.user.uid, 6),
      store.getTransactions(req.user.uid, 4),
      store.getTickets(req.user.uid, 3),
      store.getReferralStats(req.user),
      store.getTestimonial(req.user.uid),
    ]);

    res.render('dashboard/overview', {
      title: `Dashboard — ${app.name}`,
      active: 'overview',
      ...base,
      usageSeries,
      recentRequests,
      transactions,
      tickets,
      referral,
      testimonial,
      currentIp: clientIp(req),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/api', async (req, res, next) => {
  try {
    const base = await baseData(req);
    const user = await store.getUser(req.user.uid);
    const [keyRecord, usageSeries] = await Promise.all([
      store.getApiKeyRecord(user),
      getUsageSeries(req.user.uid, 30),
    ]);
    const justCreatedKey = req.session.newApiKey || '';
    if (req.session.newApiKey) delete req.session.newApiKey;

    res.render('dashboard/api', {
      title: `API & Kuota — ${app.name}`,
      active: 'api',
      ...base,
      keyRecord,
      justCreatedKey,
      usageSeries,
      currentIp: clientIp(req),
      allowAllIp: user.allowAllIp !== false,
      ipWhitelist: Array.isArray(user.ipWhitelist) ? user.ipWhitelist : [],
    });
  } catch (error) {
    next(error);
  }
});

router.post('/api/reveal', async (req, res, next) => {
  try {
    const key = await store.revealApiKey(req.user);
    if (!key) return res.status(404).json({ status: false, message: 'API key tidak tersedia.' });
    return res.json({ status: true, key });
  } catch (error) {
    return next(error);
  }
});

router.post('/api/rotate', async (req, res, next) => {
  try {
    const { key } = await store.rotateApiKey(req.user.uid);
    req.session.newApiKey = key;
    setFlash(req, 'success', 'API key berhasil dirotasi. Key lama langsung tidak berlaku.');
    return res.redirect('/dashboard/api');
  } catch (error) {
    setFlash(req, 'error', error.message || 'Gagal merotasi API key.');
    return res.redirect('/dashboard/api');
  }
});

router.post('/api/custom', async (req, res, next) => {
  try {
    const plan = getPlan(req.user.plan);
    if (!plan.customKey && req.user.role !== 'admin') {
      setFlash(req, 'error', `Custom API key tersedia mulai paket ${getPlan('plus').name}.`);
      return res.redirect('/dashboard/api');
    }
    const customKey = String(req.body.customKey || '').trim();
    const { key } = await store.createApiKeyForUser(req.user.uid, { customKey, type: 'custom' });
    req.session.newApiKey = key;
    setFlash(req, 'success', 'Custom API key berhasil disimpan. Simpan key ini di tempat aman.');
    return res.redirect('/dashboard/api');
  } catch (error) {
    setFlash(req, 'error', error.message || 'Gagal menyimpan custom API key.');
    return res.redirect('/dashboard/api');
  }
});

router.post('/api/whitelist', async (req, res, next) => {
  try {
    const user = await store.getUser(req.user.uid);
    const action = String(req.body.action || '').trim();
    const list = Array.isArray(user.ipWhitelist) ? [...user.ipWhitelist] : [];

    if (action === 'toggle') {
      const allowAllIp = req.body.allowAllIp === 'on' || req.body.allowAllIp === 'true';
      await store.updateUser(req.user.uid, { allowAllIp });
      setFlash(req, 'success', allowAllIp ? 'Semua IP diizinkan.' : 'Whitelist IP diaktifkan.');
      return res.redirect('/dashboard/api#whitelist');
    }

    if (action === 'add') {
      const ip = normalizeIp(req.body.ip);
      if (!validIpRule(ip)) {
        setFlash(req, 'error', 'Format IP atau CIDR tidak valid. Contoh: 103.10.20.30 atau 103.10.0.0/24.');
        return res.redirect('/dashboard/api#whitelist');
      }
      if (list.length >= 20) {
        setFlash(req, 'error', 'Maksimal 20 entri whitelist.');
        return res.redirect('/dashboard/api#whitelist');
      }
      if (!list.includes(ip)) list.push(ip);
      await store.updateUser(req.user.uid, { ipWhitelist: list, allowAllIp: false });
      setFlash(req, 'success', `IP ${ip} ditambahkan ke whitelist.`);
      return res.redirect('/dashboard/api#whitelist');
    }

    if (action === 'remove') {
      const ip = normalizeIp(req.body.ip);
      const nextList = list.filter((item) => item !== ip);
      await store.updateUser(req.user.uid, { ipWhitelist: nextList });
      setFlash(req, 'success', `IP ${ip} dihapus dari whitelist.`);
      return res.redirect('/dashboard/api#whitelist');
    }

    setFlash(req, 'error', 'Aksi whitelist tidak dikenal.');
    return res.redirect('/dashboard/api#whitelist');
  } catch (error) {
    next(error);
  }
});

router.get('/billing', async (req, res, next) => {
  try {
    const base = await baseData(req);
    const transactions = await store.getTransactions(req.user.uid, 50);
    res.render('dashboard/billing', {
      title: `Paket & Transaksi — ${app.name}`,
      active: 'billing',
      ...base,
      plans,
      transactions,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/billing/order', async (req, res, next) => {
  try {
    const plan = getPlan(req.body.plan);
    if (!plan || plan.key === 'free') {
      setFlash(req, 'error', 'Pilih paket berbayar untuk melakukan order.');
      return res.redirect('/dashboard/billing');
    }
    const type = req.user.plan === plan.key ? 'renew' : 'purchase';
    const settings = await store.getSettings();
    const trx = await store.createTransaction(req.user, { plan, amount: plan.price, type });
    const message = buildOrderMessage({ user: req.user, plan, type });
    const waUrl = `https://wa.me/${String(settings.waAdmin || app.waAdmin).replace(/\D/g, '')}?text=${encodeURIComponent(
      message + `\n\nID Transaksi: ${trx.id}`
    )}`;
    return res.redirect(waUrl);
  } catch (error) {
    setFlash(req, 'error', error.message || 'Gagal membuat order.');
    return res.redirect('/dashboard/billing');
  }
});

router.post('/billing/redeem', async (req, res, next) => {
  try {
    const result = await store.redeemCode(req.user, req.body.code);
    setFlash(req, 'success', `Kode ${result.code} berhasil ditukar. ${result.message}`);
    return res.redirect('/dashboard/billing');
  } catch (error) {
    setFlash(req, 'error', error.message || 'Kode redeem gagal ditukar.');
    return res.redirect('/dashboard/billing');
  }
});

router.get('/referral', async (req, res, next) => {
  try {
    const base = await baseData(req);
    const referral = await store.getReferralStats(req.user);
    res.render('dashboard/referral', {
      title: `Referral — ${app.name}`,
      active: 'referral',
      ...base,
      referral,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/tickets', async (req, res, next) => {
  try {
    const base = await baseData(req);
    const tickets = await store.getTickets(req.user.uid, 50);
    let selected = null;
    if (req.query.ticket) {
      selected = tickets.find((item) => item.id === req.query.ticket) || null;
    }
    if (!selected && tickets.length) selected = tickets[0];
    res.render('dashboard/tickets', {
      title: `Tiket Support — ${app.name}`,
      active: 'tickets',
      ...base,
      tickets,
      selected,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/tickets', async (req, res, next) => {
  try {
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();
    const priority = String(req.body.priority || 'normal');
    if (subject.length < 5) {
      setFlash(req, 'error', 'Subjek tiket minimal 5 karakter.');
      return res.redirect('/dashboard/tickets');
    }
    if (message.length < 10) {
      setFlash(req, 'error', 'Pesan tiket minimal 10 karakter.');
      return res.redirect('/dashboard/tickets');
    }
    const ticket = await store.createTicket(req.user, { subject, message, priority });
    setFlash(req, 'success', 'Tiket berhasil dibuat. Admin akan membalas di halaman ini.');
    return res.redirect(`/dashboard/tickets?ticket=${encodeURIComponent(ticket.id)}`);
  } catch (error) {
    setFlash(req, 'error', error.message || 'Gagal membuat tiket.');
    return res.redirect('/dashboard/tickets');
  }
});

router.post('/tickets/:id/reply', async (req, res, next) => {
  try {
    const ticket = await store.getTicket(req.params.id);
    if (!ticket || ticket.uid !== req.user.uid) {
      setFlash(req, 'error', 'Tiket tidak ditemukan.');
      return res.redirect('/dashboard/tickets');
    }
    const message = String(req.body.message || '').trim();
    if (!message) {
      setFlash(req, 'error', 'Tulis balasan terlebih dahulu.');
      return res.redirect(`/dashboard/tickets?ticket=${ticket.id}`);
    }
    await store.replyTicket(ticket.id, {
      by: 'user',
      byName: req.user.name || req.user.username,
      message,
    });
    setFlash(req, 'success', 'Balasan terkirim.');
    return res.redirect(`/dashboard/tickets?ticket=${ticket.id}`);
  } catch (error) {
    next(error);
  }
});

router.post('/tickets/:id/close', async (req, res, next) => {
  try {
    const ticket = await store.getTicket(req.params.id);
    if (!ticket || ticket.uid !== req.user.uid) {
      setFlash(req, 'error', 'Tiket tidak ditemukan.');
      return res.redirect('/dashboard/tickets');
    }
    await store.update(`tickets/${ticket.id}`, { status: 'closed', updatedAt: Date.now() });
    setFlash(req, 'success', 'Tiket ditutup.');
    return res.redirect(`/dashboard/tickets?ticket=${ticket.id}`);
  } catch (error) {
    next(error);
  }
});

router.get('/testimonial', async (req, res, next) => {
  try {
    const base = await baseData(req);
    const testimonial = await store.getTestimonial(req.user.uid);
    res.render('dashboard/testimonial', {
      title: `Testimoni — ${app.name}`,
      active: 'testimonial',
      ...base,
      testimonial,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/testimonial', async (req, res, next) => {
  try {
    const content = String(req.body.content || '').trim();
    const rating = Math.max(1, Math.min(5, Number(req.body.rating) || 5));
    if (content.length < 10) {
      setFlash(req, 'error', 'Testimoni minimal 10 karakter.');
      return res.redirect('/dashboard/testimonial');
    }
    await store.upsertTestimonial(req.user, { rating, content });
    setFlash(req, 'success', 'Testimoni kamu sudah disimpan dan tayang di landing page.');
    return res.redirect('/dashboard/testimonial');
  } catch (error) {
    next(error);
  }
});

router.get('/profile', async (req, res, next) => {
  try {
    const base = await baseData(req);
    const rawUser = await store.getUser(req.user.uid);
    res.render('dashboard/profile', {
      title: `Profil & Keamanan — ${app.name}`,
      active: 'profile',
      ...base,
      currentIp: clientIp(req),
      providers: req.user.providers || {},
      hasPassword: Boolean(rawUser && rawUser.passwordHash),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/profile', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 60);
    const username = String(req.body.username || '').trim();
    const avatarUrl = String(req.body.avatarUrl || '').trim().slice(0, 500);

    if (!name) {
      setFlash(req, 'error', 'Nama tidak boleh kosong.');
      return res.redirect('/dashboard/profile');
    }
    if (!/^[a-z0-9_.-]{3,24}$/i.test(username)) {
      setFlash(req, 'error', 'Username 3-24 karakter: huruf, angka, titik, garis bawah, atau strip.');
      return res.redirect('/dashboard/profile');
    }
    if (!validAvatarUrl(avatarUrl)) {
      setFlash(req, 'error', 'URL foto profil harus http/https atau path lokal.');
      return res.redirect('/dashboard/profile');
    }

    const current = await store.getUser(req.user.uid);
    const usernameChanged = username.toLowerCase() !== String(current.username || '').toLowerCase();

    if (usernameChanged) {
      const existing = await store.getUserByUsername(username);
      if (existing && existing.uid !== req.user.uid) {
        setFlash(req, 'error', 'Username sudah dipakai akun lain.');
        return res.redirect('/dashboard/profile');
      }
      await store.multiUpdate({
        [`users/${req.user.uid}/username`]: username,
        [`users/${req.user.uid}/name`]: name,
        [`users/${req.user.uid}/avatarUrl`]: avatarUrl,
        [`users/${req.user.uid}/updatedAt`]: Date.now(),
        [`usernameIndex/${store.hashIndex(current.username)}`]: null,
        [`usernameIndex/${store.hashIndex(username)}`]: req.user.uid,
      });
      const testimonial = await store.getTestimonial(req.user.uid);
      if (testimonial) {
        await store.update(`testimonials/${req.user.uid}`, {
          username,
          name,
          avatarUrl,
          updatedAt: Date.now(),
        });
      }
    } else {
      await store.updateUser(req.user.uid, { name, avatarUrl });
      const testimonial = await store.getTestimonial(req.user.uid);
      if (testimonial) await store.update(`testimonials/${req.user.uid}`, { name, avatarUrl, updatedAt: Date.now() });
    }

    setFlash(req, 'success', 'Profil berhasil diperbarui.');
    return res.redirect('/dashboard/profile');
  } catch (error) {
    next(error);
  }
});

router.post('/profile/password', async (req, res, next) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    const confirm = String(req.body.confirmPassword || '');
    const user = await store.getUser(req.user.uid);

    if (user.passwordHash) {
      if (!verifyPassword(currentPassword, user.passwordHash)) {
        setFlash(req, 'error', 'Password saat ini salah.');
        return res.redirect('/dashboard/profile');
      }
    }
    const error = validateNewPassword(newPassword);
    if (error) {
      setFlash(req, 'error', error);
      return res.redirect('/dashboard/profile');
    }
    if (newPassword !== confirm) {
      setFlash(req, 'error', 'Konfirmasi password baru tidak cocok.');
      return res.redirect('/dashboard/profile');
    }
    await store.setUserPassword(req.user.uid, hashPassword(newPassword));
    setFlash(req, 'success', 'Password berhasil diperbarui.');
    return res.redirect('/dashboard/profile');
  } catch (error) {
    next(error);
  }
});

router.post('/profile/notifications', async (req, res, next) => {
  try {
    const browser = req.body.browser === 'on' || req.body.browser === 'true';
    await store.updateUser(req.user.uid, { notificationPrefs: { ...(req.user.notificationPrefs || {}), browser } });
    setFlash(req, 'success', 'Preferensi notifikasi disimpan.');
    return res.redirect('/dashboard/profile#notifications');
  } catch (error) {
    next(error);
  }
});

router.post('/profile/delete', async (req, res, next) => {
  try {
    const user = await store.getUser(req.user.uid);
    const password = String(req.body.password || '');
    const confirmation = String(req.body.confirmation || '').trim().toUpperCase();

    if (user.passwordHash) {
      if (!verifyPassword(password, user.passwordHash)) {
        setFlash(req, 'error', 'Password salah. Akun tidak dihapus.');
        return res.redirect('/dashboard/profile#danger');
      }
    } else if (confirmation !== 'HAPUS') {
      setFlash(req, 'error', 'Ketik HAPUS untuk mengonfirmasi penghapusan akun.');
      return res.redirect('/dashboard/profile#danger');
    }

    await store.recordAdminLog({
      adminUid: user.uid,
      adminName: user.username,
      action: 'user_delete_self',
      detail: 'Pengguna menghapus akunnya sendiri dari dashboard.',
      target: user.email,
    });
    await store.deleteUser(user.uid);
    await logoutSession(req);
    return res.redirect('/?deleted=1');
  } catch (error) {
    next(error);
  }
});

router.get('/usage.json', async (req, res, next) => {
  try {
    const days = Math.max(7, Math.min(90, Number(req.query.days) || 14));
    const series = await getUsageSeries(req.user.uid, days);
    res.json({
      status: true,
      series,
      quota: quotaForUser(req.user),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
