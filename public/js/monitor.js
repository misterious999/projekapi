/* ZeroixApi — live monitoring dashboard */
(function () {
  'use strict';

  var $ = function (selector) {
    return document.querySelector(selector);
  };
  var number = new Intl.NumberFormat('id-ID');
  var compact = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });

  var canvas = $('#monitorChart');
  var state = { data: null, timer: null, drawing: false };

  function readInitialData() {
    var node = $('#monitorData');
    if (!node) return null;
    try {
      return JSON.parse(node.textContent || 'null');
    } catch (error) {
      return null;
    }
  }

  function formatBytes(bytes) {
    var value = Number(bytes || 0);
    if (!value) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    var amount = value / Math.pow(1024, index);
    return amount.toLocaleString('id-ID', { maximumFractionDigits: index === 0 ? 0 : 1 }) + ' ' + units[index];
  }

  function formatUptime(seconds) {
    var total = Math.max(0, Number(seconds || 0));
    var days = Math.floor(total / 86400);
    var hours = Math.floor((total % 86400) / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    if (days > 0) return days + 'h ' + hours + 'j';
    if (hours > 0) return hours + 'j ' + minutes + 'm';
    return minutes + 'm';
  }

  function timeAgo(timestamp) {
    var diff = Math.max(0, Date.now() - Number(timestamp || 0));
    var seconds = Math.floor(diff / 1000);
    if (seconds < 5) return 'baru saja';
    if (seconds < 60) return seconds + ' dtk lalu';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + ' mnt lalu';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + ' jam lalu';
    var days = Math.floor(hours / 24);
    return days + ' hari lalu';
  }

  function dateTime(timestamp) {
    try {
      return new Intl.DateTimeFormat('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      }).format(new Date(Number(timestamp))) + ' WITA';
    } catch (error) {
      return '-';
    }
  }

  function shortDate(value) {
    try {
      var parts = String(value).split('-');
      if (parts.length === 3) return parts[2] + '/' + parts[1];
      return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short' }).format(new Date(value));
    } catch (error) {
      return value;
    }
  }

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function setWidth(id, value) {
    var node = document.getElementById(id);
    if (node) node.style.width = Math.max(0, Math.min(100, Number(value || 0))) + '%';
  }

  function roundedRect(context, x, y, width, height, radius) {
    var r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function drawChart(daily) {
    if (!canvas || !Array.isArray(daily) || !daily.length) return;
    var parent = canvas.parentElement;
    var cssWidth = Math.max(280, parent ? parent.clientWidth : 640);
    var cssHeight = 240;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = '100%';
    canvas.style.height = cssHeight + 'px';

    var context = canvas.getContext('2d');
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);

    var pad = { top: 14, right: 12, bottom: 27, left: 36 };
    var chartWidth = cssWidth - pad.left - pad.right;
    var chartHeight = cssHeight - pad.top - pad.bottom;
    var values = daily.map(function (item) { return Number(item.requests || 0); });
    var errors = daily.map(function (item) { return Number(item.errors || 0); });
    var max = Math.max.apply(null, values.concat([1]));
    max = Math.max(4, Math.ceil(max / 4) * 4);
    var ticks = 4;

    context.font = '10px "Plus Jakarta Sans", system-ui, sans-serif';
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    for (var i = 0; i <= ticks; i += 1) {
      var y = pad.top + (chartHeight / ticks) * i;
      var label = max - (max / ticks) * i;
      context.strokeStyle = 'rgba(151, 182, 227, 0.09)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(pad.left, Math.round(y) + 0.5);
      context.lineTo(pad.left + chartWidth, Math.round(y) + 0.5);
      context.stroke();
      context.fillStyle = 'rgba(145, 164, 194, 0.72)';
      context.fillText(compact.format(label), pad.left - 7, y);
    }

    var slot = chartWidth / daily.length;
    var barWidth = Math.max(5, Math.min(18, slot * 0.52));
    var gradient = context.createLinearGradient(0, pad.top, 0, pad.top + chartHeight);
    gradient.addColorStop(0, 'rgba(53, 230, 255, 0.92)');
    gradient.addColorStop(1, 'rgba(79, 140, 255, 0.24)');

    daily.forEach(function (item, index) {
      var value = Number(item.requests || 0);
      var height = (value / max) * chartHeight;
      var barX = pad.left + slot * index + (slot - barWidth) / 2;
      var barY = pad.top + chartHeight - height;
      if (height > 0.5) {
        context.fillStyle = gradient;
        roundedRect(context, barX, barY, barWidth, height, Math.min(4, barWidth / 2));
        context.fill();
      }
    });

    context.strokeStyle = 'rgba(167, 139, 250, 0.9)';
    context.lineWidth = 1.6;
    context.lineJoin = 'round';
    context.beginPath();
    daily.forEach(function (item, index) {
      var x = pad.left + slot * index + slot / 2;
      var y = pad.top + chartHeight - (Number(item.errors || 0) / max) * chartHeight;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();

    daily.forEach(function (item, index) {
      var errorValue = Number(item.errors || 0);
      if (!errorValue) return;
      var x = pad.left + slot * index + slot / 2;
      var y = pad.top + chartHeight - (errorValue / max) * chartHeight;
      context.fillStyle = '#a78bfa';
      context.beginPath();
      context.arc(x, y, 2.3, 0, Math.PI * 2);
      context.fill();
    });

    var step = cssWidth < 520 ? 3 : cssWidth < 760 ? 2 : 1;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillStyle = 'rgba(145, 164, 194, 0.7)';
    daily.forEach(function (item, index) {
      if (index % step !== 0 && index !== daily.length - 1) return;
      var x = pad.left + slot * index + slot / 2;
      context.fillText(shortDate(item.date), x, pad.top + chartHeight + 9);
    });
  }

  function renderTopEndpoints(list) {
    var target = $('#topEndpointsList');
    if (!target) return;
    target.innerHTML = '';
    if (!list || !list.length) {
      target.innerHTML = '<div class="empty-mini"><i data-lucide="bar-chart-3"></i><p>Belum ada request tercatat.</p></div>';
      return;
    }
    var max = Math.max.apply(null, list.map(function (item) { return Number(item.requests || 0); }).concat([1]));
    list.forEach(function (item, index) {
      var row = document.createElement('div');
      row.className = 'top-row';
      var rank = document.createElement('span');
      rank.className = 'top-rank';
      rank.textContent = String(index + 1);
      var copy = document.createElement('div');
      copy.className = 'top-copy';
      var name = document.createElement('b');
      name.textContent = item.name || item.id;
      var path = document.createElement('small');
      path.textContent = item.path || '';
      var bar = document.createElement('div');
      bar.className = 'progress';
      var fill = document.createElement('div');
      fill.className = 'progress-fill';
      fill.style.width = Math.round((Number(item.requests || 0) / max) * 100) + '%';
      bar.appendChild(fill);
      copy.appendChild(name);
      copy.appendChild(path);
      copy.appendChild(bar);
      var value = document.createElement('div');
      value.className = 'top-value';
      var count = document.createElement('b');
      count.textContent = number.format(Number(item.requests || 0));
      var meta = document.createElement('small');
      meta.textContent = Number(item.successRate || 0) + '% · ' + Number(item.avgLatency || 0) + 'ms';
      value.appendChild(count);
      value.appendChild(meta);
      row.appendChild(rank);
      row.appendChild(copy);
      row.appendChild(value);
      target.appendChild(row);
    });
  }

  function renderTopUsers(list) {
    var target = $('#topUsersList');
    if (!target) return;
    target.innerHTML = '';
    if (!list || !list.length) {
      target.innerHTML = '<div class="empty-mini"><i data-lucide="users"></i><p>Belum ada data pengguna.</p></div>';
      return;
    }
    list.forEach(function (item, index) {
      var row = document.createElement('div');
      row.className = 'top-row';
      var rank = document.createElement('span');
      rank.className = 'top-rank';
      rank.textContent = String(index + 1);
      var copy = document.createElement('div');
      copy.className = 'top-copy';
      var name = document.createElement('b');
      name.textContent = '@' + (item.username || 'unknown');
      var count = document.createElement('small');
      count.textContent = number.format(Number(item.requests || 0)) + ' request';
      copy.appendChild(name);
      copy.appendChild(count);
      var value = document.createElement('div');
      value.className = 'top-value';
      var rate = document.createElement('b');
      rate.textContent = Number(item.successRate || 0) + '%';
      var latency = document.createElement('small');
      latency.textContent = Number(item.avgLatency || 0) + 'ms';
      value.appendChild(rate);
      value.appendChild(latency);
      row.appendChild(rank);
      row.appendChild(copy);
      row.appendChild(value);
      target.appendChild(row);
    });
  }

  function renderFeed(recent) {
    var body = $('#liveFeedBody');
    if (!body) return;
    body.innerHTML = '';
    setText('feedCount', String((recent || []).length));
    if (!recent || !recent.length) {
      var emptyRow = document.createElement('tr');
      var cell = document.createElement('td');
      cell.colSpan = 6;
      cell.className = 'table-empty';
      cell.textContent = 'Belum ada aktivitas. Coba panggil endpoint untuk melihat feed live.';
      emptyRow.appendChild(cell);
      body.appendChild(emptyRow);
      return;
    }

    recent.forEach(function (item) {
      var row = document.createElement('tr');
      var when = document.createElement('td');
      var whenText = document.createElement('span');
      whenText.className = 'mono';
      whenText.textContent = timeAgo(item.createdAt);
      when.appendChild(whenText);
      var user = document.createElement('td');
      var userText = document.createElement('b');
      userText.textContent = '@' + (item.username || 'public');
      user.appendChild(userText);
      var endpoint = document.createElement('td');
      var code = document.createElement('code');
      code.textContent = item.endpoint || item.endpointId || '-';
      endpoint.appendChild(code);
      var status = document.createElement('td');
      var statusCode = document.createElement('span');
      var codeValue = Number(item.status || 0);
      statusCode.className = 'status-code ' + (codeValue < 300 ? 'ok' : codeValue < 500 ? 'warn' : 'bad');
      statusCode.textContent = String(item.status || '-');
      status.appendChild(statusCode);
      var latency = document.createElement('td');
      latency.textContent = Number(item.ms || 0) + 'ms';
      var ip = document.createElement('td');
      var ipText = document.createElement('span');
      ipText.className = 'mono muted';
      ipText.textContent = item.ip || '-';
      ip.appendChild(ipText);
      row.appendChild(when);
      row.appendChild(user);
      row.appendChild(endpoint);
      row.appendChild(status);
      row.appendChild(latency);
      row.appendChild(ip);
      body.appendChild(row);
    });
  }

  function render(data) {
    if (!data) return;
    state.data = data;
    var totals = data.totals || {};
    var metrics = data.metrics || {};
    var cpu = metrics.cpu || {};
    var memory = metrics.memory || {};
    var disk = metrics.disk || {};
    var system = data.system || {};
    var free = data.freeLimit || {};

    setText('monitorRequests', number.format(Number(totals.requests || 0)));
    setText('monitorSuccess', Number(totals.successRate || 0) + '%');
    setText('monitorErrors', number.format(Number(totals.errors || 0)));
    setText('monitorLatency', number.format(Number(totals.avgLatency || 0)) + 'ms');
    setText('monitorEndpoints', number.format(Number(totals.endpoints || 0)));
    setText('monitorUsers', number.format(Number(totals.users || 0)));
    setText('monitorUpdated', dateTime(data.generatedAt));

    setText('cpuValue', Number(cpu.percent || 0) + '%');
    setWidth('cpuBar', cpu.percent);
    setText('loadValue', Number(cpu.load || 0).toFixed(2));
    setText('ramValue', Number(memory.percent || 0) + '%');
    setWidth('ramBar', memory.percent);
    setText('ramMeta', formatBytes(memory.used) + ' / ' + formatBytes(memory.total));
    setText('diskValue', Number(disk.percent || 0) + '%');
    setWidth('diskBar', disk.percent);
    setText('diskMeta', formatBytes(disk.used) + ' / ' + formatBytes(disk.total));

    setText('envPlatform', system.platform || '-');
    setText('envNode', system.node || '-');
    setText('envArch', system.arch || '-');
    setText('envUptime', formatUptime(system.uptime));

    setText('freeRemaining', number.format(Number(free.remaining || 0)));
    setText('freeLimit', number.format(Number(free.limit || 0)));
    setText('freeUsed', number.format(Number(free.used || 0)));
    setText('freeReset', dateTime(free.resetAt));
    setWidth('freeBar', 100 - Number(free.percent || 0));

    renderTopEndpoints(data.topEndpoints);
    renderTopUsers(data.topUsers);
    renderFeed(data.recent);
    drawChart(data.daily);
    if (window.Zeroix) window.Zeroix.refreshIcons();
  }

  async function load(force) {
    try {
      var response = await fetch('/monitor/data' + (force ? '?refresh=1' : ''), {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('Server returned ' + response.status);
      var data = await response.json();
      render(data);
    } catch (error) {
      /* Keep the last good snapshot on transient network errors. */
    }
  }

  function schedule() {
    clearInterval(state.timer);
    state.timer = setInterval(function () {
      if (!document.hidden) load(false);
    }, 10000);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var initial = readInitialData();
    if (initial) render(initial);
    schedule();

    var refresh = $('#refreshMonitor');
    if (refresh) {
      refresh.addEventListener('click', async function () {
        refresh.disabled = true;
        await load(true);
        refresh.disabled = false;
        if (window.Zeroix) window.Zeroix.showToast('Data monitor diperbarui.', 'success');
      });
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) load(false);
    });

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (state.data) drawChart(state.data.daily);
      }, 150);
    });
  });
})();
