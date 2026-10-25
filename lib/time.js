'use strict';

const WITA_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Tanggal (YYYY-MM-DD) berdasarkan zona WITA (UTC+8), dipakai untuk
 * reset kuota FreeLimit dan grafik harian.
 */
function dateKeyWita(input = Date.now()) {
  const date = input instanceof Date ? input : new Date(Number(input) || input);
  const shifted = new Date(date.getTime() + WITA_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(
    shifted.getUTCDate()
  ).padStart(2, '0')}`;
}

function witaResetAt(input = Date.now()) {
  const now = new Date(Number(input) || Date.now());
  const shifted = new Date(now.getTime() + WITA_OFFSET_MS);
  const nextMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
    0,
    0,
    0,
    0
  );
  return nextMidnight - WITA_OFFSET_MS;
}

function dateKeysBack(days, input = Date.now()) {
  const keys = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    keys.push(dateKeyWita(Number(input) - i * 24 * 60 * 60 * 1000));
  }
  return keys;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return { days, hours, minutes, seconds, total };
}

function countdownParts(target, now = Date.now()) {
  const diff = Number(target || 0) - now;
  return { expired: diff <= 0, ...formatDuration(diff) };
}

module.exports = { WITA_OFFSET_MS, dateKeyWita, witaResetAt, dateKeysBack, formatDuration, countdownParts };
