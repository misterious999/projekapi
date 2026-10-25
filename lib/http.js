'use strict';

class ApiError extends Error {
  constructor(status, message, code = 'bad_request', details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = Number(status) || 400;
    this.code = code;
    this.details = details;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': 'NusaAPI/1.0 (+https://nusaapi.local)',
      Accept: 'application/json,text/plain,*/*',
      ...(options.headers || {}),
    },
  });
  return response;
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  let response;
  try {
    response = await fetchWithTimeout(url, options, timeoutMs);
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new ApiError(504, 'Layanan upstream tidak merespons tepat waktu.', 'upstream_timeout');
    }
    throw new ApiError(502, 'Gagal menghubungi layanan upstream.', 'upstream_unreachable', error.message);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new ApiError(502, `Layanan upstream mengembalikan status ${response.status}.`, 'upstream_error', {
      status: response.status,
      body: text.slice(0, 300),
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(502, 'Respons upstream bukan JSON yang valid.', 'upstream_invalid', text.slice(0, 300));
  }
}

async function fetchText(url, options = {}, timeoutMs = 15000) {
  let response;
  try {
    response = await fetchWithTimeout(url, options, timeoutMs);
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new ApiError(504, 'Layanan upstream tidak merespons tepat waktu.', 'upstream_timeout');
    }
    throw new ApiError(502, 'Gagal menghubungi layanan upstream.', 'upstream_unreachable', error.message);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new ApiError(502, `Layanan upstream mengembalikan status ${response.status}.`, 'upstream_error', {
      status: response.status,
      body: text.slice(0, 300),
    });
  }
  return text;
}

function requireString(value, name, { min = 1, max = 5000 } = {}) {
  const text = String(value || '').trim();
  if (!text) throw new ApiError(400, `Parameter "${name}" wajib diisi.`, 'missing_parameter', { parameter: name });
  if (text.length < min) {
    throw new ApiError(400, `Parameter "${name}" minimal ${min} karakter.`, 'invalid_parameter', { parameter: name });
  }
  if (text.length > max) {
    throw new ApiError(400, `Parameter "${name}" maksimal ${max} karakter.`, 'invalid_parameter', { parameter: name });
  }
  return text;
}

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function validUrl(value, allowedProtocols = ['http:', 'https:']) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new ApiError(400, 'URL tidak valid.', 'invalid_url');
  }
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new ApiError(400, 'Hanya URL http/https yang didukung.', 'invalid_url');
  }
  return parsed;
}

module.exports = { ApiError, fetchJson, fetchText, requireString, clampInt, validUrl };
