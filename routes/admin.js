'use strict';

const express = require('express');
const { app, plans, getPlan, formatIDR, slugify } = require('../config/app');
const store = require('../lib/store');
const { requireAdmin, setFlash } = require('../lib/auth');
const { hashPassword } = require('../lib/security');
const { getMonitorData } = require('../lib/usage');

const router = express.Router();
router.use(requireAdmin);

const tabs = [
  { key: 'overview', label: 'Ringkasan', icon: 'layout-dashboard' },
  { key: 'users', label: 'Pengguna', icon: 'users' },
  { key: 'transactions', label: 'Transaksi', icon: 'receipt' },
  { key: 'redeem', label: 'Redeem Code', icon: 'gift' },
  { key: 'tickets', label: 'Tiket', icon: 'life-buoy' },
  { key: 'testimonials', label: 'Testimoni', icon: 'quote' },
  { key: 'apps', label: 'Aplikasi', icon: 'package' },
  { key: 'messages', label: 'Pesan Kontak', icon: 'mail' },
  { key: 'logs', label: 'Log', icon: 'scroll-text' },
  { key: 'settings', label: 'Pengaturan', icon: 'settings' },
];

function flattenTransactions(data) {
  const output = [];
  for (const [uid, items] of Object.entries(data || {})) {
    for (const [id, value] of Object.entries(items || {})) {
      output.push({ id, uid, ...value });
    }
  }
  return output.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function parseExpiry(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T23:59:59+08:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function dateInput(ts) {
  if (!ts) return '';
  const date = new Date(Number(ts) + 8 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

async function audit(req, action, detail, target = '') {
  await store.recordAdminLog({
    adminUid: req.user.uid,
    adminName: req.user.name || req.user.username,
    action,
    detail,
    target,
  });
}

async function loadUsers() {
  const data = (await store.get('users')) || {};
  return Object.entries(data).map(([uid, user]) => store.safeUser({ uid, ...user }));
}

async function loadAllTransactions() {
  return flattenTransactions(await store.get('transactions'));
}

async function loadAllTickets() {
  return store.getTickets(null, 200);
}

async function loadTestimonials() {
  const data = (await store.get('testimonials')) || {};
  return Object.entries(data)
    .map(([uid, value]) => ({ uid, ...value }))
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
}

async function baseAdmin(req) {
  const settings = await store.getSettings();
  return {
    settings,
    adminTabs: tabs,
    adminUser: store.safeUser(req.user),
    bodyClass: 'page-admin',
  };
}

router.get('/', async (req, res, next) => {
  try {
    const base = await baseAdmin(req);
    const [users, transactions, tickets, monitor] = await Promise.all([
      loadUsers(),
      loadAllTransactions(),
      loadAllTickets(),
      getMonitorData(),
    ]);
    const now = Date.now();
    const openTickets = tickets.filter((t) => t.status !== 'closed');
    const pendingTransactions = transactions.filter((t) => t.status === 'pending');
    const approvedTransactions = transactions.filter((t) => t.status === 'approved');
    const stats = {
      totalUsers: users.length,
      activeUsers: users.filter((u) => u.isActive !== false && !(u.expiresAt && Number(u.expiresAt) < now)).length,
      expiredUsers: users.filter((u) => u.expiresAt && Number(u.expiresAt) < now).length,
      onlineUsers: users.filter((u) => u.online).length,
      paidUsers: users.filter((u) => u.plan && u.plan !== 'free').length,
      revenue: approvedTransactions.reduce((sum, item) => sum + Number(item.amount || 0), 0),
      pendingTransactions: pendingTransactions.length,
      openTickets: openTickets.length,
      totalRequests: monitor.totals.requests,
      successRate: monitor.totals.successRate,
    };
    const recentUsers = [...users].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 6);
    const recentTransactions = transactions.slice(0, 6);
    const recentTickets = openTickets.slice(0, 6);
    const recentLogs = monitor.recent.slice(0, 10);

    res.render('admin/index', {
      title: `Admin — ${app.name}`,
      activeTab: 'overview',
      ...base,
      stats,
      recentUsers,
      recentTransactions,
      recentTickets,
      recentLogs,
      plans,
      dateInput,
      formatIDR,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/users', async (req, res, next) => {
  try {
    const base = await baseAdmin(req);
    const q = String(req.query.q || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim();
    const planFilter = String(req.query.plan || '').trim();
    let users = await loadUsers();
    users = users.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

    if (q) {
      users = users.filter((u) =>
        [u.username, u.email, u.name].filter(Boolean).some((value) => String(value).toLowerCase().includes(q))
      );
    }
    if (status === 'active') users = users.filter((u) => u.isActive !== false && !u.expired);
    if (status === 'inactive') users = users.filter((u) => u.isActive === false);
    if (status === 'expired') users = users.filter((u) => u.expired);
    if (status === 'online') users = users.filter((u) => u.online);
    if (status === 'paid') users = users.filter((u) => u.plan && u.plan !== 'free');
    if (planFilter) users = users.filter((u) => u.plan === planFilter);

    const selected = req.query.edit ? users.find((u) => u.uid === req.query.edit) || null : null;

    res.render('admin/index', {
      title: `Kelola Pengguna — ${app.name}`,
      activeTab: 'users',
      ...base,
      users,
      selected,
      q,
      status,
      planFilter,
      plans,
      dateInput,
      formatIDR,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/users/:uid', async (req, res, next) => {
  try {
    const uid = req.params.uid;
    const user = await store.getUser(uid);
    if (!user) {
      setFlash(req, 'error', 'Pengguna tidak ditemukan.');
      return res.redirect('/admin/users');
    }
    const plan = getPlan(req.body.plan || user.plan);
    const name = String(req.body.name || user.name || '').trim().slice(0, 60);
    const role = uid === req.user.uid ? user.role : req.body.role === 'admin' ? 'admin' : 'user';
    const isActive = req.body.isActive === 'on' || req.body.isActive === 'true';
    let expiresAt = parseExpiry(req.body.expiresAt);
    if (!expiresAt && plan.days > 0 && plan.key !== user.plan) {
      expiresAt = Date.now() + plan.days * 24 * 60 * 60 * 1000;
    }
    if (plan.key === 'free') expiresAt = null;
    const quotaLimit = Math.max(0, Number(req.body.quotaLimit ?? user.quotaLimit) || 0);

    await store.updateUser(uid, {
      name,
      role,
      plan: plan.key,
      quotaLimit,
      expiresAt,
      isActive,
    });
    await audit(req, 'admin_user_update', `Memperbarui user ${user.username}: plan ${plan.key}, aktif ${isActive}.`, user.email);
    setFlash(req, 'success', `User ${user.username} berhasil diperbarui.`);
    return res.redirect(`/admin/users?edit=${uid}`);
  } catch (error) {
    next(error);
  }
});

router.post('/users/:uid/extend', async (req, res, next) => {
  try {
    const user = await store.getUser(req.params.uid);
    if (!user) {
      setFlash(req, 'error', 'Pengguna tidak ditemukan.');
      return res.redirect('/admin/users');
    }
    const days = Math.max(1, Math.min(3650, Number(req.body.days) || 30));
    const base = Math.max(Date.now(), Number(user.expiresAt || 0));
    await store.updateUser(user.uid, { expiresAt: base + days * 24 * 60 * 60 * 1000 });
    await audit(req, 'admin_user_extend', `Memperpanjang ${user.username} selama ${days} hari.`, user.email);
    setFlash(req, 'success', `Masa aktif ${user.username} ditambah ${days} hari.`);
    return res.redirect('/admin/users');
  } catch (error) {
    next(error);
  }
});

router.post('/users/:uid/quota', async (req, res, next) => {
  try {
    const user = await store.getUser(req.params.uid);
    if (!user) {
      setFlash(req, 'error', 'Pengguna tidak ditemukan.');
      return res.redirect('/admin/users');
    }
    const amount = Number(req.body.amount) || 0;
    const next = Math.max(0, Number(user.quotaLimit || 0) + amount);
    await store.updateUser(user.uid, { quotaLimit: next });
    await audit(req, 'admin_user_quota', `Mengubah kuota ${user.username} sebesar ${amount}.`, user.email);
    setFlash(req, 'success', `Kuota ${user.username} sekarang ${next.toLocaleString('id-ID')}.`);
    return res.redirect(`/admin/users?edit=${user.uid}`);
  } catch (error) {
    next(error);
  }
});

router.post('/users/:uid/toggle', async (req, res, next) => {
  try {
    const user = await store.getUser(req.params.uid);
    if (!user) {
      setFlash(req, 'error', 'Pengguna tidak ditemukan.');
      return res.redirect('/admin/users');
    }
    if (user.uid === req.user.uid) {
      setFlash(req, 'error', 'Tidak bisa menonaktifkan akun sendiri.');
      return res.redirect('/admin/users');
    }
    await store.updateUser(user.uid, { isActive: user.isActive === false });
    await audit(req, 'admin_user_toggle', `${user.isActive === false ? 'Mengaktifkan' : 'Menonaktifkan'} ${user.username}.`, user.email);
    setFlash(req, 'success', `Status ${user.username} berhasil diubah.`);
    return res.redirect('/admin/users');
  } catch (error) {
    next(error);
  }
});

router.post('/users/:uid/password', async (req, res, next) => {
  try {
    const user = await store.getUser(req.params.uid);
    if (!user) {
      setFlash(req, 'error', 'Pengguna tidak ditemukan.');
      return res.redirect('/admin/users');
    }
    const password = String(req.body.newPassword || '');
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setFlash(req, 'error', 'Password baru minimal 8 karakter dan berisi huruf serta angka.');
      return res.redirect(`/admin/users?edit=${user.uid}`);
    }
    await store.setUserPassword(user.uid, hashPassword(password));
    await audit(req, 'admin_user_password', `Mereset password ${user.username}.`, user.email);
    setFlash(req, 'success', `Password ${user.username} berhasil direset.`);
    return res.redirect(`/admin/users?edit=${user.uid}`);
  } catch (error) {
    next(error);
  }
});

router.post('/users/:uid/delete', async (req, res, next) => {
  try {
    const user = await store.getUser(req.params.uid);
    if (!user) {
      setFlash(req, 'error', 'Pengguna tidak ditemukan.');
      return res.redirect('/admin/users');
    }
    if (user.uid === req.user.uid) {
      setFlash(req, 'error', 'Tidak bisa menghapus akun sendiri dari panel admin.');
      return res.redirect('/admin/users');
    }
    await store.deleteUser(user.uid);
    await audit(req, 'admin_user_delete', `Menghapus user ${user.username}.`, user.email);
    setFlash(req, 'success', `User ${user.username} dihapus permanen.`);
    return res.redirect('/admin/users');
  } catch (error) {
    next(error);
  }
});

router.get('/transactions', async (req, res, next) => {
  try {
    const base = await baseAdmin(req);
    const status = String(req.query.status || '').trim();
    let transactions = await loadAllTransactions();
    if (status) transactions = transactions.filter((item) => item.status === status);
    res.render('admin/index', {
      title: `Transaksi — ${app.name}`,
      activeTab: 'transactions',
      ...base,
      transactions,
      status,
      plans,
      dateInput,
      formatIDR,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/transactions/:uid/:id/approve', async (req, res, next) => {
  try {
    const trx = await store.get(`transactions/${req.params.uid}/${req.params.id}`);
    if (!trx) {
      setFlash(req, 'error', 'Transaksi tidak ditemukan.');
      return res.redirect('/admin/transactions');
    }
    if (trx.status !== 'pending') {
      setFlash(req, 'error', 'Transaksi ini sudah diproses.');
      return res.redirect('/admin/transactions');
    }
    const user = await store.getUser(req.params.uid);
    if (!user) {
      setFlash(req, 'error', 'User transaksi tidak ditemukan.');
      return res.redirect('/admin/transactions');
    }
    const plan = getPlan(trx.planKey);
    const baseTime = Math.max(Date.now(), Number(user.expiresAt || 0));
    const expiresAt = plan.days > 0 ? baseTime + plan.days * 24 * 60 * 60 * 1000 : user.expiresAt || null;
    const quotaLimit = Number(user.quotaLimit || 0) + Number(plan.quota || 0);

    await store.multiUpdate({
      [`users/${user.uid}/plan`]: plan.key,
      [`users/${user.uid}/quotaLimit`]: quotaLimit,
      [`users/${user.uid}/expiresAt`]: expiresAt,
      [`users/${user.uid}/updatedAt`]: Date.now(),
      [`transactions/${trx.uid}/${trx.id}/status`]: 'approved',
      [`transactions/${trx.uid}/${trx.id}/approvedAt`]: Date.now(),
      [`transactions/${trx.uid}/${trx.id}/approvedBy`]: req.user.username,
    });
    await audit(req, 'admin_transaction_approve', `Menyetujui transaksi ${trx.id} (${plan.name}) untuk ${user.username}.`, user.email);
    setFlash(req, 'success', `Transaksi ${trx.id} disetujui. Paket ${plan.name} aktif.`);
    return res.redirect('/admin/transactions');
  } catch (error) {
    next(error);
  }
});

router.post('/transactions/:uid/:id/reject', async (req, res, next) => {
  try {
    const trx = await store.get(`transactions/${req.params.uid}/${req.params.id}`);
    if (!trx) {
      setFlash(req, 'error', 'Transaksi tidak ditemukan.');
      return res.redirect('/admin/transactions');
    }
    await store.update(`transactions/${req.params.uid}/${req.params.id}`, {
      status: 'rejected',
      rejectedAt: Date.now(),
      rejectedBy: req.user.username,
    });
    await audit(req, 'admin_transaction_reject', `Menolak transaksi ${trx.id}.`, trx.email);
    setFlash(req, 'success', `Transaksi ${trx.id} ditolak.`);
    return res.redirect('/admin/transactions');
  } catch (error) {
    next(error);
  }
});

router.get('/redeem', async (req, res, next) => {
  try {
    const base = await baseAdmin(req);
    const codes = await store.getRedeemCodes();
    res.render('admin/index', {
      title: `Redeem Code — ${app.name}`,
      activeTab: 'redeem',
      ...base,
      codes,
      plans,
      dateInput,
      formatIDR,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/redeem', async (req, res, next) => {
  try {
    const code = await store.createRedeemCode({
      code: req.body.code,
      type: req.body.type,
      value: req.body.value,
      maxUses: req.body.maxUses,
      expiresAt: parseExpiry(req.body.expiresAt),
      createdBy: req.user.username,
      note: req.body.note,
    });
    await audit(req, 'admin_redeem_create', `Membuat kode redeem ${code.code} (${code.type}: ${code.value}).`);
    setFlash(req, 'success', `Kode ${code.code} berhasil dibuat.`);
    return res.redirect('/admin/redeem');
  } catch (error) {
    setFlash(req, 'error', error.message || 'Gagal membuat kode redeem.');
    return res.redirect('/admin/redeem');
  }
});

router.post('/redeem/:code/toggle', async (req, res, next) => {
  try {
    const code = await store.get(`redeemCodes/${req.params.code}`);
    if (!code) {
      setFlash(req, 'error', 'Kode tidak ditemukan.');
      return res.redirect('/admin/redeem');
    }
    await store.update(`redeemCodes/${req.params.code}`, { active: code.active === false });
    await audit(req, 'admin_redeem_toggle', `Mengubah status kode ${code.code}.`);
    setFlash(req, 'success', `Status kode ${code.code} diperbarui.`);
    return res.redirect('/admin/redeem');
  } catch (error) {
    next(error);
  }
});

router.post('/redeem/:code/delete', async (req, res, next) => {
  try {
    await store.remove(`redeemCodes/${req.params.code}`);
    await audit(req, 'admin_redeem_delete', `Menghapus kode redeem ${req.params.code}.`);
    setFlash(req, 'success', 'Kode redeem dihapus.');
    return res.redirect('/admin/redeem');
  } catch (error) {
    next(error);
  }
});

router.get('/tickets', async (req, res, next) => {
  try {
    const base = await baseAdmin(req);
    const tickets = await loadAllTickets();
    const status = String(req.query.status || '').trim();
    const filtered = status ? tickets.filter((item) => item.status === status) : tickets;
    let selected = null;
    if (req.query.ticket) selected = tickets.find((item) => item.id === req.query.ticket) || null;
    if (!selected && filtered.length) selected = filtered[0];
    res.render('admin/index', {
      title: `Tiket — ${app.name}`,
      activeTab: 'tickets',
      ...base,
      tickets: filtered,
      selected,
      status,
      plans,
      dateInput,
      formatIDR,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/tickets/:id/reply', async (req, res, next) => {
  try {
    const ticket = await store.getTicket(req.params.id);
    if (!ticket) {
      setFlash(req, 'error', 'Tiket tidak ditemukan.');
      return res.redirect('/admin/tickets');
    }
    const message = String(req.body.message || '').trim();
    if (!message) {
      setFlash(req, 'error', 'Tulis balasan terlebih dahulu.');
      return res.redirect(`/admin/tickets?ticket=${ticket.id}`);
    }
    await store.replyTicket(ticket.id, {
      by: 'admin',
      byName: req.user.name || req.user.username,
      message,
    });
    await audit(req, 'admin_ticket_reply', `Membalas tiket ${ticket.id}.`, ticket.email);
    setFlash(req, 'success', 'Balasan admin terkirim.');
    return res.redirect(`/admin/tickets?ticket=${ticket.id}`);
  } catch (error) {
    next(error);
  }
});

router.post('/tickets/:id/status', async (req, res, next) => {
  try {
    const ticket = await store.getTicket(req.params.id);
    if (!ticket) {
      setFlash(req, 'error', 'Tiket tidak ditemukan.');
      return res.redirect('/admin/tickets');
    }
    const status = ['open', 'answered', 'closed'].includes(req.body.status) ? req.body.status : 'open';
    await store.update(`tickets/${ticket.id}`, { status, updatedAt: Date.now() });
    await audit(req, 'admin_ticket_status', `Mengubah status tiket ${ticket.id} menjadi ${status}.`, ticket.email);
    setFlash(req, 'success', 'Status tiket diperbarui.');
    return res.redirect(`/admin/tickets?ticket=${ticket.id}`);
  } catch (error) {
    next(error);
  }
});

router.get('/testimonials', async (req, res, next) => {
  try {
    const base = await baseAdmin(req);
    const testimonials = await loadTestimonials();
    res.render('admin/index', {
      title: `Testimoni — ${app.name}`,
      activeTab: 'testimonials',
      ...base,
      testimonials,
      plans,
      dateInput,
      formatIDR,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/testimonials/:uid/hide', async (req, res, next) => {
  try {
    const item = await store.get(`testimonials/${req.params.uid}`);
    if (!item) {
      setFlash(req, 'error', 'Testimoni tidak ditemukan.');
      return res.redirect('/admin/testimonials');
    }
    await store.update(`testimonials/${req.params.uid}`, { hidden: item.hidden !== true, updatedAt: Date.now() });
    await audit(req, 'admin_testimonial_hide', `Mengubah visibilitas testimoni ${item.username}.`, item.username);
    setFlash(req, 'success', 'Visibilitas testimoni diperbarui.');
    return res.redirect('/admin/testimonials');
  } catch (error) {
    next(error);
  }
});

router.post('/testimonials/:uid/delete', async (req, res, next) => {
  try {
    await store.remove(`testimonials/${req.params.uid}`);
    await audit(req, 'admin_testimonial_delete', `Menghapus testimoni ${req.params.uid}.`);
    setFlash(req, 'success', 'Testimoni dihapus.');
    return res.redirect('/admin/testimonials');
  } catch (error) {
    next(error);
  }
});

router.get('/apps', async (req, res, next) => {
  try {
    const base = await baseAdmin(req);
    const apps = await store.getApps(false);
    const selected = req.query.edit ? apps.find((item) => item.id === req.query.edit) || null : null;
    res.render('admin/index', {
      title: `Aplikasi — ${app.name}`,
      activeTab: 'apps',
      ...base,
      apps,
      selected,
      plans,
      dateInput,
      formatIDR,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/apps', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) throw new Error('Nama aplikasi wajib diisi.');
    const url = String(req.body.url || '').trim();
    if (url && !url.startsWith('/') && !/^https?:\/\//i.test(url)) throw new Error('URL harus http/https atau path lokal.');
    const id = slugify(req.body.id || name) || 'app-' + Date.now();
    const record = {
      id,
      name: name.slice(0, 80),
      description: String(req.body.description || '').trim().slice(0, 300),
      platform: String(req.body.platform || '').trim().slice(0, 60),
      version: String(req.body.version || '1.0.0').trim().slice(0, 30),
      size: String(req.body.size || '').trim().slice(0, 30),
      url,
      icon: String(req.body.icon || 'package').trim().slice(0, 30),
      active: req.body.active === 'on' || req.body.active === 'true',
      updatedAt: Date.now(),
    };
    const existing = await store.get(`apps/${id}`);
    if (!existing) record.createdAt = Date.now();
    await store.set(`apps/${id}`, record);
    await audit(req, 'admin_app_save', `Menyimpan aplikasi ${name}.`);
    setFlash(req, 'success', `Aplikasi ${name} disimpan.`);
    return res.redirect('/admin/apps');
  } catch (error) {
    setFlash(req, 'error', error.message || 'Gagal menyimpan aplikasi.');
    return res.redirect('/admin/apps');
  }
});

router.post('/apps/:id/delete', async (req, res, next) => {
  try {
    await store.remove(`apps/${req.params.id}`);
    await audit(req, 'admin_app_delete', `Menghapus aplikasi ${req.params.id}.`);
    setFlash(req, 'success', 'Aplikasi dihapus.');
    return res.redirect('/admin/apps');
  } catch (error) {
    next(error);
  }
});

router.get('/messages', async (req, res, next) => {
  try {
    const base = await baseAdmin(req);
    const data = (await store.get('messages')) || {};
    const messages = Object.entries(data)
      .map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    res.render('admin/index', {
      title: `Pesan Kontak — ${app.name}`,
      activeTab: 'messages',
      ...base,
      messages,
      plans,
      dateInput,
      formatIDR,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/messages/:id/read', async (req, res, next) => {
  try {
    await store.update(`messages/${req.params.id}`, { status: 'read' });
    setFlash(req, 'success', 'Pesan ditandai sudah dibaca.');
    return res.redirect('/admin/messages');
  } catch (error) {
    next(error);
  }
});

router.post('/messages/:id/delete', async (req, res, next) => {
  try {
    await store.remove(`messages/${req.params.id}`);
    setFlash(req, 'success', 'Pesan dihapus.');
    return res.redirect('/admin/messages');
  } catch (error) {
    next(error);
  }
});

router.get('/logs', async (req, res, next) => {
  try {
    const base = await baseAdmin(req);
    const [adminLogs, apiLogs] = await Promise.all([store.getAdminLogs(100), store.getRecentLogs(100)]);
    res.render('admin/index', {
      title: `Log — ${app.name}`,
      activeTab: 'logs',
      ...base,
      adminLogs,
      apiLogs,
      plans,
      dateInput,
      formatIDR,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/settings', async (req, res, next) => {
  try {
    const base = await baseAdmin(req);
    res.render('admin/index', {
      title: `Pengaturan — ${app.name}`,
      activeTab: 'settings',
      ...base,
      plans,
      dateInput,
      formatIDR,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/settings', async (req, res, next) => {
  try {
    const settings = await store.saveSettings({
      waAdmin: String(req.body.waAdmin || '').replace(/\D/g, '').slice(0, 20),
      freeLimitDaily: Math.max(1, Math.min(100000, Number(req.body.freeLimitDaily) || app.freeLimitDaily)),
      registrationOpen: req.body.registrationOpen === 'on' || req.body.registrationOpen === 'true',
      announcement: String(req.body.announcement || '').trim().slice(0, 500),
      announcementActive: req.body.announcementActive === 'on' || req.body.announcementActive === 'true',
      maintenanceMessage: String(req.body.maintenanceMessage || '').trim().slice(0, 300),
    });
    await audit(req, 'admin_settings', 'Memperbarui pengaturan publik.');
    setFlash(req, 'success', 'Pengaturan berhasil disimpan.');
    return res.redirect('/admin/settings');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
