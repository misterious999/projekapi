# NusaAPI

**Satu API untuk semua project.** Platform REST API publik dengan dokumentasi, API key, kuota, pembayaran manual, monitoring real-time, dashboard pengguna, dan admin panel. Dibangun dengan Express, EJS, dan Firebase Realtime Database.

> Branding, teks, dan aset di project ini original untuk NusaAPI. Jangan menyalin logo atau aset dari layanan lain.

## Fitur

- Landing page, katalog endpoint, dokumentasi dengan contoh kode, dan API tester langsung di browser.
- Registrasi/login email + password (scrypt), sesi Firebase, CSRF, rate limit login.
- Login Google/GitHub opsional.
- API key otomatis untuk akun baru, reveal/copy, rotasi, custom key untuk paket tertentu, dan whitelist IP.
- Kuota total per paket, masa aktif, serta demo key `FreeLimit` 200 request/hari (reset 00.00 WITA).
- Rate limit 120 request/menit per akun dan 20 request/menit per IP untuk FreeLimit.
- Dashboard: ringkasan, tren pemakaian, API & kuota, paket/transaksi, redeem code, referral, tiket, testimoni, profil.
- Admin: pengguna, transaksi, redeem, tiket, testimoni, aplikasi/download, pesan kontak, log, dan pengaturan.
- Monitoring CPU/RAM/disk, statistik request, endpoint terpopuler, pengguna teraktif, dan live feed.
- Respons API konsisten, request ID, header kuota, dokumentasi error.
- Download resmi: koleksi Postman dan CLI Node.js tanpa dependency.

## Stack

- Node.js 18.18+ (disarankan 22)
- Express 5 + EJS 5
- Firebase Admin SDK (Realtime Database + sesi)
- CSS dan JavaScript vanilla, Lucide icons, Google Fonts
- `qrcode` untuk endpoint QR

## Struktur project

```text
app.js                 Entry point, middleware keamanan, route mounting, seed, shutdown
config/app.js          Brand, plans, endpoint catalog, helper format
config/firebase.js     Inisialisasi Firebase Admin
lib/                   Auth, session store, data store, usage/quota, security, HTTP helper
routes/                public, auth, dashboard, docs, monitor, api, admin
services/handlers.js   Implementasi handler setiap endpoint API
views/                 EJS: publik, dashboard, admin, partials
public/css/style.css   Design system dan responsive layout
public/js/             main, home, docs, monitor, dashboard, admin
public/downloads/      Postman collection dan CLI
scripts/check.js       Pemeriksaan sintaks JavaScript
```

## Menjalankan lokal

1. Pastikan Node.js sudah terpasang.

```bash
node -v
npm -v
```

2. Install dependency.

```bash
npm install --no-bin-links
```

`--no-bin-links` dipakai jika lingkungan (misalnya penyimpanan tertentu) gagal membuat symlink di `node_modules/.bin`.

3. Siapkan Firebase:

- Buat project Firebase dan Realtime Database.
- Buat service account, unduh JSON, simpan sebagai `serviceAccountKey.json` di root project.
- Jangan letakkan file tersebut di `public/`.
- Terapkan aturan database dari `firebase.rules.json`. Admin SDK tetap bisa mengakses database meskipun rules deny-all.

4. Salin environment dan sesuaikan.

```bash
cp .env.example .env
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # KEY_ENCRYPTION_SECRET
```

Isi minimal: `FIREBASE_DATABASE_URL`, `SESSION_SECRET`, `KEY_ENCRYPTION_SECRET`, `APP_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, dan `WA_ADMIN`.

5. Jalankan.

```bash
npm start
# atau
npm run dev
```

Buka `http://localhost:3000`. Admin awal dibuat otomatis saat server pertama kali berjalan:

- Email: nilai `ADMIN_EMAIL` di `.env`
- Password: nilai `ADMIN_PASSWORD` di `.env`

Password admin diambil dari `ADMIN_PASSWORD` di `.env` lokal dan tidak disimpan di repository. **Ganti sebelum production** dan jangan bagikan kredensial admin.

6. Pemeriksaan sintaks.

```bash
npm run check
```

## Environment penting

