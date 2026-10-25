/* ZeroixApi — user dashboard */
(function () {
  'use strict';

  var $ = function (selector, scope) {
    return (scope || document).querySelector(selector);
  };
  var $$ = function (selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  };
  var number = new Intl.NumberFormat('id-ID');
  var compact = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });

  var cachedKey = '';

  function readJson(id) {
    var node = document.getElementById(id);
    if (!node) return null;
    try {
      return JSON.parse(node.textContent || 'null');
    } catch (error) {
      return null;
    }
  }

  function refreshIcons() {
    if (window.Zeroix) window.Zeroix.refreshIcons();
  }

  function shortDate(value) {
    var parts = String(value || '').split('-');
    if (parts.length === 3) return parts[2] + '/' + parts[1];
    return String(value || '');
  }

  function drawAreaChart(canvas, series, options) {
    if (!canvas || !Array.isArray(series) || !series.length) return;
    var settings = options || {};
    var height = settings.height || 220;
    var parent = canvas.parentElement;
    var width = Math.max(260, parent ? parent.clientWidth : 600);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = '100%';
    canvas.style.height = height + 'px';

    var context = canvas.getContext('2d');
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    var pad = { top: 13, right: 11, bottom: 25, left: 34 };
    var chartWidth = width - pad.left - pad.right;
    var chartHeight = height - pad.top - pad.bottom;
    var values = series.map(function (item) { return Number(item.requests || 0); });
    var errors = series.map(function (item) { return Number(item.errors || 0); });
    var max = Math.max.apply(null, values.concat([1]));
    max = Math.max(4, Math.ceil(max / 4) * 4);
    var ticks = 4;

    context.font = '10px "Plus Jakarta Sans", system-ui, sans-serif';
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    for (var i = 0; i <= ticks; i += 1) {
      var y = pad.top + (chartHeight / ticks) * i;
      context.strokeStyle = 'rgba(151, 182, 227, 0.09)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(pad.left, Math.round(y) + 0.5);
      context.lineTo(pad.left + chartWidth, Math.round(y) + 0.5);
      context.stroke();
      context.fillStyle = 'rgba(145, 164, 194, 0.7)';
      context.fillText(compact.format(max - (max / ticks) * i), pad.left - 6, y);
    }

    function pointX(index) {
      if (series.length === 1) return pad.left + chartWidth / 2;
      return pad.left + (chartWidth / (series.length - 1)) * index;
    }
    function pointY(value) {
      return pad.top + chartHeight - (Number(value || 0) / max) * chartHeight;
    }

    var area = context.createLinearGradient(0, pad.top, 0, pad.top + chartHeight);
    area.addColorStop(0, 'rgba(53, 230, 255, 0.26)');
    area.addColorStop(0.72, 'rgba(53, 230, 255, 0.035)');
    area.addColorStop(1, 'rgba(53, 230, 255, 0)');
    context.beginPath();
    series.forEach(function (item, index) {
      var x = pointX(index);
      var y = pointY(item.requests);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.lineTo(pointX(series.length - 1), pad.top + chartHeight);
    context.lineTo(pointX(0), pad.top + chartHeight);
    context.closePath();
    context.fillStyle = area;
    context.fill();

    var stroke = context.createLinearGradient(pad.left, 0, pad.left + chartWidth, 0);
    stroke.addColorStop(0, 'rgba(53, 230, 255, 0.7)');
    stroke.addColorStop(0.55, '#35e6ff');
    stroke.addColorStop(1, '#6aa7ff');
    context.beginPath();
    series.forEach(function (item, index) {
      var x = pointX(index);
      var y = pointY(item.requests);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = stroke;
    context.lineWidth = 2;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.stroke();

    var hasErrors = errors.some(function (value) { return Number(value) > 0; });
    if (hasErrors) {
      context.beginPath();
      series.forEach(function (item, index) {
        var x = pointX(index);
        var y = pointY(item.errors);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = 'rgba(167, 139, 250, 0.85)';
      context.lineWidth = 1.5;
      context.stroke();
    }

    var step = width < 430 ? 4 : width < 680 ? 2 : 1;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillStyle = 'rgba(145, 164, 194, 0.68)';
    series.forEach(function (item, index) {
      if (index % step !== 0 && index !== series.length - 1) return;
      context.fillText(shortDate(item.date), pointX(index), pad.top + chartHeight + 8);
    });
  }

  function initCharts() {
    var overview = readJson('overviewUsage');
    if (overview) drawAreaChart($('#usageChart'), overview, { height: 220 });

    var apiSeries = readJson('apiUsageSeries');
    if (apiSeries) drawAreaChart($('#apiUsageChart'), apiSeries, { height: 160 });
  }

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  async function fetchKey() {
    if (cachedKey) return cachedKey;
    var response = await fetch('/dashboard/api/reveal', {
      method: 'POST',
      headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken() },
      credentials: 'same-origin'
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok || !data.key) {
      throw new Error(data.message || 'API key tidak dapat diambil.');
    }
    cachedKey = data.key;
    return cachedKey;
  }

  function bindKeyTools() {
    var code = $('#apiKeyMasked');
    var reveal = $('#revealKeyBtn');
    var copy = $('#copyKeyBtn');
    if (!code) return;

    function showMasked() {
      code.textContent = code.getAttribute('data-masked') || '••••••••';
      if (reveal) {
        reveal.innerHTML = '<i data-lucide="eye"></i> Reveal';
        reveal.setAttribute('aria-label', 'Tampilkan API key');
      }
      refreshIcons();
    }

    if (reveal) {
      reveal.addEventListener('click', async function () {
        if (code.textContent !== (code.getAttribute('data-masked') || '••••••••')) {
          showMasked();
          return;
        }
        reveal.disabled = true;
        var original = reveal.innerHTML;
        reveal.innerHTML = '<i data-lucide="loader-circle"></i> Memuat';
        refreshIcons();
        try {
          var key = await fetchKey();
          code.textContent = key;
          reveal.innerHTML = '<i data-lucide="eye-off"></i> Sembunyikan';
          reveal.setAttribute('aria-label', 'Sembunyikan API key');
        } catch (error) {
          reveal.innerHTML = original;
          if (window.Zeroix) window.Zeroix.showToast(error.message, 'error');
        } finally {
          reveal.disabled = false;
          refreshIcons();
        }
      });
    }

    if (copy) {
      copy.addEventListener('click', async function () {
        copy.disabled = true;
        var original = copy.innerHTML;
        copy.innerHTML = '<i data-lucide="loader-circle"></i> Copy';
        refreshIcons();
        try {
          var key = await fetchKey();
          var ok = window.Zeroix ? await window.Zeroix.copyText(key) : false;
          if (!ok) throw new Error('Browser menolak akses clipboard.');
          copy.innerHTML = '<i data-lucide="check"></i> Tersalin';
          if (window.Zeroix) window.Zeroix.showToast('API key disalin. Simpan di tempat aman.', 'success');
          setTimeout(function () {
            copy.innerHTML = original;
            refreshIcons();
          }, 1800);
        } catch (error) {
          copy.innerHTML = original;
          if (window.Zeroix) window.Zeroix.showToast(error.message, 'error');
        } finally {
          copy.disabled = false;
          refreshIcons();
        }
      });
    }
  }

  function bindSidebar() {
    var sidebar = $('#dashSidebar');
    var button = $('#dashMenuBtn');
    var backdrop = $('#dashBackdrop');
    if (!sidebar || !button) return;

    function close() {
      sidebar.classList.remove('is-open');
      if (backdrop) backdrop.classList.remove('is-visible');
      document.body.style.removeProperty('overflow');
    }
    function open() {
      sidebar.classList.add('is-open');
      if (backdrop) backdrop.classList.add('is-visible');
      document.body.style.overflow = 'hidden';
    }

    button.addEventListener('click', function () {
      if (sidebar.classList.contains('is-open')) close();
      else open();
    });
    if (backdrop) backdrop.addEventListener('click', close);
    sidebar.addEventListener('click', function (event) {
      if (event.target.closest('a')) close();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') close();
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 1020) close();
    });
  }

  function bindTicketPanel() {
    var panel = $('#newTicketPanel');
    if (!panel) return;
    $$('[data-toggle-new-ticket]').forEach(function (button) {
      button.addEventListener('click', function () {
        var shouldOpen = panel.hidden;
        panel.hidden = !shouldOpen;
        if (shouldOpen) {
          panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
          var subject = panel.querySelector('input[name="subject"]');
          if (subject) setTimeout(function () { subject.focus(); }, 300);
        }
      });
    });
  }

  function bindRating() {
    $$('.rating-input label').forEach(function (label) {
      label.addEventListener('mouseenter', function () {
        var labels = $$('.rating-input label');
        var index = labels.indexOf(label);
        labels.forEach(function (item, position) {
          item.style.color = position >= index ? 'var(--amber)' : '';
        });
      });
    });
    $$('.rating-input').forEach(function (wrapper) {
      wrapper.addEventListener('mouseleave', function () {
        $$('label', wrapper).forEach(function (label) {
          label.style.color = '';
        });
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindSidebar();
    bindKeyTools();
    bindTicketPanel();
    bindRating();
    requestAnimationFrame(initCharts);

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(initCharts, 180);
    });
  });
})();
