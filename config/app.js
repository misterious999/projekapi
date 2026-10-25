'use strict';

require('dotenv').config();

const crypto = require('crypto');

const env = process.env;
const isProd = env.NODE_ENV === 'production';

const app = {
  name: env.APP_NAME || 'NusaAPI',
  legalName: env.APP_LEGAL_NAME || 'NusaAPI',
  tagline: env.APP_TAGLINE || 'Satu API untuk semua project.',
  description:
    env.APP_DESCRIPTION ||
    'REST API publik dengan dokumentasi lengkap, API key, kuota transparan, monitoring layanan, dan dashboard penggunaan.',
  url: (env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  port: Number(env.PORT || 3000),
  env: env.NODE_ENV || 'development',
  isProd,
  version: env.APP_VERSION || '1.0.0',
  year: new Date().getFullYear(),
  waAdmin: (env.WA_ADMIN || '6281234567890').replace(/\D/g, ''),
  supportEmail: env.SUPPORT_EMAIL || 'support@nusaapi.local',
  sessionSecret: env.SESSION_SECRET || 'dev-session-secret-change-me',
  keySecret: env.KEY_ENCRYPTION_SECRET || env.SESSION_SECRET || 'dev-key-secret-change-me',
  adminEmail: (env.ADMIN_EMAIL || 'admin@nusaapi.local').toLowerCase(),
  adminPassword: env.ADMIN_PASSWORD || 'Admin#12345',
  adminName: env.ADMIN_NAME || 'Administrator',
  registrationOpen: String(env.REGISTRATION_OPEN || 'true') !== 'false',
  freeLimitDaily: Number(env.FREE_LIMIT_DAILY || 200),
  freePlanQuota: Number(env.FREE_PLAN_QUOTA || 100),
  referralBonus: Number(env.REFERRAL_BONUS || 150),
  sessionDays: Number(env.SESSION_DAYS || 7),
  trustProxy: env.TRUST_PROXY === 'false' ? false : Number(env.TRUST_PROXY || 1),
  dbRoot: (env.FIREBASE_DB_ROOT || 'nusaapi').replace(/^\/|\/$/g, ''),
  ai: {
    baseUrl: (env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey: env.AI_API_KEY || '',
    model: env.AI_MODEL || 'gpt-4o-mini',
  },
  oauth: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID || '',
      clientSecret: env.GOOGLE_CLIENT_SECRET || '',
      enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    },
    github: {
      clientId: env.GITHUB_CLIENT_ID || '',
      clientSecret: env.GITHUB_CLIENT_SECRET || '',
      enabled: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    },
  },
};

/**
 * Paket langganan. `quota` adalah total request yang bisa dipakai selama
 * paket aktif. Free plan tidak memiliki masa aktif, tapi kuotanya tidak
 * di-reset. FreeLimit (demo key) terpisah dan reset harian.
 */
