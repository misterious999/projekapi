/* NusaAPI — documentation, code examples, and in-browser tester */
(function () {
  'use strict';

  var docs = null;
  try {
    var payload = document.getElementById('docsData');
    if (payload) docs = JSON.parse(payload.textContent || '{}');
  } catch (error) {
    docs = null;
  }
  if (!docs || !Array.isArray(docs.endpoints)) return;

  var $ = function (selector, scope) {
    return (scope || document).querySelector(selector);
  };
  var $$ = function (selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  };

  var byId = {};
  docs.endpoints.forEach(function (endpoint) {
    byId[endpoint.id] = endpoint;
  });

  var state = {
    endpoint: null,
    codeTab: 'curl',
    key: '',
    filter: 'all',
    search: ''
  };

  var catalog = $('#docsCatalog');
  var toolbar = $('.docs-toolbar');
  var detail = $('#endpointDetail');
  var searchInput = $('#docsSearch');
  var filterButtons = $$('[data-docs-filter]');
  var visibleCount = $('#docsVisibleCount');
  var empty = $('#docsEmpty');
  var testerKey = $('#testerApiKey');
  var testerParams = $('#testerParams');
  var testerResult = $('#testerResult');
  var testerStatus = $('#testerStatus');
  var testerTime = $('#testerTime');
  var testerBody = $('#testerBody');

  function safeText(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function applyFilters() {
    var query = state.search.trim().toLowerCase();
    var visible = 0;

    $$('.endpoint-card').forEach(function (card) {
      var endpoint = byId[card.getAttribute('data-endpoint')];
      if (!endpoint) return;
      var matchesPlan = true;
      if (state.filter === 'free') matchesPlan = endpoint.minPlan === 'free' || endpoint.public;
      if (state.filter === 'paid') matchesPlan = endpoint.minPlan !== 'free';
      if (state.filter === 'public') matchesPlan = Boolean(endpoint.public);

      var haystack = (
        endpoint.name + ' ' +
        endpoint.path + ' ' +
        endpoint.summary + ' ' +
        endpoint.categoryName + ' ' +
        endpoint.id + ' ' +
        safeText(endpoint.description)
      ).toLowerCase();
      var matchesQuery = !query || haystack.indexOf(query) !== -1;
      var show = matchesPlan && matchesQuery;
      card.hidden = !show;
      if (show) visible += 1;
    });

    var emptyResults = visible === 0;
    if (empty) empty.hidden = !emptyResults;
    if (visibleCount) visibleCount.textContent = String(visible);

    $$('.docs-category').forEach(function (section) {
      var hasVisible = $$('.endpoint-card', section).some(function (card) {
        return !card.hidden;
      });
      section.hidden = !hasVisible;
    });
  }

  function buildParamRow(param) {
    var tr = document.createElement('tr');
    var name = document.createElement('td');
    var nameCode = document.createElement('code');
    nameCode.textContent = param.name;
    name.appendChild(nameCode);
    var type = document.createElement('td');
    type.textContent = param.type || 'string';
    var required = document.createElement('td');
    required.textContent = param.required ? 'Wajib' : 'Opsional';
    if (param.required) required.className = 'text-green';
    var example = document.createElement('td');
    var exampleCode = document.createElement('code');
    exampleCode.textContent = param.example === undefined ? '—' : String(param.example);
    example.appendChild(exampleCode);
    var description = document.createElement('td');
    description.textContent = safeText(param.description);
    tr.appendChild(name);
    tr.appendChild(type);
    tr.appendChild(required);
    tr.appendChild(example);
    tr.appendChild(description);
    return tr;
  }

  function buildTesterFields(endpoint) {
    if (!testerParams) return;
    testerParams.innerHTML = '';
    if (!endpoint.params.length) {
      var note = document.createElement('p');
      note.className = 'tester-note';
      note.textContent = 'Endpoint ini tidak membutuhkan parameter tambahan.';
      testerParams.appendChild(note);
      return;
    }
    endpoint.params.forEach(function (param) {
      var label = document.createElement('label');
      label.className = 'field';
      var caption = document.createElement('span');
      caption.textContent = param.name + (param.required ? ' *' : '');
      var hint = document.createElement('small');
      hint.textContent = ' ' + (param.type || 'string');
      caption.appendChild(hint);
      var input;
      if (param.type === 'string' && String(param.example || '').length > 70) {
        input = document.createElement('textarea');
      } else {
        input = document.createElement('input');
        input.type = param.type === 'number' ? 'number' : 'text';
      }
      input.setAttribute('data-param', param.name);
      input.setAttribute('data-param-type', param.type || 'string');
      input.setAttribute('data-param-required', param.required ? '1' : '0');
      if (param.example !== undefined) input.value = String(param.example);
      input.placeholder = param.required ? 'Wajib diisi' : 'Opsional';
      label.appendChild(caption);
      label.appendChild(input);
      testerParams.appendChild(label);
    });
  }

  function updateCode() {
    if (!state.endpoint) return;
    var code = $('#detailCode');
    var copy = $('#detailCopyCode');
    var examples = state.endpoint.examples || {};
    var value = examples[state.codeTab] || examples.curl || '';
    if (code) code.textContent = value;
    if (copy) copy.setAttribute('data-copy', value);
    $$('[data-code-tab]').forEach(function (button) {
      button.classList.toggle('is-active', button.getAttribute('data-code-tab') === state.codeTab);
    });
  }

  function openEndpoint(id, options) {
    var endpoint = byId[id];
    if (!endpoint) return;

    state.endpoint = endpoint;
    if (options && options.keepTab) {
      /* keep the selected language when moving through the docs */
    } else {
      state.codeTab = 'curl';
    }

    var method = $('#detailMethod');
    if (method) {
      method.textContent = endpoint.method;
      method.className = 'method-pill method-' + endpoint.method.toLowerCase();
    }
    var path = $('#detailPath');
    if (path) path.textContent = endpoint.path;
    var copyPath = $('#detailCopyPath');
    if (copyPath) copyPath.setAttribute('data-copy', docs.baseUrl + endpoint.path);
    var name = $('#detailName');
    if (name) name.textContent = endpoint.name;
    var summary = $('#detailSummary');
    if (summary) summary.textContent = endpoint.summary;
    var description = $('#detailDescription');
    if (description) description.textContent = endpoint.description || endpoint.summary;

    var meta = $('#detailMeta');
    if (meta) {
      meta.innerHTML = '';
      var chips = [
        { icon: endpoint.public ? 'globe' : 'lock', label: endpoint.public ? 'Publik · tanpa API key' : 'Butuh API key' },
        { icon: 'layers', label: endpoint.public ? 'Tanpa plan' : (endpoint.minPlan === 'free' ? 'Plan Free+' : 'Plan ' + endpoint.minPlan) },
        { icon: 'folder', label: endpoint.categoryName }
      ];
      chips.forEach(function (chip) {
        var span = document.createElement('span');
        var icon = document.createElement('i');
        icon.setAttribute('data-lucide', chip.icon);
        span.appendChild(icon);
        span.appendChild(document.createTextNode(' ' + chip.label));
        meta.appendChild(span);
      });
    }

    var paramsBody = $('#detailParams');
    if (paramsBody) {
      paramsBody.innerHTML = '';
      if (!endpoint.params.length) {
        var emptyRow = document.createElement('tr');
        var cell = document.createElement('td');
        cell.colSpan = 5;
        cell.className = 'table-empty';
        cell.textContent = 'Tidak ada parameter.';
        emptyRow.appendChild(cell);
        paramsBody.appendChild(emptyRow);
      } else {
        endpoint.params.forEach(function (param) {
          paramsBody.appendChild(buildParamRow(param));
        });
      }
    }

    var response = $('#detailResponse');
    if (response) {
      response.textContent = JSON.stringify(endpoint.response || {}, null, 2);
    }

    var badge = $('#testerAuthBadge');
    if (badge) {
      badge.textContent = endpoint.public ? 'Publik' : 'API key';
      badge.className = 'badge ' + (endpoint.public ? 'badge-green' : 'badge-blue');
    }
    var help = $('#docsTesterHelp');
    if (help) {
      help.textContent = endpoint.public
        ? 'Endpoint ini publik. API key opsional, tetapi tetap bisa dipakai untuk kuota akun.'
        : 'Tempel API key kamu (atau FreeLimit), isi parameter, lalu kirim request.';
    }
    if (testerKey) testerKey.value = state.key;
    if (testerResult) testerResult.hidden = true;
    buildTesterFields(endpoint);
    updateCode();

    if (catalog) catalog.hidden = true;
    if (toolbar) toolbar.hidden = true;
    if (detail) {
      detail.hidden = false;
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (window.Nusa) window.Nusa.refreshIcons();
    try {
      history.replaceState(null, '', '#ep-' + endpoint.id);
    } catch (error) {
      /* history can be restricted */
    }
  }

  function closeEndpoint(scrollBack) {
    state.endpoint = null;
    if (detail) detail.hidden = true;
    if (catalog) catalog.hidden = false;
    if (toolbar) toolbar.hidden = false;
    if (scrollBack) {
      var target = catalog || document.querySelector('.docs-main');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    try {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (error) {
      /* ignore */
    }
  }

  function valueFor(param, raw) {
    var value = raw === undefined ? '' : String(raw).trim();
    if (value === '') return undefined;
    if (param.type === 'number') {
      var number = Number(value);
      return Number.isFinite(number) ? number : value;
    }
    if (param.type === 'boolean') return value === 'true' || value === '1';
    return value;
  }

  async function sendTestRequest() {
    var endpoint = state.endpoint;
    if (!endpoint) return;

    var key = testerKey ? testerKey.value.trim() : '';
    state.key = key;
    if (!endpoint.public && !key) {
      if (window.Nusa) window.Nusa.showToast('API key wajib diisi. Gunakan key akun atau FreeLimit.', 'error');
      if (testerKey) testerKey.focus();
      return;
    }

    var values = {};
    $$('[data-param]', testerParams).forEach(function (input) {
      values[input.getAttribute('data-param')] = input.value;
    });

    var path = endpoint.path;
    var used = {};
    path = path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, function (match, name) {
      used[name] = true;
      var param = endpoint.params.find(function (item) { return item.name === name; }) || {};
      var value = valueFor(param, values[name]);
      if (value === undefined) return match;
      return encodeURIComponent(value);
    });

    var url = docs.baseUrl + path;
    var options = { method: endpoint.method, headers: { Accept: 'application/json' } };
    if (key) options.headers.Authorization = 'Bearer ' + key;

    if (endpoint.method === 'GET') {
      var query = new URLSearchParams();
      endpoint.params.forEach(function (param) {
        if (used[param.name]) return;
        var value = valueFor(param, values[param.name]);
        if (value !== undefined) query.set(param.name, value);
      });
      var queryString = query.toString();
      if (queryString) url += (url.indexOf('?') === -1 ? '?' : '&') + queryString;
    } else {
      var body = {};
      endpoint.params.forEach(function (param) {
        if (used[param.name]) return;
        var value = valueFor(param, values[param.name]);
        if (value !== undefined) body[param.name] = value;
      });
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    var button = $('#testerSend');
    if (button) {
      button.disabled = true;
      button.innerHTML = '<i data-lucide="loader-circle"></i> Mengirim...';
      if (window.Nusa) window.Nusa.refreshIcons();
    }
    if (testerResult) testerResult.hidden = true;

    var started = performance.now();
    try {
      var response = await fetch(url, options);
      var elapsed = Math.round(performance.now() - started);
      var text = await response.text();
      var output = text;
      try {
        output = JSON.stringify(JSON.parse(text), null, 2);
      } catch (error) {
        output = text;
      }
      if (testerStatus) {
        testerStatus.textContent = response.status + ' ' + (response.statusText || '');
        testerStatus.style.color = response.ok ? 'var(--green)' : 'var(--red)';
      }
      if (testerTime) testerTime.textContent = elapsed + ' ms';
      if (testerBody) testerBody.textContent = output;
      if (testerResult) testerResult.hidden = false;
    } catch (error) {
      if (testerStatus) {
        testerStatus.textContent = 'Network error';
        testerStatus.style.color = 'var(--red)';
      }
      if (testerTime) testerTime.textContent = Math.round(performance.now() - started) + ' ms';
      if (testerBody) testerBody.textContent = 'Request gagal: ' + error.message + '\n\nPastikan server berjalan dan URL dapat diakses dari browser.';
      if (testerResult) testerResult.hidden = false;
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = '<i data-lucide="play"></i> Kirim request';
        if (window.Nusa) window.Nusa.refreshIcons();
      }
    }
  }

  function bindRevealKey() {
    var button = $('#testerUseMyKey');
    if (!button) return;
    button.addEventListener('click', async function () {
      var meta = document.querySelector('meta[name="csrf-token"]');
      var token = meta ? meta.getAttribute('content') : '';
      button.disabled = true;
      try {
        var response = await fetch('/dashboard/api/reveal', {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'X-CSRF-Token': token },
          credentials: 'same-origin'
        });
        var data = await response.json();
        if (!response.ok || !data.key) throw new Error(data.message || 'Gagal mengambil API key.');
        if (testerKey) testerKey.value = data.key;
        state.key = data.key;
        if (window.Nusa) window.Nusa.showToast('API key akun dipakai di tester.', 'success');
      } catch (error) {
        if (window.Nusa) window.Nusa.showToast(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });
  }

  function bindSidebar() {
    var toggle = $('#docsSidebarToggle');
    var sidebar = $('#docsSidebar');
    if (!toggle || !sidebar) return;
    toggle.addEventListener('click', function () {
      sidebar.classList.toggle('is-open');
    });
    sidebar.addEventListener('click', function (event) {
      if (event.target.closest('a')) sidebar.classList.remove('is-open');
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') sidebar.classList.remove('is-open');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    applyFilters();
    bindSidebar();
    bindRevealKey();

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        state.search = searchInput.value;
        applyFilters();
      });
    }

    filterButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        state.filter = button.getAttribute('data-docs-filter') || 'all';
        filterButtons.forEach(function (other) {
          other.classList.toggle('is-active', other === button);
        });
        applyFilters();
      });
    });

    document.addEventListener('click', function (event) {
      var open = event.target.closest('[data-open-endpoint]');
      if (open) {
        event.preventDefault();
        openEndpoint(open.getAttribute('data-open-endpoint'));
      }
      var tab = event.target.closest('[data-code-tab]');
      if (tab) {
        state.codeTab = tab.getAttribute('data-code-tab');
        updateCode();
      }
    });

    var close = $('#closeEndpointDetail');
    if (close) {
      close.addEventListener('click', function () {
        closeEndpoint(true);
      });
    }

    var send = $('#testerSend');
    if (send) send.addEventListener('click', sendTestRequest);

    if (testerKey) {
      testerKey.addEventListener('input', function () {
        state.key = testerKey.value.trim();
      });
      testerKey.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          sendTestRequest();
        }
      });
    }

    var hash = window.location.hash.replace('#', '');
    if (hash.indexOf('ep-') === 0) {
      var id = hash.slice(3);
      if (byId[id]) setTimeout(function () { openEndpoint(id); }, 30);
    }
  });
})();