| Variable | Fungsi |
| --- | --- |
| `APP_URL` | URL publik tanpa trailing slash, dipakai di docs, canonical, dan callback OAuth. |
| `FIREBASE_DATABASE_URL` | URL Realtime Database. |
| `FIREBASE_SERVICE_ACCOUNT` | Path service account. Default `./serviceAccountKey.json`. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Alternatif: isi JSON service account satu baris. |
| `FIREBASE_DB_ROOT` | Namespace data. Default `nusaapi`, mencegah bentrok dengan data aplikasi lain. |
| `SESSION_SECRET` | Secret cookie sesi. Wajib diganti. |
| `KEY_ENCRYPTION_SECRET` | Enkripsi API key di database. Jangan diubah setelah ada key tanpa rencana migrasi. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Seed admin awal. Password tidak menimpa akun yang sudah ada. |
| `FREE_LIMIT_DAILY` | Batas harian FreeLimit. Maksimal 200 di kode. |
| `FREE_PLAN_QUOTA` | Kuota awal akun Free. |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | Endpoint AI. Tanpa key, AI memakai fallback demo lokal. |
| `GOOGLE_CLIENT_ID/SECRET` | Mengaktifkan login Google. |
| `GITHUB_CLIENT_ID/SECRET` | Mengaktifkan login GitHub. |

Semua daftar variabel ada di `.env.example`.

## Autentikasi API

Gunakan salah satu header:

```http
Authorization: Bearer nusa_xxxxxxxxxxxxxxxxx
```

```http
X-API-Key: nusa_xxxxxxxxxxxxxxxxx
```

Demo key:

```http
Authorization: Bearer FreeLimit
```

Tanpa akun, `FreeLimit` mendapat 200 request/hari dan 20 request/menit per IP. API key akun mendapat rate limit 120 request/menit.

Contoh:

```bash
curl "http://localhost:3000/api/tools/uuid?count=2" \
  -H "Authorization: Bearer FreeLimit"
```

Format respons:

```json
{
  "status": true,
  "code": 200,
  "message": "success",
  "data": {},
  "meta": {
    "requestId": "req_...",
    "latencyMs": 42,
    "quota": { "limit": 5000, "remaining": 4870 }
  }
}
```

Status yang umum: `400` parameter invalid, `401` key hilang/invalid, `403` plan/expiry/IP ditolak, `404` tidak ditemukan, `429` rate limit/kuota habis, `500` error server.

## Endpoint

| Kategori | Method dan path | Plan minimum |
| --- | --- | --- |
| AI | `GET /api/ai/chat` | Free |
| AI | `POST /api/ai/summarize` | Plus |
| AI | `POST /api/ai/sentiment` | Plus |
| Downloader | `GET /api/downloader/youtube` | Starter |
| Downloader | `GET /api/downloader/tiktok` | Plus |
| Tools | `GET /api/tools/shorten` | Free |
| Tools | `GET /api/tools/weather` | Free |
| Tools | `GET /api/tools/currency` | Free |
| Tools | `GET /api/tools/uuid` | Free |
| Tools | `GET /api/tools/base64` | Free |
| Tools | `GET /api/tools/hash` | Starter |
| Maker | `GET /api/maker/qr` | Free |
| Maker | `GET /api/maker/quote` | Free |
| Network | `GET /api/network/dns` | Starter |
| Network | `GET /api/network/ip` | Free |
| Monitoring | `GET /api/status` | Publik |
| Monitoring | `GET /api/me` | Free |

Dokumentasi parameter, contoh cURL/JavaScript/Python/PHP/Node, dan tester tersedia di `/docs`.

## Paket dan kuota

- Paket: Free, Starter, Plus, Pro, Business, Elite, Ultimate.
- Paket berbayar memiliki masa aktif dan kuota **total**. Kuota tidak reset otomatis setiap bulan/hari.
- Free tidak memiliki masa aktif, tetapi kuota awal tidak reset.
- Perpanjangan menambah masa aktif dari tanggal berakhir paling akhir dan menambah kuota.
- `FreeLimit` terpisah dari kuota akun dan reset harian pukul 00.00 WITA.
- Pembayaran manual: order membuat transaksi `pending`, membuka WhatsApp admin, lalu admin menyetujui di panel admin.
- Redeem code dapat menambah kuota, hari, atau mengaktifkan plan. Pengguna menukarkannya di **Dashboard → Paket & Transaksi**. Satu akun hanya bisa memakai kode yang sama sekali.