const plans = [
  {
    key: 'free',
    name: 'Free',
    label: 'Calon Builder',
    price: 0,
    quota: app.freePlanQuota,
    days: 0,
    rank: 0,
    badge: 'Gratis',
    icon: 'sprout',
    popular: false,
    customKey: false,
    ticket: false,
    priority: false,
    allEndpoints: false,
    features: ['API key otomatis', 'Kuota 100 request', 'Akses endpoint dasar', 'Dokumentasi lengkap'],
    cta: 'Mulai gratis',
  },
  {
    key: 'starter',
    name: 'Starter',
    label: 'Mulai serius',
    price: 3000,
    quota: 3000,
    days: 30,
    rank: 1,
    badge: 'Pemula',
    icon: 'rocket',
    customKey: false,
    ticket: true,
    priority: false,
    allEndpoints: true,
    features: ['Kuota 3.000 request', 'Aktif 30 hari', 'Akses semua endpoint', 'Support tiket'],
    cta: 'Pilih Starter',
  },
  {
    key: 'plus',
    name: 'Plus',
    label: 'Paling populer',
    price: 5000,
    quota: 5000,
    days: 30,
    rank: 2,
    badge: 'Populer',
    icon: 'sparkles',
    popular: true,
    customKey: true,
    ticket: true,
    priority: false,
    allEndpoints: true,
    features: ['Kuota 5.000 request', 'Aktif 30 hari', 'Custom API key', 'Support tiket'],
    cta: 'Pilih Plus',
  },
  {
    key: 'pro',
    name: 'Pro',
    label: 'Untuk project aktif',
    price: 10000,
    quota: 10000,
    days: 60,
    rank: 3,
    badge: 'Kuat',
    icon: 'zap',
    customKey: true,
    ticket: true,
    priority: false,
    allEndpoints: true,
    features: ['Kuota 10.000 request', 'Aktif 60 hari', 'Custom API key', 'Support tiket'],
    cta: 'Pilih Pro',
  },
  {
    key: 'business',
    name: 'Business',
    label: 'Untuk tim kecil',
    price: 20000,
    quota: 25000,
    days: 60,
    rank: 4,
    badge: 'Tangguh',
    icon: 'briefcase',
    customKey: true,
    ticket: true,
    priority: true,
    allEndpoints: true,
    features: ['Kuota 25.000 request', 'Aktif 60 hari', 'Prioritas layanan', 'Custom API key'],
    cta: 'Pilih Business',
  },
  {
    key: 'elite',
    name: 'Elite',
    label: 'Skala lebih besar',
    price: 30000,
    quota: 30000,
    days: 90,
    rank: 5,
    badge: 'Elite',
    icon: 'star',
    customKey: true,
    ticket: true,
    priority: true,
    allEndpoints: true,
    features: ['Kuota 30.000 request', 'Aktif 90 hari', 'Prioritas layanan', 'Custom API key'],
    cta: 'Pilih Elite',
  },
  {
    key: 'ultimate',
    name: 'Ultimate',
    label: 'Paling hemat',
    price: 99000,
    quota: 100000,
    days: 365,
    rank: 6,
    badge: 'Best value',
    icon: 'crown',
    bestValue: true,
    customKey: true,
    ticket: true,
    priority: true,
    allEndpoints: true,
    features: ['Kuota 100.000 request', 'Aktif 1 tahun', 'Prioritas layanan', 'Custom API key & IP whitelist'],
    cta: 'Pilih Ultimate',
  },
];

const planMap = new Map(plans.map((p) => [p.key, p]));

const categories = [
  {
    key: 'ai',
    name: 'AI',
    icon: 'sparkles',
    color: 'violet',
    description: 'Chat, ringkas, dan analisis sentimen dengan fallback lokal.',
  },
  {
    key: 'downloader',
    name: 'Downloader',
    icon: 'download',
    color: 'cyan',
    description: 'Ambil metadata video dari platform populer secara aman.',
  },
  {
    key: 'tools',
    name: 'Tools',
    icon: 'wrench',
    color: 'amber',
    description: 'Utilitas harian: cuaca, kurs, shortlink, UUID, dan lainnya.',
  },
  {
    key: 'maker',
    name: 'Maker',
    icon: 'wand',
    color: 'pink',
    description: 'Buat QR code dan konten kecil langsung dari request.',
  },
  {
    key: 'network',
    name: 'Network',
    icon: 'globe',
    color: 'green',
    description: 'Informasi IP dan pemeriksaan DNS untuk kebutuhan integrasi.',
  },
  {
    key: 'monitor',
    name: 'Monitoring',
    icon: 'activity',
    color: 'blue',
    description: 'Status layanan, uptime, dan informasi akun API.',
  },
];

const categoryMap = new Map(categories.map((c) => [c.key, c]));

/**
 * Katalog endpoint. `example` dipakai untuk docs/tester, sedangkan
 * implementasi handler ada di services/handlers.js.
 */
