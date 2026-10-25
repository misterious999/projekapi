'use strict';

const crypto = require('crypto');
const dns = require('dns').promises;
const QRCode = require('qrcode');
const { app } = require('../config/app');
const { ApiError, fetchJson, fetchText, requireString, clampInt, validUrl } = require('../lib/http');
const { clientIp } = require('../lib/security');

const POSITIVE_WORDS = [
  'bagus', 'baik', 'cepat', 'mudah', 'membantu', 'senang', 'suka', 'keren', 'mantap', 'stabil',
  'puas', 'ramah', 'berguna', 'top', 'luar biasa', 'recommended', 'worth', 'aman', 'nyaman', 'lanjut',
  'good', 'great', 'excellent', 'fast', 'easy', 'helpful', 'love', 'nice', 'awesome', 'perfect',
];
const NEGATIVE_WORDS = [
  'buruk', 'jelek', 'lambat', 'susah', 'gagal', 'error', 'kecewa', 'marah', 'benci', 'mahal',
  'down', 'rusak', 'bingung', 'payah', 'parah', 'tidak bisa', 'gak bisa', 'kurang', 'lambat sekali',
  'bad', 'slow', 'broken', 'hate', 'angry', 'terrible', 'awful', 'useless', 'expensive', 'bug',
];

function localAnswer(question, tone = 'santai') {
  const lower = question.toLowerCase();
  let core;
  if (lower.includes('rest api') || lower.includes('apa itu api')) {
    core =
      'REST API adalah gaya arsitektur untuk membuat aplikasi saling berkomunikasi lewat HTTP. ' +
      'Setiap resource punya URL, dan operasi seperti GET, POST, PUT, dan DELETE mewakili aksi yang dilakukan. ' +
      'Data biasanya dikirim dalam format JSON.';
  } else if (lower.includes('json')) {
    core =
      'JSON (JavaScript Object Notation) adalah format pertukaran data berbasis teks. ' +
      'Bentuknya berupa pasangan key-value dan array, mudah dibaca manusia sekaligus mudah diproses mesin.';
  } else if (lower.includes('api key') || lower.includes('autentikasi')) {
    core =
      'API key adalah kredensial rahasia untuk mengidentifikasi pemanggil API. ' +
      'Simpan di environment variable, jangan pernah ditulis di kode frontend atau dibagikan ke publik.';
  } else if (lower.includes('cara') || lower.includes('bagaimana')) {
    core =
      `Untuk pertanyaan "${question}", langkah umumnya: tentukan tujuan, siapkan data yang dibutuhkan, ` +
      'panggil endpoint yang sesuai, lalu periksa status dan body respons sebelum memproses hasilnya.';
  } else {
    core =
      `Pertanyaanmu tentang "${question}" sudah diterima. Ini respons mode demo lokal karena server belum ` +
      'dikonfigurasi dengan penyedia AI. Kamu tetap bisa menguji alur request, autentikasi, dan format respons.';
  }
  if (tone === 'formal') return `${core} Semoga informasi ini membantu.`;
  if (tone === 'singkat') return core.split('. ').slice(0, 2).join('. ') + '.';
  return `${core} Kalau mau, kirim pertanyaan yang lebih spesifik ya.`;
}

