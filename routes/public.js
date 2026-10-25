'use strict';

const express = require('express');
const {
  app,
  plans,
  featuredPlans,
  categories,
  endpoints,
  endpointCount,
} = require('../config/app');
const store = require('../lib/store');
const { getLandingStats, getFreeLimitState } = require('../lib/usage');
const { requireAuth, setFlash } = require('../lib/auth');
const { clientIp } = require('../lib/security');

const router = express.Router();

function pageMeta(overrides = {}) {
  return {
    title: app.name + ' — ' + app.tagline,
    description: app.description,
    ...overrides,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const [stats, settings, apps, testimonials] = await Promise.all([
      getLandingStats(),
      store.getSettings(),
      store.getApps(true),
      store.getTestimonials(9),
    ]);
    let myTestimonial = null;
    if (req.user) myTestimonial = await store.getTestimonial(req.user.uid);
    const freeLimit = stats.freeLimit || (await getFreeLimitState(settings.freeLimitDaily));

    res.render('home', {
      ...pageMeta(),
      bodyClass: 'page-home',
      stats,
      settings,
      apps,
      testimonials,
      myTestimonial,
      freeLimit,
      plans,
      featuredPlans,
      categories,
      endpoints,
      endpointCount,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/pricing', async (req, res, next) => {
  try {
    const settings = await store.getSettings();
    res.render('pricing', {
      ...pageMeta({ title: `Harga & Paket — ${app.name}` }),
      bodyClass: 'page-pricing',
      plans,
      settings,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/faq', async (req, res, next) => {
  const settings = await store.getSettings();
  res.render('faq', {
    ...pageMeta({ title: `FAQ — ${app.name}` }),
    bodyClass: 'page-faq',
    settings,
  });
});

router.get('/download', async (req, res, next) => {
  try {
    const apps = await store.getApps(true);
    const settings = await store.getSettings();
    res.render('download', {
      ...pageMeta({ title: `Download Aplikasi — ${app.name}` }),
      bodyClass: 'page-download',
      apps,
      settings,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/terms', async (req, res) => {
  const settings = await store.getSettings();
  res.render('legal', {
    ...pageMeta({ title: `Syarat & Ketentuan — ${app.name}` }),
    bodyClass: 'page-legal',
    kind: 'terms',
    settings,
  });
});

router.get('/privacy', async (req, res) => {
  const settings = await store.getSettings();
  res.render('legal', {
    ...pageMeta({ title: `Kebijakan Privasi — ${app.name}` }),
    bodyClass: 'page-legal',
    kind: 'privacy',
    settings,
  });
});

router.get('/contributor', async (req, res) => {
  const settings = await store.getSettings();
  res.render('contributor', {
    ...pageMeta({ title: `Kontributor — ${app.name}` }),
    bodyClass: 'page-contributor',
    settings,
  });
});

router.get('/contact', async (req, res) => {
  const settings = await store.getSettings();
  res.render('contact', {
    ...pageMeta({ title: `Kontak — ${app.name}` }),
    bodyClass: 'page-contact',
    settings,
    form: {},
  });
});

router.post('/contact', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 80);
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 160);
    const subject = String(req.body.subject || '').trim().slice(0, 160);
    const message = String(req.body.message || '').trim().slice(0, 4000);

    if (!name || !email || !subject || message.length < 10) {
      setFlash(req, 'error', 'Lengkapi nama, email, subjek, dan pesan minimal 10 karakter.');
      return res.redirect('/contact');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFlash(req, 'error', 'Format email tidak valid.');
      return res.redirect('/contact');
    }
    await store.push('messages', {
      name,
      email,
      subject,
      message,
      status: 'new',
      ip: clientIp(req),
      createdAt: Date.now(),
    });
    setFlash(req, 'success', 'Pesan kamu sudah terkirim. Admin akan membalas lewat email atau WhatsApp.');
    return res.redirect('/contact');
  } catch (error) {
    return next(error);
  }
});

router.post('/testimonials', requireAuth, async (req, res, next) => {
  try {
    const rating = Math.max(1, Math.min(5, Number(req.body.rating) || 5));
    const content = String(req.body.content || '').trim();
    if (content.length < 10) {
      setFlash(req, 'error', 'Testimoni minimal 10 karakter.');
      return res.redirect('/#testimonials');
    }
    await store.upsertTestimonial(req.user, { rating, content });
    setFlash(req, 'success', 'Terima kasih! Testimoni kamu sudah diperbarui.');
    return res.redirect('/#testimonials');
  } catch (error) {
    return next(error);
  }
});

router.get('/healthz', (req, res) => {
  res.json({
    status: 'ok',
    service: app.name,
    version: app.version,
    uptime: Math.floor(process.uptime()),
    time: new Date().toISOString(),
  });
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /dashboard\nDisallow: /admin\n\nSitemap: ${app.url}/sitemap.xml\n`
  );
});

router.get('/sitemap.xml', async (req, res) => {
  const urls = ['/', '/docs', '/pricing', '/monitor', '/download', '/faq', '/contact', '/terms', '/privacy', '/contributor'];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((path) => `  <url><loc>${app.url}${path}</loc><changefreq>weekly</changefreq></url>`)
    .join('\n')}\n</urlset>`;
  res.type('application/xml').send(body);
});

module.exports = router;
