'use strict';

const os = require('os');
const fs = require('fs');
const { app } = require('../config/app');
const { endpoints, getPlan, planRank, remainingQuota } = require('../config/app');
const store = require('./store');
const { dateKeyWita, witaResetAt, dateKeysBack } = require('./time');

let previousCpu = null;

function cpuUsage() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times)) total += cpu.times[type];
    idle += cpu.times.idle;
  }
  if (!previousCpu) {
    previousCpu = { idle, total };
    return { percent: 0, cores: cpus.length };
  }
  const idleDiff = idle - previousCpu.idle;
  const totalDiff = total - previousCpu.total;
  previousCpu = { idle, total };
  const percent = totalDiff > 0 ? Math.max(0, Math.min(100, (1 - idleDiff / totalDiff) * 100)) : 0;
  return { percent: Math.round(percent * 10) / 10, cores: cpus.length };
}

function diskUsage() {
  try {
    const stat = fs.statfsSync('/');
    const total = stat.blocks * stat.bsize;
    const free = stat.bfree * stat.bsize;
    const used = Math.max(0, total - free);
    return {
      total,
      free,
      used,
      percent: total ? Math.round((used / total) * 1000) / 10 : 0,
    };
  } catch {
    return { total: 0, free: 0, used: 0, percent: 0 };
  }
}

function serverMetrics() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memory = process.memoryUsage();
  const cpu = cpuUsage();
  const disk = diskUsage();
  return {
    cpu: { percent: cpu.percent, cores: cpu.cores, load: os.loadavg()[0] },
    memory: {
      percent: totalMem ? Math.round((usedMem / totalMem) * 1000) / 10 : 0,
      used: usedMem,
      total: totalMem,
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
    },
    disk,
    uptime: Math.floor(process.uptime()),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    node: process.version,
    runtime: `Node ${process.version}`,
    hostname: os.hostname(),
    time: Date.now(),
  };
}

