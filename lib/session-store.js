'use strict';

const session = require('express-session');
const { db } = require('../config/firebase');

const ROOT = (process.env.FIREBASE_DB_ROOT || 'zeroixapi').replace(/^\/|\/$/g, '');

/**
 * Session store berbasis Firebase Realtime Database. Session tidak hilang
 * saat proses Node restart, dan bisa dipakai lebih dari satu instance.
 */
class FirebaseSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.ttlMs = options.ttlMs || 7 * 24 * 60 * 60 * 1000;
    this.base = db.ref(`${ROOT}/sessions`);
    this.cleanupTimer = setInterval(() => this.cleanup(), 6 * 60 * 60 * 1000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  ref(sid) {
    return this.base.child(String(sid));
  }

  get(sid, callback) {
    this.ref(sid)
      .get()
      .then((snapshot) => {
        const data = snapshot.val();
        if (!data || !data.session) return callback(null, null);
        if (data.expiresAt && Number(data.expiresAt) <= Date.now()) {
          return this.ref(sid).remove().then(() => callback(null, null)).catch(() => callback(null, null));
        }
        try {
          callback(null, JSON.parse(data.session));
        } catch {
          callback(null, null);
        }
      })
      .catch((error) => callback(error));
  }

  set(sid, value, callback = () => {}) {
    let ttl = this.ttlMs;
    if (value && value.cookie && value.cookie.maxAge) ttl = Number(value.cookie.maxAge);
    const payload = {
      session: JSON.stringify(value),
      expiresAt: Date.now() + ttl,
      updatedAt: Date.now(),
    };
    this.ref(sid)
      .set(payload)
      .then(() => callback(null))
      .catch((error) => callback(error));
  }

  touch(sid, value, callback = () => {}) {
    let ttl = this.ttlMs;
    if (value && value.cookie && value.cookie.maxAge) ttl = Number(value.cookie.maxAge);
    this.ref(sid)
      .update({ expiresAt: Date.now() + ttl, updatedAt: Date.now() })
      .then(() => callback(null))
      .catch((error) => callback(error));
  }

  destroy(sid, callback = () => {}) {
    this.ref(sid)
      .remove()
      .then(() => callback(null))
      .catch((error) => callback(error));
  }

  async cleanup() {
    try {
      const snapshot = await this.base.limitToFirst(200).get();
      const data = snapshot.val() || {};
      const now = Date.now();
      const updates = {};
      for (const [sid, record] of Object.entries(data)) {
        if (!record || !record.expiresAt || Number(record.expiresAt) <= now) {
          updates[`${ROOT}/sessions/${sid}`] = null;
        }
      }
      if (Object.keys(updates).length) await db.ref().update(updates);
    } catch (error) {
      console.warn('[session] cleanup gagal:', error.message);
    }
  }
}

module.exports = { FirebaseSessionStore };
