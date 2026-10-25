/* ZeroixApi — landing page interactions */
(function () {
  'use strict';

  var formatter = new Intl.NumberFormat('id-ID');
  var terminalTimer = null;
  var terminalIndex = 0;

  function setText(selector, value) {
    var node = document.querySelector(selector);
    if (node) node.textContent = value;
  }

  function initTerminal() {
    var card = document.querySelector('[data-terminal]');
    if (!card) return;
    var command = card.querySelector('[data-terminal-command]');
    var status = card.querySelector('[data-terminal-status]');
    var response = card.querySelector('[data-terminal-response]');
    if (!command || !status || !response) return;

    var base = window.location.origin;
    var examples = [
      {
        command: 'curl "' + base + '/api/tools/weather?city=Jakarta" \\\n  -H "Authorization: Bearer zeroix_••••••••"',
        status: '200 OK',
        response: '{\n  "status": true,\n  "data": {\n    "city": "Jakarta",\n    "temperature": 31.2,\n    "condition": "Cerah berawan"\n  }\n}'
      },
      {
        command: 'curl "' + base + '/api/tools/qr?text=ZeroixApi" \\\n  -H "Authorization: Bearer zeroix_••••••••"',
        status: '200 OK',
        response: '{\n  "status": true,\n  "data": {\n    "format": "png",\n    "size": 512,\n    "url": "/api/tools/qr?... "\n  }\n}'
      },
      {
        command: 'curl "' + base + '/api/tools/uuid?count=3" \\\n  -H "Authorization: Bearer zeroix_••••••••"',
        status: '200 OK',
        response: '{\n  "status": true,\n  "data": {\n    "uuids": [\n      "e4f1…", "9ab2…", "71cd…"\n    ]\n  }\n}'
      }
    ];

    function render() {
      var item = examples[terminalIndex % examples.length];
      terminalIndex += 1;
      command.textContent = item.command;
      status.textContent = item.status;
      response.textContent = item.response;
    }

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    terminalTimer = setInterval(render, 5200);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        clearInterval(terminalTimer);
      } else if (!terminalTimer) {
        terminalTimer = setInterval(render, 5200);
      }
    });
  }

  function updateStats() {
    fetch('/monitor/data', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (response) {
        if (!response.ok) throw new Error('stats');
        return response.json();
      })
      .then(function (data) {
        if (!data || !data.totals) return;
        setText('[data-stat-requests]', formatter.format(data.totals.requests || 0));
        setText('[data-stat-success]', (data.totals.successRate || 0) + '%');
        if (data.freeLimit) {
          setText('[data-free-remaining]', formatter.format(data.freeLimit.remaining || 0));
          setText('[data-free-used]', formatter.format(data.freeLimit.used || 0));
          var bar = document.querySelector('[data-free-bar]');
          if (bar) bar.style.width = Math.max(0, 100 - Number(data.freeLimit.percent || 0)) + '%';
          var reset = document.querySelector('[data-free-reset]');
          if (reset && data.freeLimit.resetAt) reset.setAttribute('data-reset-at', data.freeLimit.resetAt);
        }
      })
      .catch(function () {
        /* keep server-rendered values */
      });
  }

  function initFaqDeepLink() {
    if (!window.location.hash) return;
    var id = window.location.hash.replace('#', '');
    var item = document.getElementById(id);
    if (!item || !item.classList.contains('faq-item')) return;
    item.classList.add('is-open');
    var button = item.querySelector('.faq-question');
    if (button) button.setAttribute('aria-expanded', 'true');
  }

  document.addEventListener('DOMContentLoaded', function () {
    initTerminal();
    updateStats();
    setInterval(updateStats, 45000);
    initFaqDeepLink();
  });
})();
