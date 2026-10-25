'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const { app } = require('./app');

let credential;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
  } else {
    const keyPath = path.resolve(
      process.env.FIREBASE_SERVICE_ACCOUNT || path.join(__dirname, '..', 'serviceAccountKey.json')
    );
    if (!fs.existsSync(keyPath)) {
      throw new Error(`Service account tidak ditemukan di ${keyPath}`);
    }
    credential = admin.credential.cert(require(keyPath));
  }
} catch (error) {
  console.error('\n[firebase] Gagal memuat service account:', error.message);
  console.error('[firebase] Salin serviceAccountKey.json ke root project atau set FIREBASE_SERVICE_ACCOUNT_JSON.\n');
  process.exit(1);
}

const databaseURL =
  process.env.FIREBASE_DATABASE_URL ||
  process.env.VITE_FIREBASE_DATABASE_URL ||
  'https://shop-panel-pstar7-default-rtdb.asia-southeast1.firebasedatabase.app';

if (!admin.apps.length) {
  admin.initializeApp({
    credential,
    databaseURL,
  });
}

const db = admin.database();
const auth = admin.auth();

const serverTimestamp = () => Date.now();

module.exports = { admin, db, auth, databaseURL, serverTimestamp, app };