function splitSentences(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

function extractiveSummary(text, max) {
  const sentences = splitSentences(text);
  if (!sentences.length) return [text.slice(0, 240)];
  const words = text.toLowerCase().match(/[a-z0-9]{4,}/g) || [];
  const frequency = new Map();
  for (const word of words) frequency.set(word, (frequency.get(word) || 0) + 1);
  const scored = sentences.map((sentence, index) => {
    const terms = sentence.toLowerCase().match(/[a-z0-9]{4,}/g) || [];
    const score = terms.reduce((sum, term) => sum + (frequency.get(term) || 0), 0) / (terms.length || 1);
    return { sentence, index, score };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, max)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence);
}

async function aiChat(input) {
  const q = requireString(input.q || input.prompt || input.text, 'q', { max: 1000 });
  const tone = ['santai', 'formal', 'singkat'].includes(String(input.tone || '').toLowerCase())
    ? String(input.tone).toLowerCase()
    : 'santai';

  if (!app.ai.apiKey) {
    return {
      answer: localAnswer(q, tone),
      model: 'demo-local',
      demo: true,
      note: 'Set AI_API_KEY di environment untuk memakai model AI eksternal.',
    };
  }

  const payload = {
    model: app.ai.model,
    messages: [
      {
        role: 'system',
        content:
          'Kamu adalah asisten API yang membantu dan ringkas. Jawab dalam bahasa yang dipakai pengguna. ' +
          'Maksimal 220 kata. Jangan mengarang data sensitif.',
      },
      { role: 'user', content: q },
    ],
    temperature: 0.7,
    max_tokens: 450,
  };
  const data = await fetchJson(`${app.ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${app.ai.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }, 25000);

  const answer = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  if (!answer) throw new ApiError(502, 'Model AI tidak mengembalikan jawaban.', 'upstream_empty');
  return {
    answer: String(answer).trim(),
    model: data.model || app.ai.model,
    usage: data.usage || null,
    demo: false,
  };
}

async function aiSummarize(input) {
  const text = requireString(input.text, 'text', { min: 40, max: 5000 });
  const max = clampInt(input.max, 1, 5, 3);

  if (app.ai.apiKey) {
    try {
      const data = await fetchJson(`${app.ai.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${app.ai.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: app.ai.model,
          messages: [
            { role: 'system', content: `Ringkas teks berikut menjadi ${max} poin singkat. Balas hanya JSON array berisi string.` },
            { role: 'user', content: text },
          ],
          temperature: 0.3,
          max_tokens: 400,
        }),
      }, 25000);
      const raw = data?.choices?.[0]?.message?.content || '[]';
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.length) {
          return { summary: parsed.slice(0, max).map(String), mode: 'ai', model: data.model || app.ai.model };
        }
      }
    } catch {
      // fallthrough ke ringkasan lokal
    }
  }

  return {
    summary: extractiveSummary(text, max),
    mode: 'local-extractive',
    words: text.split(/\s+/).filter(Boolean).length,
  };
}

async function aiSentiment(input) {
  const text = requireString(input.text, 'text', { max: 5000 }).toLowerCase();
  const positive = POSITIVE_WORDS.filter((word) => text.includes(word)).length;
  const negative = NEGATIVE_WORDS.filter((word) => text.includes(word)).length;
  const total = positive + negative;
  const score = total ? (positive - negative) / total : 0;
  let sentiment = 'netral';
  if (score > 0.15) sentiment = 'positif';
  if (score < -0.15) sentiment = 'negatif';
  return {
    sentiment,
    score: Math.round(score * 100) / 100,
    positive,
    negative,
    confidence: total ? Math.min(1, Math.round(((Math.abs(score) + 0.2) * 100)) / 100) : 0.2,
  };
}

async function youtubeMetadata(input) {
  const url = validUrl(input.url, ['http:', 'https:']);
  const host = url.hostname.replace(/^www\./, '');
  if (!['youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com'].includes(host)) {
    throw new ApiError(400, 'URL harus dari domain YouTube.', 'invalid_domain');
  }
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url.toString())}&format=json`;
  try {
    const data = await fetchJson(endpoint, {}, 12000);
    return {
      provider: 'YouTube',
      url: url.toString(),
      title: data.title,
      author: data.author_name,
      authorUrl: data.author_url,
      thumbnail: data.thumbnail_url,
      width: data.width,
      height: data.height,
    };
  } catch (error) {
    if (error.details && error.details.status === 404) {
      throw new ApiError(404, 'Video tidak ditemukan, privat, atau metadata tidak tersedia.', 'not_found');
    }
    throw error;
  }
}

async function tiktokMetadata(input) {
  const url = validUrl(input.url, ['http:', 'https:']);
  const host = url.hostname.replace(/^www\./, '');
  if (!['tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'].includes(host)) {
    throw new ApiError(400, 'URL harus dari domain TikTok.', 'invalid_domain');
  }
  const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url.toString())}`;
  try {
    const data = await fetchJson(endpoint, {}, 12000);
    return {
      provider: 'TikTok',
      url: url.toString(),
      title: data.title,
      author: data.author_name,
      authorUrl: data.author_url,
      thumbnail: data.thumbnail_url,
    };
  } catch (error) {
    if (error.details && error.details.status === 400) {
      throw new ApiError(404, 'Postingan tidak ditemukan atau tidak dapat diakses.', 'not_found');
    }
    throw error;
  }
}

