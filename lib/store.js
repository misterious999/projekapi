'use strict';

const crypto = require('crypto');
const { db, admin } = require('../config/firebase');
const { app, getPlan, remainingQuota, isExpired, planActive } = require('../config/app');
const {
  sha256,
  encrypt,
  decrypt,
  generateApiKey,
  maskKey,
  validCustomKey,
} = require('./security');
const { dateKeysBack } = require('./time');

const ROOT = app.dbRoot;
const rootRef = db.ref(ROOT);

function ref(path = '') {
  return path ? rootRef.child(String(path).replace(/^\/+/, '')) : rootRef;
}

async function get(path) {
  const snapshot = await ref(path).get();
  return snapshot.val();
}

async function set(path, value) {
  await ref(path).set(value);
  return value;
}

async function update(path, value) {
  await ref(path).update(value);
  return value;
}

async function remove(path) {
  await ref(path).remove();
}

async function push(path, value) {
  const child = ref(path).push();
  await child.set(value);
  return child.key;
}

async function transaction(path, updater) {
  const result = await ref(path).transaction(updater);
  return result.snapshot ? result.snapshot.val() : null;
}

/**
 * Update banyak path sekaligus (atomic di Firebase) dengan path relatif
 * terhadap root aplikasi.
 */
async function multiUpdate(updates) {
  const payload = {};
  for (const [key, value] of Object.entries(updates)) {
    payload[`${ROOT}/${key.replace(/^\/+/, '')}`] = value;
  }
  if (Object.keys(payload).length) await db.ref().update(payload);
}

function hashIndex(value) {
  return sha256(String(value || '').trim().toLowerCase());
}

function uid() {
  return 'u_' + crypto.randomBytes(12).toString('hex');
}