const endpoints = [
  {
    id: 'ai-chat',
    category: 'ai',
    name: 'AI Chat',
    method: 'GET',
    path: '/api/ai/chat',
    summary: 'Chat dengan model AI dan dapatkan jawaban singkat.',
    description:
      'Mengirim pertanyaan ke model AI yang dikonfigurasi server. Jika AI_API_KEY belum diisi, endpoint tetap merespons dengan mode demo lokal agar dokumentasi dan integrasi bisa diuji.',
    minPlan: 'free',
    params: [
      { name: 'q', type: 'string', required: true, example: 'Apa itu REST API?', description: 'Pertanyaan yang ingin dikirim.' },
      { name: 'tone', type: 'string', required: false, example: 'santai', description: 'Gaya jawaban: santai, formal, atau singkat.' },
    ],
    response: {
      status: true,
      message: 'success',
      data: {
        answer: 'REST API adalah cara aplikasi saling berkomunikasi lewat HTTP...',
        model: 'demo-local',
        demo: true,
      },
    },
  },
  {
    id: 'ai-summarize',
    category: 'ai',
    name: 'Ringkas Teks',
    method: 'POST',
    path: '/api/ai/summarize',
    summary: 'Ringkas paragraf panjang menjadi beberapa poin.',
    description:
      'Menerima teks dan mengembalikan ringkasan. Bila model AI tersedia, ringkasan dibuat oleh model. Bila tidak, digunakan ringkasan ekstraktif lokal sehingga endpoint tetap berfungsi.',
    minPlan: 'plus',
    params: [
      { name: 'text', type: 'string', required: true, example: 'REST API adalah gaya arsitektur...', description: 'Teks yang akan diringkas (maks. 5.000 karakter).' },
      { name: 'max', type: 'number', required: false, example: '3', description: 'Jumlah poin ringkasan (1-5).' },
    ],
    response: {
      status: true,
      message: 'success',
      data: {
        summary: ['REST API memakai HTTP.', 'Data biasanya dikirim dalam JSON.', 'Endpoint dipisahkan berdasarkan resource.'],
        mode: 'local-extractive',
      },
    },
  },
  {
    id: 'ai-sentiment',
    category: 'ai',
    name: 'Analisis Sentimen',
    method: 'POST',
    path: '/api/ai/sentiment',
    summary: 'Deteksi nada positif, netral, atau negatif dari teks.',
    description: 'Analisis sentimen berbasis leksikon lokal. Cocok untuk filter cepat tanpa mengirim data ke pihak ketiga.',
    minPlan: 'plus',
    params: [
      { name: 'text', type: 'string', required: true, example: 'Pelayanannya cepat dan sangat membantu!', description: 'Teks yang akan dianalisis.' },
    ],
    response: {
      status: true,
      message: 'success',
      data: { sentiment: 'positif', score: 0.82, positive: 3, negative: 0 },
    },
  },
  {
    id: 'youtube-metadata',
    category: 'downloader',
    name: 'YouTube Metadata',
    method: 'GET',
    path: '/api/downloader/youtube',
    summary: 'Ambil judul, channel, dan thumbnail video YouTube.',
    description:
      'Mengambil metadata publik melalui oEmbed. Endpoint ini tidak mengunduh video dan tidak membagikan file berhak cipta. Gunakan untuk preview link, katalog, atau embed.',
    minPlan: 'starter',
    params: [
      { name: 'url', type: 'string', required: true, example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', description: 'URL video YouTube.' },
    ],
    response: {
      status: true,
      message: 'success',
      data: { title: 'Judul video', author: 'Nama channel', thumbnail: 'https://...', provider: 'YouTube' },
    },
  },
  {
    id: 'tiktok-metadata',
    category: 'downloader',
    name: 'TikTok Metadata',
    method: 'GET',
    path: '/api/downloader/tiktok',
    summary: 'Ambil metadata publik dari link TikTok.',
    description: 'Menggunakan oEmbed TikTok untuk mendapatkan judul, author, dan thumbnail. Tidak mengambil file video.',
    minPlan: 'plus',
    params: [
      { name: 'url', type: 'string', required: true, example: 'https://www.tiktok.com/@username/video/123', description: 'URL video TikTok.' },
    ],
    response: {
      status: true,
      message: 'success',
      data: { title: 'Judul', author: 'username', thumbnail: 'https://...', provider: 'TikTok' },
    },
  },
  {
    id: 'qr-code',
    category: 'maker',
    name: 'QR Code',
    method: 'GET',
    path: '/api/maker/qr',
    summary: 'Generate QR code sebagai data URL atau SVG.',
    description: 'Membuat QR code dari teks, URL, atau nomor telepon. Mendukung format PNG data URL (default) dan SVG.',
    minPlan: 'free',
    params: [
      { name: 'text', type: 'string', required: true, example: 'https://nusaapi.local', description: 'Isi QR code (maks. 1.500 karakter).' },
      { name: 'size', type: 'number', required: false, example: '320', description: 'Ukuran gambar 120-1000 px.' },
      { name: 'format', type: 'string', required: false, example: 'png', description: 'png (data URL) atau svg.' },
    ],
    response: {
      status: true,
      message: 'success',
      data: { format: 'png', size: 320, dataUrl: 'data:image/png;base64,...' },
    },
  },
  {
    id: 'quote',
    category: 'maker',
    name: 'Quote Generator',
    method: 'GET',
    path: '/api/maker/quote',
    summary: 'Dapatkan kutipan acak untuk konten atau bot.',
    description: 'Kumpulan kutipan pendek bertema motivasi, teknologi, dan kehidupan. Bisa difilter berdasarkan kategori.',
    minPlan: 'free',
    params: [
      { name: 'category', type: 'string', required: false, example: 'teknologi', description: 'motivasi, teknologi, atau kehidupan.' },
    ],
    response: {
      status: true,
      message: 'success',
      data: { quote: 'Sistem yang baik membuat hal sulit terasa biasa.', author: 'NusaAPI', category: 'teknologi' },
    },
  },
  {
    id: 'shorten',
    category: 'tools',
    name: 'URL Shortener',
    method: 'GET',
    path: '/api/tools/shorten',
    summary: 'Pendekkan URL panjang menjadi link ringkas.',
    description: 'Memakai penyedia shortlink publik (TinyURL dengan fallback is.gd). Hanya URL http/https yang diterima.',
    minPlan: 'free',
    params: [
      { name: 'url', type: 'string', required: true, example: 'https://example.com/halaman-yang-sangat-panjang', description: 'URL yang akan dipendekkan.' },
    ],
    response: {
      status: true,
      message: 'success',
      data: { original: 'https://example.com/...', short: 'https://tinyurl.com/...', provider: 'tinyurl' },
    },
  },
  {
    id: 'weather',
    category: 'tools',
    name: 'Cuaca Kota',
    method: 'GET',
    path: '/api/tools/weather',
    summary: 'Cek cuaca terkini dan prakiraan 3 hari.',
    description: 'Data dari Open-Meteo (tanpa API key). Nama kota dicari otomatis, lalu diambil cuaca terkini dan prakiraan tiga hari.',
    minPlan: 'free',
    params: [
      { name: 'city', type: 'string', required: true, example: 'Jakarta', description: 'Nama kota.' },
    ],
    response: {
      status: true,
      message: 'success',
      data: { city: 'Jakarta', temperature: 31.2, condition: 'Cerah berawan', humidity: 70, forecast: [] },
    },
  },
  {
    id: 'currency',
    category: 'tools',
    name: 'Kurs Mata Uang',
    method: 'GET',
    path: '/api/tools/currency',
    summary: 'Konversi mata uang dengan kurs terbaru.',
    description: 'Mengambil kurs harian dari open.er-api.com, lalu mengonversi jumlah yang diminta.',
    minPlan: 'free',
    params: [
      { name: 'from', type: 'string', required: false, example: 'USD', description: 'Kode mata uang asal (default USD).' },
      { name: 'to', type: 'string', required: false, example: 'IDR', description: 'Kode mata uang tujuan (default IDR).' },
      { name: 'amount', type: 'number', required: false, example: '10', description: 'Jumlah yang dikonversi (default 1).' },
    ],
    response: {
      status: true,
      message: 'success',
      data: { from: 'USD', to: 'IDR', amount: 10, rate: 16250, result: 162500 },
    },
  },
  {
    id: 'uuid',
    category: 'tools',
    name: 'UUID Generator',
    method: 'GET',
    path: '/api/tools/uuid',
    summary: 'Buat UUID v4 acak, satu atau beberapa sekaligus.',
    description: 'Menghasilkan UUID v4 menggunakan crypto bawaan Node.js. Berguna untuk ID transaksi, device ID, atau seed data.',
    minPlan: 'free',
    params: [
      { name: 'count', type: 'number', required: false, example: '3', description: 'Jumlah UUID (1-20, default 1).' },
    ],
    response: {
      status: true,
      message: 'success',
      data: { count: 3, uuids: ['...', '...', '...'] },
    },
  },
  {
    id: 'base64',
    category: 'tools',
    name: 'Base64',
    method: 'GET',
    path: '/api/tools/base64',
    summary: 'Encode atau decode teks Base64.',
    description: 'Konversi teks ke Base64 atau sebaliknya. Mendukung mode encode dan decode.',
    minPlan: 'free',
    params: [
      { name: 'text', type: 'string', required: true, example: 'Halo NusaAPI', description: 'Teks yang diproses.' },
      { name: 'mode', type: 'string', required: false, example: 'encode', description: 'encode atau decode (default encode).' },
    ],
    response: {
      status: true,
      message: 'success',
      data: { mode: 'encode', result: 'SGFsbyBOdXNhQVBJ' },
    },
  },
  {
    id: 'hash',
    category: 'tools',
    name: 'Hash Text',
    method: 'GET',
    path: '/api/tools/hash',
    summary: 'Hitung hash teks dengan MD5, SHA-1, SHA-256, atau SHA-512.',
    description: 'Menghitung checksum teks. Jangan gunakan MD5/SHA-1 untuk menyimpan password.',
    minPlan: 'starter',
    params: [
      { name: 'text', type: 'string', required: true, example: 'rahasia', description: 'Teks yang di-hash.' },
      { name: 'algo', type: 'string', required: false, example: 'sha256', description: 'md5, sha1, sha256, atau sha512.' },
    ],
    response: {
      status: true,
      message: 'success',
      data: { algo: 'sha256', hash: '...' },
    },
  },
  {
    id: 'dns',
    category: 'network',
    name: 'DNS Lookup',
    method: 'GET',
    path: '/api/network/dns',
    summary: 'Periksa record DNS sebuah domain.',
    description: 'Query record A, AAAA, MX, TXT, CNAME, atau NS langsung dari resolver server.',
    minPlan: 'starter',
    params: [
      { name: 'domain', type: 'string', required: true, example: 'example.com', description: 'Domain yang diperiksa.' },
      { name: 'type', type: 'string', required: false, example: 'A', description: 'A, AAAA, MX, TXT, CNAME, atau NS.' },
    ],
    response: {
      status: true,
      message: 'success',
      data: { domain: 'example.com', type: 'A', records: ['93.184.216.34'] },
    },
  },
  {
    id: 'ip',
    category: 'network',
    name: 'IP Info',
    method: 'GET',
    path: '/api/network/ip',
    summary: 'Lihat alamat IP publik dan header request kamu.',
    description: 'Mengembalikan alamat IP yang terlihat oleh server beserta beberapa header koneksi. Berguna untuk debug proxy.',
    minPlan: 'free',
    params: [],
    response: {
      status: true,
      message: 'success',
      data: { ip: '103.x.x.x', country: 'ID', userAgent: 'curl/8.0', protocol: 'https' },
    },
  },
  {
    id: 'status',
    category: 'monitor',
    name: 'Status Layanan',
    method: 'GET',
    path: '/api/status',
    summary: 'Cek status API, uptime, dan versi layanan.',
    description: 'Endpoint publik tanpa API key. Cocok untuk health check uptime monitor.',
    minPlan: 'free',
    public: true,
    params: [],
    response: {
      status: true,
      message: 'success',
      data: { service: 'NusaAPI', version: '1.0.0', uptime: 1234, time: '2026-01-01T00:00:00.000Z' },
    },
  },
  {
    id: 'me',
    category: 'monitor',
    name: 'Akun Saya',
    method: 'GET',
    path: '/api/me',
    summary: 'Lihat plan, kuota, dan pemakaian akun API kamu.',
    description: 'Mengembalikan ringkasan akun yang terkait dengan API key: plan, sisa kuota, tanggal expired, dan request hari ini.',
    minPlan: 'free',
    params: [],
    response: {
      status: true,
      message: 'success',
      data: { username: 'demo', plan: 'plus', quota: { limit: 5000, used: 120, remaining: 4880 }, expiresAt: null },
    },
  },
];

const allEndpointIds = new Set(endpoints.map((e) => e.id));
for (const endpoint of endpoints) {
  if (!categoryMap.has(endpoint.category)) {
    throw new Error(`Kategori endpoint tidak dikenal: ${endpoint.category}`);
  }
  endpoint.categoryName = categoryMap.get(endpoint.category).name;
  endpoint.auth = endpoint.public !== true;
}

function getPlan(key) {
  return planMap.get(String(key || 'free').toLowerCase()) || planMap.get('free');
}

function planRank(key) {
  return getPlan(key).rank;
}

function canAccessPlan(userPlan, requiredPlan) {
  return planRank(userPlan) >= planRank(requiredPlan);
}

function formatIDR(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat('id-ID').format(Number(value) || 0);
}

function formatDate(value, withTime = false) {
  if (!value) return '-';
  const date = new Date(Number(value) || value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Asia/Makassar',
  }).format(date);
}