function maskIp(ip) {
  const clean = String(ip || '').replace(/^::ffff:/i, '');
  if (clean.includes(':') && !clean.includes('.')) {
    const parts = clean.split(':');
    return parts.slice(0, 3).join(':') + ':****';
  }
  const parts = clean.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.***.***`;
  return clean || '-';
}

/**
 * Kurangi kuota user secara atomik. Transaksi dilakukan pada node user agar
 * status expired dan sisa kuota selalu konsisten.
 */
async function consumeUserQuota(uid) {
  const applyQuota = (user) => {
    // Return null (not undefined) saat cache transaksi masih kosong. Ini
    // memaksa Realtime Database membaca nilai server lalu menjalankan ulang
    // transaksi. Return undefined justru membatalkan transaksi sebelum baca.
    if (!user) return null;
    if (user.isActive === false) return;
    if (user.expiresAt && Number(user.expiresAt) < Date.now()) return;
    const limit = Number(user.quotaLimit || 0);
    const used = Number(user.quotaUsed || 0);
    if (used >= limit) return;
    user.quotaUsed = used + 1;
    user.lastRequestAt = Date.now();
    return user;
  };

  const userRef = store.ref(`users/${uid}`);
  let result = await userRef.transaction(applyQuota);
  let user = result.snapshot ? result.snapshot.val() : null;

  // Realtime Database kadang mengembalikan snapshot kosong saat transaksi
  // pertama belum memuat cache node (terutama tepat setelah registrasi).
  // Pastikan user benar-benar tidak ada sebelum menolak request.
  if (!user) {
    const existing = await store.getUser(uid);
    if (!existing) return { ok: false, code: 'not_found', message: 'Akun tidak ditemukan.', user: null };
    result = await userRef.transaction(applyQuota);
    user = result.snapshot ? result.snapshot.val() : null;
  }
  if (!user) return { ok: false, code: 'not_found', message: 'Akun tidak ditemukan.', user: null };
  if (!result.committed) {
    if (user.isActive === false) {
      return { ok: false, code: 'inactive', message: 'Akun sedang dinonaktifkan.', user };
    }
    if (user.expiresAt && Number(user.expiresAt) < Date.now()) {
      return {
        ok: false,
        code: 'expired',
        message: 'Masa aktif paket sudah habis. Silakan perpanjang paket.',
        user,
      };
    }
    return { ok: false, code: 'quota', message: 'Kuota request sudah habis.', user };
  }

  const limit = Number(user.quotaLimit || 0);
  const used = Number(user.quotaUsed || 0);
  return {
    ok: true,
    user,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    percent: limit ? Math.min(100, Math.round((used / limit) * 100)) : 0,
  };
}

async function getFreeLimitState(dailyLimit = app.freeLimitDaily) {
  const date = dateKeyWita();
  const record = (await store.get(`freeLimit/${date}`)) || {};
  const used = Number(record.count || 0);
  const limit = Number(dailyLimit || app.freeLimitDaily);
  return {
    date,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    percent: limit ? Math.min(100, Math.round((used / limit) * 100)) : 0,
    resetAt: witaResetAt(),
  };
}

async function consumeFreeLimit(dailyLimit = app.freeLimitDaily) {
  const date = dateKeyWita();
  const result = await store.ref(`freeLimit/${date}`).transaction((current) => {
    const value = current && typeof current === 'object' ? current : { count: 0, date };
    const count = Number(value.count || 0);
    if (count >= dailyLimit) return value;
    return { ...value, date, count: count + 1, updatedAt: Date.now() };
  });
  const value = result.snapshot ? result.snapshot.val() : { count: 0 };
  const used = Number(value.count || 0);
  if (used > dailyLimit) {
    return { ok: false, used, limit: dailyLimit, remaining: 0, resetAt: witaResetAt() };
  }
  return {
    ok: true,
    used,
    limit: dailyLimit,
    remaining: Math.max(0, dailyLimit - used),
    resetAt: witaResetAt(),
  };
}

async function isPlanAllowed(user, requiredPlan) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.isActive === false) return false;
  if (user.expiresAt && Number(user.expiresAt) < Date.now()) return false;
  return planRank(user.plan) >= planRank(requiredPlan);
}

/**
 * Catat request ke log, statistik global, dan grafik user. Dipanggil
 * fire-and-forget setelah response dikirim agar tidak menambah latency.
 */
async function recordRequest({ uid, username, endpoint, method, path, status, ms, ip, keyType, requestId }) {
  const createdAt = Date.now();
  const date = dateKeyWita(createdAt);
  const success = status >= 200 && status < 400;
  const log = {
    uid: uid || null,
    username: username || 'public',
    endpointId: endpoint || 'unknown',
    method: method || 'GET',
    path: path || '',
    status: Number(status) || 0,
    ms: Math.max(0, Number(ms) || 0),
    ip: maskIp(ip),
    keyType: keyType || 'account',
    requestId: requestId || '',
    createdAt,
  };

  const jobs = [store.push('logs', log)];

  jobs.push(
    store.ref('stats').transaction((current) => {
      const stats = current && typeof current === 'object' ? current : {};
      stats.totals = stats.totals || { requests: 0, success: 0, errors: 0, latencySum: 0 };
      stats.totals.requests = Number(stats.totals.requests || 0) + 1;
      stats.totals.latencySum = Number(stats.totals.latencySum || 0) + log.ms;
      if (success) stats.totals.success = Number(stats.totals.success || 0) + 1;
      else stats.totals.errors = Number(stats.totals.errors || 0) + 1;

      stats.daily = stats.daily || {};
      stats.daily[date] = stats.daily[date] || { requests: 0, success: 0, errors: 0, latencySum: 0 };
      stats.daily[date].requests += 1;
      stats.daily[date].latencySum += log.ms;
      if (success) stats.daily[date].success += 1;
      else stats.daily[date].errors += 1;

      stats.endpoints = stats.endpoints || {};
      const ep = (stats.endpoints[endpoint] = stats.endpoints[endpoint] || {
        requests: 0,
        success: 0,
        errors: 0,
        latencySum: 0,
      });
      ep.requests += 1;
      ep.latencySum += log.ms;
      if (success) ep.success += 1;
      else ep.errors += 1;

      if (uid) {
        stats.users = stats.users || {};
        const usr = (stats.users[uid] = stats.users[uid] || {
          requests: 0,
          success: 0,
          errors: 0,
          latencySum: 0,
          username: username || '',
        });
        usr.requests += 1;
        usr.latencySum += log.ms;
        usr.username = username || usr.username;
        if (success) usr.success += 1;
        else usr.errors += 1;
      }
      return stats;
    })
  );

  if (uid) {
    jobs.push(
      store.ref(`usage/${uid}/${date}`).transaction((current) => {
        const value = current && typeof current === 'object' ? current : {
          requests: 0,
          success: 0,
          errors: 0,
          latencySum: 0,
        };
        value.requests = Number(value.requests || 0) + 1;
        value.latencySum = Number(value.latencySum || 0) + log.ms;
        if (success) value.success = Number(value.success || 0) + 1;
        else value.errors = Number(value.errors || 0) + 1;
        return value;
      })
    );
  }

  await Promise.allSettled(jobs);
}

function percent(part, total) {
  return total ? Math.round((Number(part || 0) / Number(total || 1)) * 1000) / 10 : 0;
}

let monitorCache = { at: 0, data: null };
let landingCache = { at: 0, data: null };

async function getMonitorData({ force = false } = {}) {
  if (!force && monitorCache.data && Date.now() - monitorCache.at < 5000) return monitorCache.data;

  const settings = await store.getSettings();
  const [snapshot, logs, daily, freeLimit, userCount] = await Promise.all([
    store.getStatsSnapshot(),
    store.getRecentLogs(30),
    store.getDailyStats(14),
    getFreeLimitState(settings.freeLimitDaily),
    store.get('meta/userCount'),
  ]);

  const totals = snapshot.totals || {};
  const totalRequests = Number(totals.requests || 0);
  const success = Number(totals.success || 0);
  const avgLatency = totalRequests ? Math.round(Number(totals.latencySum || 0) / totalRequests) : 0;

  const topEndpoints = Object.entries(snapshot.endpoints || {})
    .map(([id, value]) => {
      const meta = endpoints.find((ep) => ep.id === id);
      return {
        id,
        name: meta ? meta.name : id,
        path: meta ? meta.path : '',
        requests: Number(value.requests || 0),
        successRate: percent(value.success, value.requests),
        avgLatency: Number(value.requests || 0)
          ? Math.round(Number(value.latencySum || 0) / Number(value.requests || 1))
          : 0,
      };
    })
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 10);

  const topUserEntries = Object.entries(snapshot.users || {})
    .map(([uid, value]) => ({ uid, ...value }))
    .sort((a, b) => Number(b.requests || 0) - Number(a.requests || 0))
    .slice(0, 10);

  const topUsers = await Promise.all(
    topUserEntries.map(async (item) => {
      let username = item.username;
      if (!username) {
        const user = await store.getUser(item.uid);
        username = user ? user.username : 'unknown';
      }
      return {
        uid: item.uid,
        username,
        requests: Number(item.requests || 0),
        successRate: percent(item.success, item.requests),
        avgLatency: Number(item.requests || 0)
          ? Math.round(Number(item.latencySum || 0) / Number(item.requests || 1))
          : 0,
      };
    })
  );

  const metrics = serverMetrics();
  const data = {
    generatedAt: Date.now(),
    totals: {
      requests: totalRequests,
      success,
      errors: Number(totals.errors || 0),
      successRate: totalRequests ? Math.round((success / totalRequests) * 1000) / 10 : 0,
      avgLatency,
      users: Number(userCount || 0),
      endpoints: endpoints.filter((ep) => !ep.public).length,
    },
    metrics,
    topEndpoints,
    topUsers,
    daily,
    freeLimit,
    recent: logs.map((log) => ({
      id: log.id,
      username: log.username || 'public',
      endpointId: log.endpointId,
      endpoint: (endpoints.find((ep) => ep.id === log.endpointId) || {}).name || log.endpointId,
      method: log.method,
      status: log.status,
      ms: log.ms,
      ip: log.ip,
      createdAt: log.createdAt,
      requestId: log.requestId,
    })),
    system: {
      platform: metrics.platform,
      runtime: metrics.runtime,
      node: metrics.node,
      arch: metrics.arch,
      uptime: metrics.uptime,
    },
  };
  monitorCache = { at: Date.now(), data };
  return data;
}

async function getLandingStats() {
  if (landingCache.data && Date.now() - landingCache.at < 20000) return landingCache.data;
  const settings = await store.getSettings();
  const [snapshot, userCount, freeLimit] = await Promise.all([
    store.getStatsSnapshot(),
    store.get('meta/userCount'),
    getFreeLimitState(settings.freeLimitDaily),
  ]);
  const totals = snapshot.totals || {};
  const requests = Number(totals.requests || 0);
  const success = Number(totals.success || 0);
  const data = {
    requests,
    successRate: requests ? Math.round((success / requests) * 1000) / 10 : 0,
    users: Number(userCount || 0),
    endpoints: endpoints.length,
    freeLimit,
    uptime: Math.floor(process.uptime()),
  };
  landingCache = { at: Date.now(), data };
  return data;
}

async function getUsageSeries(uid, days = 14) {
  const keys = dateKeysBack(days);
  const data = (await store.get(`usage/${uid}`)) || {};
  return keys.map((date) => {
    const value = data[date] || {};
    const requests = Number(value.requests || 0);
    const success = Number(value.success || 0);
    return {
      date,
      requests,
      success,
      errors: Number(value.errors || 0),
      avgLatency: requests ? Math.round(Number(value.latencySum || 0) / requests) : 0,
      successRate: requests ? Math.round((success / requests) * 1000) / 10 : 0,
    };
  });
}

function quotaForUser(user) {
  const plan = getPlan(user.plan);
  return {
    plan,
    limit: Number(user.quotaLimit || plan.quota),
    used: Number(user.quotaUsed || 0),
    remaining: remainingQuota(user),
    percent: Number(user.quotaLimit || 0)
      ? Math.min(100, Math.round((Number(user.quotaUsed || 0) / Number(user.quotaLimit || 1)) * 100))
      : 0,
  };
}

module.exports = {
  serverMetrics,
  maskIp,
  consumeUserQuota,
  getFreeLimitState,
  consumeFreeLimit,
  isPlanAllowed,
  recordRequest,
  getMonitorData,
  getLandingStats,
  getUsageSeries,
  quotaForUser,
  dateKeyWita,
  witaResetAt,
  dateKeysBack,
};