function makeReferralCode(username) {
  const base = String(username || 'ZEROIX')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 7) || 'ZEROIX';
  return `${base}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function safeUser(user) {
  if (!user) return null;
  const plan = getPlan(user.plan);
  const copy = { ...user };
  delete copy.passwordHash;
  delete copy.apiKeyEnc;
  delete copy.apiKeyHash;
  copy.planData = plan;
  copy.quotaRemaining = remainingQuota(user);
  copy.expired = isExpired(user);
  copy.planActive = planActive(user);
  copy.online = Boolean(user.lastSeenAt && Date.now() - Number(user.lastSeenAt) < 5 * 60 * 1000);
  copy.apiKeyMasked = user.apiKeyLast4 ? `zeroix_••••••••••••${user.apiKeyLast4}` : 'Belum ada API key';
  return copy;
}

async function getUser(uidValue) {
  if (!uidValue) return null;
  return get(`users/${uidValue}`);
}

async function getUserByEmail(email) {
  const index = await get(`emailIndex/${hashIndex(email)}`);
  return index ? getUser(index) : null;
}

async function getUserByUsername(username) {
  const index = await get(`usernameIndex/${hashIndex(username)}`);
  return index ? getUser(index) : null;
}

async function getUserByReferralCode(code) {
  if (!code) return null;
  const index = await get(`referralIndex/${String(code).trim().toUpperCase()}`);
  return index ? getUser(index) : null;
}

async function getApiKeyRecord(user) {
  if (!user || !user.apiKeyHash) return null;
  return get(`apiKeys/${user.apiKeyHash}`);
}

async function getApiKeyRecordByHash(hash) {
  return get(`apiKeys/${hash}`);
}

async function revealApiKey(user) {
  const record = await getApiKeyRecord(user);
  if (!record || !record.enc) return '';
  return decrypt(record.enc);
}

async function createApiKeyForUser(uidValue, { customKey = '', type = 'generated', label = 'Default' } = {}) {
  const user = await getUser(uidValue);
  if (!user) throw new Error('User tidak ditemukan.');

  let key = String(customKey || '').trim();
  if (key) {
    const validation = validCustomKey(key);
    if (!validation.ok) throw new Error(validation.message);
    key = validation.key;
  } else {
    key = generateApiKey();
  }

  const hash = sha256(key);
  const existing = await get(`apiKeys/${hash}`);
  if (existing && existing.uid !== uidValue) {
    throw new Error('API key sudah dipakai akun lain. Pilih yang berbeda.');
  }

  const record = {
    uid: uidValue,
    hash,
    enc: encrypt(key),
    last4: key.slice(-4),
    masked: maskKey(key),
    type: key.startsWith('zeroix_') ? 'generated' : 'custom',
    label: String(label || 'Default').slice(0, 40),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const updates = {
    [`apiKeys/${hash}`]: record,
    [`users/${uidValue}/apiKeyHash`]: hash,
    [`users/${uidValue}/apiKeyLast4`]: record.last4,
    [`users/${uidValue}/apiKeyType`]: record.type,
    [`users/${uidValue}/apiKeyCreatedAt`]: record.createdAt,
    [`users/${uidValue}/updatedAt`]: Date.now(),
  };
  if (user.apiKeyHash && user.apiKeyHash !== hash) {
    updates[`apiKeys/${user.apiKeyHash}`] = null;
  }
  await multiUpdate(updates);
  return { key, record };
}

async function rotateApiKey(uidValue) {
  return createApiKeyForUser(uidValue, { type: 'generated', label: 'Rotated' });
}

async function findOrCreateUserForProvider({ provider, providerId, email, name, avatarUrl }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new Error('Email dari provider tidak tersedia.');

  let user = await getUserByEmail(normalizedEmail);
  if (user) {
    const providers = { ...(user.providers || {}) };
    providers[provider] = { id: String(providerId || ''), email: normalizedEmail, linkedAt: Date.now() };
    await update(`users/${user.uid}`, {
      providers,
      emailVerified: true,
      avatarUrl: user.avatarUrl || avatarUrl || '',
      updatedAt: Date.now(),
    });
    return getUser(user.uid);
  }

  let username = normalizedEmail.split('@')[0].replace(/[^a-z0-9_.-]/gi, '').slice(0, 20) || 'user';
  let suffix = 0;
  // Resolve username collisions.
  while (await getUserByUsername(username)) {
    suffix += 1;
    username = `${normalizedEmail.split('@')[0].replace(/[^a-z0-9_.-]/gi, '').slice(0, 16)}${suffix}`;
  }

  return createUser({
    email: normalizedEmail,
    username,
    name: name || username,
    passwordHash: null,
    avatarUrl: avatarUrl || '',
    emailVerified: true,
    providers: { [provider]: { id: String(providerId || ''), email: normalizedEmail, linkedAt: Date.now() } },
  });
}

async function createUser({
  email,
  username,
  name,
  passwordHash,
  role = 'user',
  plan = 'free',
  quotaLimit,
  expiresAt = null,
  avatarUrl = '',
  emailVerified = false,
  providers = {},
  referredBy = '',
  ip = '',
}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedName = String(username || '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('Format email tidak valid.');
  if (!/^[a-z0-9_.-]{3,24}$/i.test(normalizedName)) {
    throw new Error('Username 3-24 karakter, hanya huruf, angka, titik, garis bawah, atau strip.');
  }
  if (await getUserByEmail(normalizedEmail)) throw new Error('Email sudah terdaftar.');
  if (await getUserByUsername(normalizedName)) throw new Error('Username sudah dipakai.');

  const planData = getPlan(plan);
  const newUid = uid();
  const now = Date.now();
  const referralCode = makeReferralCode(normalizedName);
  let referralTaken = await get(`referralIndex/${referralCode}`);
  let finalCode = referralCode;
  while (referralTaken) {
    finalCode = makeReferralCode(normalizedName);
    referralTaken = await get(`referralIndex/${finalCode}`);
  }

  const user = {
    uid: newUid,
    email: normalizedEmail,
    username: normalizedName,
    name: String(name || normalizedName).trim().slice(0, 60),
    role: role === 'admin' ? 'admin' : 'user',
    passwordHash: passwordHash || null,
    avatarUrl: String(avatarUrl || '').slice(0, 500),
    providers,
    emailVerified: Boolean(emailVerified),
    plan: planData.key,
    quotaLimit: Number.isFinite(Number(quotaLimit)) ? Number(quotaLimit) : planData.quota,
    quotaUsed: 0,
    expiresAt: expiresAt || null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    lastSeenAt: null,
    referralCode: finalCode,
    referredBy: referredBy || null,
    referralBonusEarned: 0,
    allowAllIp: true,
    ipWhitelist: [],
    notificationPrefs: { browser: false, email: false },
    signupIp: ip || '',
  };

  // Simpan user + indexes dulu, lalu buat API key (butuh user ada).
  await multiUpdate({
    [`users/${newUid}`]: user,
    [`emailIndex/${hashIndex(normalizedEmail)}`]: newUid,
    [`usernameIndex/${hashIndex(normalizedName)}`]: newUid,
    [`referralIndex/${finalCode}`]: newUid,
  });
  await transaction('meta/userCount', (current) => (Number(current) || 0) + 1);

  const { key, record } = await createApiKeyForUser(newUid, { type: 'generated', label: 'Auto-generated' });

  if (referredBy) {
    const referrer = await getUserByReferralCode(referredBy);
    if (referrer && referrer.uid !== newUid) {
      await applyReferral(referrer.uid, newUid);
    }
  }

  return { ...(await getUser(newUid)), __firstApiKey: key, __keyRecord: record };
}

async function applyReferral(referrerUid, newUid) {
  const referrer = await getUser(referrerUid);
  const newUser = await getUser(newUid);
  if (!referrer || !newUser) return;
  if (newUser.referredByBonusApplied) return;

  const bonus = app.referralBonus;
  const now = Date.now();
  await multiUpdate({
    [`users/${referrerUid}/quotaLimit`]: Number(referrer.quotaLimit || 0) + bonus,
    [`users/${referrerUid}/referralBonusEarned`]: Number(referrer.referralBonusEarned || 0) + bonus,
    [`users/${referrerUid}/updatedAt`]: now,
    [`users/${newUid}/quotaLimit`]: Number(newUser.quotaLimit || 0) + bonus,
    [`users/${newUid}/referredByBonusApplied`]: true,
    [`users/${newUid}/updatedAt`]: now,
    [`referrals/${referrerUid}/${newUid}`]: {
      uid: newUid,
      username: newUser.username,
      email: newUser.email,
      bonus,
      createdAt: now,
    },
  });
}

async function updateUser(uidValue, patch) {
  const updatePayload = { ...patch, updatedAt: Date.now() };
  delete updatePayload.passwordHash; // password hanya lewat helper khusus
  await update(`users/${uidValue}`, updatePayload);
  return getUser(uidValue);
}

async function setUserPassword(uidValue, passwordHash) {
  await update(`users/${uidValue}`, { passwordHash, updatedAt: Date.now() });
}

async function deleteUser(uidValue) {
  const user = await getUser(uidValue);
  if (!user) return false;

  const updates = {
    [`users/${uidValue}`]: null,
    [`emailIndex/${hashIndex(user.email)}`]: null,
    [`usernameIndex/${hashIndex(user.username)}`]: null,
    [`referralIndex/${user.referralCode}`]: null,
    [`testimonials/${uidValue}`]: null,
    [`transactions/${uidValue}`]: null,
    [`referrals/${uidValue}`]: null,
  };
  if (user.apiKeyHash) updates[`apiKeys/${user.apiKeyHash}`] = null;
  await multiUpdate(updates);
  await transaction('meta/userCount', (current) => Math.max(0, (Number(current) || 0) - 1));
  return true;
}

async function recordAdminLog({ adminUid, adminName, action, detail, target = '' }) {
  return push('adminLogs', {
    adminUid,
    adminName,
    action,
    detail: String(detail || '').slice(0, 500),
    target,
    createdAt: Date.now(),
  });
}

async function getSettings() {
  const saved = (await get('settings/public')) || {};
  return {
    waAdmin: saved.waAdmin || app.waAdmin,
    freeLimitDaily: Number(saved.freeLimitDaily || app.freeLimitDaily),
    registrationOpen: saved.registrationOpen !== false,
    maintenanceMessage: saved.maintenanceMessage || '',
    announcement: saved.announcement || '',
    announcementActive: saved.announcementActive !== false,
  };
}

async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch, updatedAt: Date.now() };
  await set('settings/public', next);
  return next;
}

async function getApps(activeOnly = false) {
  const data = (await get('apps')) || {};
  return Object.entries(data)
    .map(([id, value]) => ({ id, ...value }))
    .filter((item) => (activeOnly ? item.active !== false : true))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

async function getTestimonials(limit = 24) {
  const data = (await get('testimonials')) || {};
  return Object.entries(data)
    .map(([uid, value]) => ({ uid, ...value }))
    .filter((item) => item.hidden !== true && String(item.content || '').trim().length >= 10)
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
    .slice(0, limit);
}

async function getTestimonial(uidValue) {
  return get(`testimonials/${uidValue}`);
}

async function upsertTestimonial(user, { rating, content }) {
  const now = Date.now();
  const existing = await getTestimonial(user.uid);
  const record = {
    uid: user.uid,
    username: user.username,
    name: user.name || user.username,
    avatarUrl: user.avatarUrl || '',
    plan: user.plan || 'free',
    rating: Math.max(1, Math.min(5, Number(rating) || 5)),
    content: String(content || '').trim().slice(0, 800),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await set(`testimonials/${user.uid}`, record);
  return record;
}

async function getTransactions(uidValue, limit = 50) {
  const data = (await get(`transactions/${uidValue}`)) || {};
  return Object.entries(data)
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, limit);
}

async function createTransaction(user, { plan, amount, note = '', type = 'purchase' }) {
  const id = 'trx_' + crypto.randomBytes(8).toString('hex');
  const record = {
    id,
    uid: user.uid,
    username: user.username,
    email: user.email,
    planKey: plan.key,
    planName: plan.name,
    amount: Number(amount || plan.price || 0),
    type,
    status: 'pending',
    note,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await set(`transactions/${user.uid}/${id}`, record);
  return record;
}

async function getTickets(uidValue = null, limit = 100) {
  const data = (await get('tickets')) || {};
  return Object.entries(data)
    .map(([id, value]) => ({ id, ...value }))
    .filter((item) => (uidValue ? item.uid === uidValue : true))
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
    .slice(0, limit);
}

async function getTicket(id) {
  return get(`tickets/${id}`);
}

async function createTicket(user, { subject, message, priority = 'normal' }) {
  const id = 'tkt_' + crypto.randomBytes(8).toString('hex');
  const now = Date.now();
  const ticket = {
    id,
    uid: user.uid,
    username: user.username,
    email: user.email,
    subject: String(subject || '').trim().slice(0, 120),
    priority: ['low', 'normal', 'high'].includes(priority) ? priority : 'normal',
    status: 'open',
    createdAt: now,
    updatedAt: now,
    replies: {
      [crypto.randomBytes(8).toString('hex')]: {
        by: 'user',
        byName: user.name || user.username,
        message: String(message || '').trim().slice(0, 4000),
        createdAt: now,
      },
    },
  };
  await set(`tickets/${id}`, ticket);
  return ticket;
}

async function replyTicket(id, { by, byName, message }) {
  const ticket = await getTicket(id);
  if (!ticket) throw new Error('Tiket tidak ditemukan.');
  const replyId = crypto.randomBytes(8).toString('hex');
  await multiUpdate({
    [`tickets/${id}/replies/${replyId}`]: {
      by,
      byName,
      message: String(message || '').trim().slice(0, 4000),
      createdAt: Date.now(),
    },
    [`tickets/${id}/status`]: by === 'admin' ? 'answered' : 'open',
    [`tickets/${id}/updatedAt`]: Date.now(),
  });
  return getTicket(id);
}

async function getRedeemCodes() {
  const data = (await get('redeemCodes')) || {};
  return Object.entries(data)
    .map(([code, value]) => ({ code, ...value }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

async function createRedeemCode({ code, type, value, maxUses = 1, expiresAt = null, createdBy, note = '' }) {
  const normalized = String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
  if (normalized.length < 4) throw new Error('Kode minimal 4 karakter.');
  if (await get(`redeemCodes/${normalized}`)) throw new Error('Kode sudah ada.');
  const record = {
    code: normalized,
    type: ['quota', 'days', 'plan'].includes(type) ? type : 'quota',
    value: type === 'plan' ? String(value || 'plus') : Number(value || 0),
    maxUses: Math.max(1, Math.min(10000, Number(maxUses) || 1)),
    uses: 0,
    expiresAt: expiresAt || null,
    active: true,
    note: String(note || '').slice(0, 200),
    createdBy: createdBy || '',
    createdAt: Date.now(),
  };
  await set(`redeemCodes/${normalized}`, record);
  return record;
}

async function redeemCode(user, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!code) throw new Error('Masukkan kode redeem.');
  const record = await get(`redeemCodes/${code}`);
  if (!record || record.active === false) throw new Error('Kode tidak valid atau sudah tidak aktif.');
  if (record.expiresAt && Number(record.expiresAt) < Date.now()) throw new Error('Kode sudah kedaluwarsa.');
  if (Number(record.uses || 0) >= Number(record.maxUses || 1)) throw new Error('Kuota pemakaian kode sudah habis.');
  const already = await get(`redeemRedemptions/${user.uid}/${code}`);
  if (already) throw new Error('Kamu sudah pernah memakai kode ini.');

  const plan = getPlan(record.type === 'plan' ? record.value : user.plan);
  const patch = {
    [`redeemCodes/${code}/uses`]: Number(record.uses || 0) + 1,
    [`redeemRedemptions/${user.uid}/${code}`]: Date.now(),
    [`users/${user.uid}/updatedAt`]: Date.now(),
  };
  let message = '';

  if (record.type === 'quota') {
    patch[`users/${user.uid}/quotaLimit`] = Number(user.quotaLimit || 0) + Number(record.value || 0);
    message = `Kuota bertambah ${Number(record.value || 0).toLocaleString('id-ID')} request.`;
  } else if (record.type === 'days') {
    const base = Math.max(Date.now(), Number(user.expiresAt || 0));
    patch[`users/${user.uid}/expiresAt`] = base + Number(record.value || 0) * 24 * 60 * 60 * 1000;
    message = `Masa aktif bertambah ${Number(record.value || 0)} hari.`;
  } else if (record.type === 'plan') {
    patch[`users/${user.uid}/plan`] = plan.key;
    patch[`users/${user.uid}/quotaLimit`] = Number(user.quotaLimit || 0) + Number(plan.quota || 0);
    const base = Math.max(Date.now(), Number(user.expiresAt || 0));
    patch[`users/${user.uid}/expiresAt`] = base + Number(plan.days || 30) * 24 * 60 * 60 * 1000;
    message = `Plan diubah ke ${plan.name}.`;
  }
  await multiUpdate(patch);
  return { message, code, record };
}

async function getReferralStats(user) {
  const referrals = (await get(`referrals/${user.uid}`)) || {};
  const list = Object.values(referrals).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return {
    code: user.referralCode,
    link: `${app.url}/register?ref=${encodeURIComponent(user.referralCode || '')}`,
    totalReferrals: list.length,
    totalBonus: list.reduce((sum, item) => sum + Number(item.bonus || 0), 0),
    list: list.slice(0, 20),
  };
}

async function getUsageSeries(uidValue, days = 14) {
  const data = (await get(`usage/${uidValue}`)) || {};
  return dateKeysBack(days).map((key) => {
    const item = data[key] || {};
    return {
      date: key,
      requests: Number(item.requests || item.count || 0),
      success: Number(item.success || 0),
      errors: Number(item.errors || 0),
      latencyAvg: Number(item.requests || 0)
        ? Math.round(Number(item.latencySum || 0) / Number(item.requests || 1))
        : 0,
    };
  });
}

async function getDailyStats(days = 14) {
  const data = (await get('stats/daily')) || {};
  return dateKeysBack(days).map((key) => {
    const item = data[key] || {};
    return {
      date: key,
      requests: Number(item.requests || 0),
      success: Number(item.success || 0),
      errors: Number(item.errors || 0),
      latencyAvg: Number(item.requests || 0)
        ? Math.round(Number(item.latencySum || 0) / Number(item.requests || 1))
        : 0,
    };
  });
}

async function getRecentLogs(limit = 20) {
  const snapshot = await ref('logs').limitToLast(limit).get();
  const data = snapshot.val() || {};
  return Object.entries(data)
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

async function getAdminLogs(limit = 50) {
  const snapshot = await ref('adminLogs').limitToLast(limit).get();
  const data = snapshot.val() || {};
  return Object.entries(data)
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

async function getStatsSnapshot() {
  const [totals, stats] = await Promise.all([get('stats/totals'), get('stats')]);
  return {
    totals: totals || { requests: 0, success: 0, errors: 0, latencySum: 0 },
    endpoints: (stats && stats.endpoints) || {},
    users: (stats && stats.users) || {},
    daily: (stats && stats.daily) || {},
  };
}

const seedApps = [
  {
    id: 'postman-collection',
    name: 'Postman Collection',
    description: 'Koleksi siap import untuk mencoba semua endpoint ZeroixApi.',
    platform: 'Postman / Insomnia',
    version: '1.0.0',
    size: '12 KB',
    url: '/downloads/zeroixapi-postman.json',
    icon: 'braces',
    active: true,
  },
  {
    id: 'cli-tool',
    name: 'ZeroixApi CLI',
    description: 'Script Node.js kecil untuk memanggil API dari terminal.',
    platform: 'Node.js 18+',
    version: '1.0.0',
    size: '2 KB',
    url: '/downloads/zeroixapi-cli.js',
    icon: 'terminal',
    active: true,
  },
];

async function seed() {
  const meta = (await get('meta')) || {};
  const now = Date.now();

  // Admin awal: hanya dibuat bila email belum ada. Password tidak pernah ditimpa.
  const adminEmail = app.adminEmail;
  const adminExisting = await getUserByEmail(adminEmail);
  if (!adminExisting && app.adminPassword) {
    const { hashPassword } = require('./security');
    const adminUser = await createUser({
      email: adminEmail,
      username: process.env.ADMIN_USERNAME || 'admin',
      name: app.adminName,
      passwordHash: hashPassword(app.adminPassword),
      role: 'admin',
      plan: 'ultimate',
      quotaLimit: 100000,
      expiresAt: now + 365 * 24 * 60 * 60 * 1000,
      emailVerified: true,
    });
    await update(`users/${adminUser.uid}`, { role: 'admin' });
    await recordAdminLog({
      adminUid: adminUser.uid,
      adminName: adminUser.name,
      action: 'seed_admin',
      detail: 'Akun admin awal dibuat dari environment.',
      target: adminUser.email,
    });
    console.log(`[seed] Admin dibuat: ${adminEmail}`);
  }

  const settings = (await get('settings/public')) || {};
  if (!settings.createdAt) {
    await set('settings/public', {
      waAdmin: app.waAdmin,
      freeLimitDaily: app.freeLimitDaily,
      registrationOpen: app.registrationOpen,
      announcement: '',
      announcementActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  const apps = (await get('apps')) || {};
  if (!Object.keys(apps).length) {
    const updates = {};
    for (const item of seedApps) updates[`apps/${item.id}`] = { ...item, createdAt: now, updatedAt: now };
    await multiUpdate(updates);
  }

  if (!meta.schema) {
    await update('meta', {
      schema: 1,
      createdAt: now,
      userCount: Number(meta.userCount || 0),
      seedVersion: 1,
    });
  }
}

module.exports = {
  ROOT,
  ref,
  get,
  set,
  update,
  remove,
  push,
  transaction,
  multiUpdate,
  hashIndex,
  safeUser,
  getUser,
  getUserByEmail,
  getUserByUsername,
  getUserByReferralCode,
  getApiKeyRecord,
  getApiKeyRecordByHash,
  revealApiKey,
  createApiKeyForUser,
  rotateApiKey,
  findOrCreateUserForProvider,
  createUser,
  updateUser,
  setUserPassword,
  deleteUser,
  recordAdminLog,
  getSettings,
  saveSettings,
  getApps,
  getTestimonials,
  getTestimonial,
  upsertTestimonial,
  getTransactions,
  createTransaction,
  getTickets,
  getTicket,
  createTicket,
  replyTicket,
  getRedeemCodes,
  createRedeemCode,
  redeemCode,
  getReferralStats,
  getUsageSeries,
  getDailyStats,
  getRecentLogs,
  getAdminLogs,
  getStatsSnapshot,
  seed,
};