function formatDateTime(value) {
  return formatDate(value, true) + ' WITA';
}

function timeAgo(value) {
  const ts = Number(value) || 0;
  if (!ts) return '-';
  const diff = Math.max(0, Date.now() - ts);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds} detik lalu`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  return formatDate(ts);
}

function remainingQuota(user) {
  const limit = Number(user?.quotaLimit || 0);
  const used = Number(user?.quotaUsed || 0);
  return Math.max(0, limit - used);
}

function isExpired(user) {
  return Boolean(user?.expiresAt && Number(user.expiresAt) < Date.now());
}

function planActive(user) {
  return Boolean(user && user.isActive !== false && !isExpired(user));
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const number = bytes / Math.pow(1024, index);
  return `${number.toFixed(number >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}j`;
  if (hours > 0) return `${hours}j ${minutes}m`;
  return `${minutes}m`;
}

function initials(name, fallback = 'NA') {
  const clean = String(name || '')
    .replace(/[^\p{L}\p{N}\s._-]/gu, '')
    .trim();
  if (!clean) return fallback;
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!domain) return email || '-';
  if (name.length <= 2) return `${name[0] || ''}***@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function randomId(prefix = '') {
  return prefix + crypto.randomBytes(8).toString('hex');
}

function buildWhatsAppLink(message) {
  return `https://wa.me/${app.waAdmin}?text=${encodeURIComponent(message)}`;
}

function buildOrderMessage({ user, plan, type = 'new' }) {
  const lines = [
    `Halo Admin ${app.name}, saya mau ${type === 'renew' ? 'memperpanjang' : 'membeli'} paket API.`,
    '',
    `📦 Paket: ${plan.name}`,
    `💰 Harga: ${formatIDR(plan.price)}`,
    `⏳ Durasi: ${plan.days ? plan.days + ' hari' : 'tanpa masa aktif'}`,
    `🎟️ Kuota: ${formatNumber(plan.quota)} request`,
    '',
    `👤 Username: ${user.username}`,
    `📧 Email: ${user.email}`,
    '',
    'Mohon diproses ya, terima kasih! 🙏',
  ];
  return lines.join('\n');
}

const endpointCount = endpoints.length;
const publicPlans = plans.map((p) => ({ ...p }));
const featuredPlans = plans.filter((p) => ['free', 'plus', 'pro', 'ultimate'].includes(p.key));

module.exports = {
  app,
  plans,
  planMap,
  publicPlans,
  featuredPlans,
  getPlan,
  planRank,
  canAccessPlan,
  categories,
  categoryMap,
  endpoints,
  allEndpointIds,
  endpointCount,
  formatIDR,
  formatNumber,
  formatDate,
  formatDateTime,
  formatBytes,
  formatUptime,
  timeAgo,
  remainingQuota,
  isExpired,
  planActive,
  initials,
  maskEmail,
  slugify,
  randomId,
  buildWhatsAppLink,
  buildOrderMessage,
};