async function qrCode(input) {
  const text = requireString(input.text, 'text', { max: 1500 });
  const size = clampInt(input.size, 120, 1000, 320);
  const format = String(input.format || 'png').toLowerCase();

  if (format === 'svg') {
    const svg = await QRCode.toString(text, {
      type: 'svg',
      width: size,
      margin: 2,
      color: { dark: '#07111f', light: '#ffffff' },
    });
    return { format: 'svg', size, svg };
  }

  const dataUrl = await QRCode.toDataURL(text, {
    width: size,
    margin: 2,
    color: { dark: '#07111f', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  });
  return { format: 'png', size, dataUrl };
}

const QUOTES = {
  motivasi: [
    { quote: 'Mulai dari yang kecil, konsisten, lalu biarkan hasilnya bicara.', author: 'ZeroixApi' },
    { quote: 'Yang sulit bukan memulai, tapi bertahan saat hasilnya belum terlihat.', author: 'ZeroixApi' },
    { quote: 'Satu langkah hari ini lebih baik daripada rencana besar yang tidak pernah dijalankan.', author: 'ZeroixApi' },
  ],
  teknologi: [
    { quote: 'Sistem yang baik membuat hal sulit terasa biasa.', author: 'ZeroixApi' },
    { quote: 'Kode yang jelas lebih berharga daripada kode yang terlihat pintar.', author: 'ZeroixApi' },
    { quote: 'Otomatiskan yang berulang, pikirkan yang penting.', author: 'ZeroixApi' },
  ],
  kehidupan: [
    { quote: 'Tempat terbaik untuk memulai adalah tempat kamu sekarang.', author: 'ZeroixApi' },
    { quote: 'Berhenti membandingkan prosesmu dengan highlight orang lain.', author: 'ZeroixApi' },
    { quote: 'Istirahat bukan kemunduran, kadang itu cara paling sehat untuk maju.', author: 'ZeroixApi' },
  ],
};

async function quote(input) {
  const category = ['motivasi', 'teknologi', 'kehidupan'].includes(String(input.category || '').toLowerCase())
    ? String(input.category).toLowerCase()
    : null;
  const keys = category ? [category] : Object.keys(QUOTES);
  const picked = keys[Math.floor(Math.random() * keys.length)];
  const list = QUOTES[picked];
  const item = list[Math.floor(Math.random() * list.length)];
  return { ...item, category: picked };
}

async function shorten(input) {
  const url = validUrl(input.url).toString();
  try {
    const short = (await fetchText(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, {}, 10000)).trim();
    if (/^https?:\/\//i.test(short)) return { original: url, short, provider: 'tinyurl' };
  } catch {
    // fallback is.gd
  }
  try {
    const short = (await fetchText(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`, {}, 10000)).trim();
    if (/^https?:\/\//i.test(short)) return { original: url, short, provider: 'is.gd' };
  } catch {
    // ignore
  }
  throw new ApiError(502, 'Layanan shortlink sedang tidak tersedia. Coba lagi nanti.', 'shortlink_unavailable');
}

const WEATHER_CODES = {
  0: 'Cerah',
  1: 'Cerah berawan',
  2: 'Berawan sebagian',
  3: 'Mendung',
  45: 'Berkabut',
  48: 'Kabut beku',
  51: 'Gerimis ringan',
  53: 'Gerimis',
  55: 'Gerimis lebat',
  56: 'Gerimis beku ringan',
  57: 'Gerimis beku lebat',
  61: 'Hujan ringan',
  63: 'Hujan',
  65: 'Hujan lebat',
  66: 'Hujan beku ringan',
  67: 'Hujan beku lebat',
  71: 'Salju ringan',
  73: 'Salju',
  75: 'Salju lebat',
  77: 'Butiran salju',
  80: 'Hujan lokal ringan',
  81: 'Hujan lokal',
  82: 'Hujan lokal lebat',
  85: 'Hujan salju ringan',
  86: 'Hujan salju lebat',
  95: 'Badai petir',
  96: 'Badai petir dengan hujan es',
  99: 'Badai petir hebat dengan hujan es',
};

async function weather(input) {
  const city = requireString(input.city, 'city', { min: 2, max: 80 });
  const geo = await fetchJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=id&format=json`,
    {},
    12000
  );
  const place = geo.results && geo.results[0];
  if (!place) throw new ApiError(404, `Kota "${city}" tidak ditemukan.`, 'not_found');

  const forecast = await fetchJson(
    'https://api.open-meteo.com/v1/forecast?' +
      new URLSearchParams({
        latitude: place.latitude,
        longitude: place.longitude,
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
        timezone: 'auto',
        forecast_days: '3',
      }),
    {},
    12000
  );

  const current = forecast.current || {};
  const daily = forecast.daily || {};
  const days = (daily.time || []).map((date, index) => ({
    date,
    max: daily.temperature_2m_max?.[index],
    min: daily.temperature_2m_min?.[index],
    rainChance: daily.precipitation_probability_max?.[index],
    condition: WEATHER_CODES[daily.weather_code?.[index]] || 'Tidak diketahui',
  }));

  return {
    city: place.name,
    region: [place.admin1, place.country].filter(Boolean).join(', '),
    latitude: place.latitude,
    longitude: place.longitude,
    timezone: forecast.timezone,
    temperature: current.temperature_2m,
    feelsLike: current.apparent_temperature,
    humidity: current.relative_humidity_2m,
    windSpeed: current.wind_speed_10m,
    condition: WEATHER_CODES[current.weather_code] || 'Tidak diketahui',
    forecast: days,
    source: 'Open-Meteo',
  };
}

async function currency(input) {
  const from = String(input.from || 'USD').trim().toUpperCase();
  const to = String(input.to || 'IDR').trim().toUpperCase();
  const amount = Number(input.amount || 1);
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
    throw new ApiError(400, 'Kode mata uang harus 3 huruf, contoh USD atau IDR.', 'invalid_currency');
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
    throw new ApiError(400, 'Amount harus angka antara 0 dan 1 miliar.', 'invalid_amount');
  }
  const data = await fetchJson(`https://open.er-api.com/v6/latest/${from}`, {}, 12000);
  if (!data || data.result !== 'success' || !data.rates) {
    throw new ApiError(502, 'Kurs mata uang sedang tidak tersedia.', 'rates_unavailable');
  }
  const rate = Number(data.rates[to]);
  if (!rate) throw new ApiError(400, `Mata uang ${to} tidak didukung.`, 'unsupported_currency');
  return {
    from,
    to,
    amount,
    rate,
    result: Math.round(amount * rate * 100) / 100,
    updatedAt: data.time_last_update_utc || null,
    source: 'open.er-api.com',
  };
}

async function uuid(input) {
  const count = clampInt(input.count, 1, 20, 1);
  return { count, uuids: Array.from({ length: count }, () => crypto.randomUUID()) };
}

async function base64(input) {
  const text = requireString(input.text, 'text', { max: 10000 });
  const mode = String(input.mode || 'encode').toLowerCase();
  if (mode === 'decode') {
    if (!/^[A-Za-z0-9+/=\s]+$/.test(text)) {
      throw new ApiError(400, 'Teks bukan Base64 yang valid.', 'invalid_base64');
    }
    const decoded = Buffer.from(text, 'base64').toString('utf8');
    return { mode: 'decode', result: decoded, bytes: Buffer.byteLength(decoded) };
  }
  if (mode !== 'encode') throw new ApiError(400, 'Mode harus encode atau decode.', 'invalid_mode');
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  return { mode: 'encode', result: encoded, bytes: Buffer.byteLength(text) };
}

async function hash(input) {
  const text = requireString(input.text, 'text', { max: 10000 });
  const algo = String(input.algo || 'sha256').toLowerCase();
  if (!['md5', 'sha1', 'sha256', 'sha512'].includes(algo)) {
    throw new ApiError(400, 'Algoritma harus md5, sha1, sha256, atau sha512.', 'invalid_algo');
  }
  return { algo, hash: crypto.createHash(algo).update(text).digest('hex') };
}

async function dnsLookup(input) {
  const domain = requireString(input.domain, 'domain', { min: 3, max: 253 })
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0];
  if (!/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(domain)) {
    throw new ApiError(400, 'Domain tidak valid.', 'invalid_domain');
  }
  const type = String(input.type || 'A').toUpperCase();
  const allowed = ['A', 'AAAA', 'MX', 'TXT', 'CNAME', 'NS'];
  if (!allowed.includes(type)) {
    throw new ApiError(400, `Tipe DNS harus salah satu dari: ${allowed.join(', ')}.`, 'invalid_type');
  }
  const lookup = {
    A: () => dns.resolve4(domain),
    AAAA: () => dns.resolve6(domain),
    MX: () => dns.resolveMx(domain),
    TXT: () => dns.resolveTxt(domain).then((rows) => rows.map((row) => row.join(''))),
    CNAME: () => dns.resolveCname(domain),
    NS: () => dns.resolveNs(domain),
  }[type];

  try {
    const records = await Promise.race([
      lookup(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DNS_TIMEOUT')), 8000)),
    ]);
    return { domain, type, records, count: records.length };
  } catch (error) {
    if (error.message === 'DNS_TIMEOUT') {
      throw new ApiError(504, 'Resolver DNS tidak merespons tepat waktu.', 'dns_timeout');
    }
    if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
      return { domain, type, records: [], count: 0, note: 'Tidak ada record untuk tipe tersebut.' };
    }
    throw new ApiError(502, 'Gagal melakukan lookup DNS.', 'dns_error', error.code || error.message);
  }
}

async function ipInfo(input, ctx) {
  const req = ctx.req;
  return {
    ip: clientIp(req),
    forwardedFor: req.headers['x-forwarded-for'] || null,
    country: req.headers['cf-ipcountry'] || null,
    userAgent: req.headers['user-agent'] || null,
    protocol: req.protocol,
    host: req.headers.host || null,
    method: req.method,
    requestId: ctx.requestId,
  };
}

async function status() {
  return {
    service: app.name,
    version: app.version,
    status: 'operational',
    uptime: Math.floor(process.uptime()),
    time: new Date().toISOString(),
    endpoints: require('../config/app').endpointCount,
    runtime: `Node ${process.version}`,
  };
}

async function me(input, ctx) {
  const user = ctx.user;
  const plan = require('../config/app').getPlan(user.plan);
  return {
    uid: user.uid,
    username: user.username,
    name: user.name,
    email: user.email,
    plan: plan.key,
    planName: plan.name,
    quota: {
      limit: Number(user.quotaLimit || 0),
      used: Number(user.quotaUsed || 0),
      remaining: Math.max(0, Number(user.quotaLimit || 0) - Number(user.quotaUsed || 0)),
    },
    expiresAt: user.expiresAt || null,
    active: user.isActive !== false,
    createdAt: user.createdAt,
    requestId: ctx.requestId,
  };
}

const handlers = {
  'ai-chat': aiChat,
  'ai-summarize': aiSummarize,
  'ai-sentiment': aiSentiment,
  'youtube-metadata': youtubeMetadata,
  'tiktok-metadata': tiktokMetadata,
  'qr-code': qrCode,
  quote,
  shorten,
  weather,
  currency,
  uuid,
  base64,
  hash,
  dns: dnsLookup,
  ip: ipInfo,
  status,
  me,
};

module.exports = { handlers, localAnswer, extractiveSummary };
