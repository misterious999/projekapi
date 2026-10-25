'use strict';

const express = require('express');
const { app, endpoints } = require('../config/app');
const { getMonitorData } = require('../lib/usage');
const store = require('../lib/store');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const data = await getMonitorData({ force: req.query.refresh === '1' });
    const settings = await store.getSettings();
    res.render('monitor', {
      title: `Monitor Layanan — ${app.name}`,
      description: 'Statistik request, latency, success rate, resource server, dan aktivitas API secara live.',
      bodyClass: 'page-monitor',
      data,
      settings,
      endpoints,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/data', async (req, res, next) => {
  try {
    const data = await getMonitorData({ force: req.query.refresh === '1' });
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