## Admin

Login dengan akun admin, lalu buka `/admin`.

- Transaksi: setujui/tolak order.
- Pengguna: ubah plan, kuota, masa aktif, role, status, dan hapus akun.
- Redeem: buat kode quota/days/plan, batasi pemakaian dan tanggal berlaku.
- Tiket: balas dan tutup tiket.
- Testimoni: sembunyikan/tampilkan atau hapus.
- Aplikasi: tambah file download dengan URL internal/eksternal.
- Pesan kontak: tandai dibaca, balas melalui email, hapus.
- Pengaturan: WhatsApp admin, announcement, free limit, pendaftaran, dan informasi publik.
- Log: audit aksi admin.

## Deployment

### PM2

```bash
npm ci --omit=dev --no-bin-links
NODE_ENV=production pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Pastikan `.env` berisi `APP_URL=https://domain-kamu`, `NODE_ENV=production`, dan `TRUST_PROXY=1` jika di belakang reverse proxy. Gunakan HTTPS agar cookie `secure` bekerja.

### Docker

```bash
docker build -t nusaapi .
docker run -d --name nusaapi \
  -p 3000:3000 \
  --env-file .env \
  -v "$PWD/serviceAccountKey.json:/run/secrets/serviceAccountKey.json:ro" \
  -e FIREBASE_SERVICE_ACCOUNT=/run/secrets/serviceAccountKey.json \
  --restart unless-stopped \
  nusaapi
```

Service account tidak masuk image karena `.dockerignore`. Database rules ada di `firebase.rules.json`.

### Nginx

Contoh reverse proxy ada di `deploy/nginx.conf.example`. Arahkan ke `127.0.0.1:3000` dan teruskan header `Host`, `X-Real-IP`, `X-Forwarded-For`, serta `X-Forwarded-Proto`.

Health check: `GET /healthz`.

## Keamanan

- Password di-hash dengan scrypt.
- API key disimpan terenkripsi dan ditampilkan dalam bentuk mask; reveal memerlukan sesi login.
- CSRF token untuk semua form non-API.
- Session cookie `httpOnly`, `sameSite=lax`, dan `secure` di production.
- Security header dan CSP di `app.js`.
- Firebase client rules sebaiknya deny-all; akses data hanya lewat server.
- Jangan commit `.env` atau `serviceAccountKey.json`.
- Ganti `SESSION_SECRET`, `KEY_ENCRYPTION_SECRET`, dan password admin sebelum production.
- Rotasi API key jika bocor dari **Dashboard → API & Kuota**.

## Download resmi

- `/downloads/nusaapi-postman.json` — import ke Postman/Insomnia, ubah `baseUrl` dan `apiKey`.
- `/downloads/nusaapi-cli.js` — Node.js 18+:

```bash
NUSAAPI_KEY=FreeLimit node public/downloads/nusaapi-cli.js /api/status
node public/downloads/nusaapi-cli.js /api/tools/weather --query city=Jakarta
node public/downloads/nusaapi-cli.js /api/ai/chat --key nusa_xxx --query q="Apa itu API?"
```

## Troubleshooting

- **Gagal memuat service account**: pastikan `serviceAccountKey.json` ada di root atau set `FIREBASE_SERVICE_ACCOUNT_JSON`.
- **Login loop / sesi hilang**: cek `SESSION_SECRET`, `APP_URL`, dan konfigurasi cookie/HTTPS.
- **Icons tidak tampil**: Lucide dimuat dari `unpkg.com`; CSP di `app.js` mengizinkan domain tersebut.
- **API key tidak bisa dibuka**: `KEY_ENCRYPTION_SECRET` harus sama dengan saat key dibuat.
- **Data lama tidak terlihat**: cek `FIREBASE_DB_ROOT`. Aplikasi ini memakai namespace `nusaapi`; data lama Panel Shop tetap berada di root berbeda dan tidak disentuh.
- **`npm install` gagal symlink**: gunakan `npm install --no-bin-links`.

## Lisensi

UNLICENSED — hak dan branding NusaAPI. Jangan mendistribusikan ulang tanpa izin.
