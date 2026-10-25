/* NusaAPI — global interactions */
(function () {
  'use strict';

  var $ = function (selector, scope) {
    return (scope || document).querySelector(selector);
  };
  var $$ = function (selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  };

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try {
        window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
      } catch (error) {
        /* icons are cosmetic */
      }
    }
  }

  async function copyText(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      /* fall through */
    }
    try {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-9999px';
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch (error) {
      return false;
    }
  }

  function showToast(message, type) {
    var stack = $('#toastStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'toastStack';
      stack.className = 'toast-stack';
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + (type || 'info');
    toast.setAttribute('role', 'status');
    var icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = type === 'error' ? '!' : '✓';
    var copy = document.createElement('div');
    copy.className = 'toast-copy';
    copy.textContent = message;
    var close = document.createElement('button');
    close.className = 'toast-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Tutup');
    close.textContent = '×';
    close.addEventListener('click', function () {
      dismiss(toast);
    });
    toast.appendChild(icon);
    toast.appendChild(copy);
    toast.appendChild(close);
    stack.appendChild(toast);
    setTimeout(function () {
      dismiss(toast);
    }, 5200);
  }

  function dismiss(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add('is-leaving');
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 230);
  }

  function bindCopyButtons() {
    document.addEventListener('click', async function (event) {
      var button = event.target.closest('[data-copy]');
      if (!button) return;
      event.preventDefault();
      var value = button.getAttribute('data-copy');
      var ok = await copyText(value);
      if (!ok) {
        showToast('Browser menolak akses clipboard. Copy manual teksnya.', 'error');
        return;
      }
      button.classList.add('copied');
      var old = button.getAttribute('aria-label');
      button.setAttribute('aria-label', 'Tersalin');
      setTimeout(function () {
        button.classList.remove('copied');
        if (old) button.setAttribute('aria-label', old);
      }, 1500);
      showToast('Teks disalin ke clipboard.', 'success');
    });
  }

  function bindNav() {
    var toggle = $('#navToggle');
    var links = $('#navLinks');
    var nav = $('#siteNav');
    if (toggle && links) {
      toggle.addEventListener('click', function () {
        var open = links.classList.toggle('is-open');
        toggle.classList.toggle('is-open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      links.addEventListener('click', function (event) {
        if (event.target.closest('a')) {
          links.classList.remove('is-open');
          toggle.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
      document.addEventListener('click', function (event) {
        if (!links.contains(event.target) && !toggle.contains(event.target)) {
          links.classList.remove('is-open');
          toggle.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          links.classList.remove('is-open');
          toggle.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    }
    if (nav) {
      var onScroll = function () {
        nav.classList.toggle('is-scrolled', window.scrollY > 10);
      };
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
    }
  }

  function bindAnnouncements() {
    $$('[data-announcement]').forEach(function (bar) {
      var key = 'nusa-announcement-' + (bar.getAttribute('data-announcement-key') || 'default');
      try {
        if (window.localStorage && localStorage.getItem(key) === 'closed') {
          bar.hidden = true;
          return;
        }
      } catch (error) {
        /* storage can be unavailable */
      }
      var close = bar.querySelector('[data-announcement-close]');
      if (!close) return;
      close.addEventListener('click', function () {
        bar.hidden = true;
        try {
          localStorage.setItem(key, 'closed');
        } catch (error) {
          /* ignore */
        }
      });
    });
  }

  function bindToasts() {
    $$('[data-toast]').forEach(function (toast) {
      var close = toast.querySelector('[data-toast-close]');
      if (close) {
        close.addEventListener('click', function () {
          dismiss(toast);
        });
      }
      setTimeout(function () {
        dismiss(toast);
      }, 6000);
    });
  }

  function bindFaq() {
    $$('.faq-question').forEach(function (button) {
      button.addEventListener('click', function () {
        var item = button.closest('.faq-item');
        if (!item) return;
        var isOpen = item.classList.contains('is-open');
        var parent = item.parentElement;
        if (parent) {
          $$('.faq-item.is-open', parent).forEach(function (other) {
            if (other !== item) {
              other.classList.remove('is-open');
              var q = other.querySelector('.faq-question');
              if (q) q.setAttribute('aria-expanded', 'false');
            }
          });
        }
        item.classList.toggle('is-open', !isOpen);
        button.setAttribute('aria-expanded', !isOpen ? 'true' : 'false');
      });
    });
  }

  function bindPasswordToggles() {
    $$('[data-toggle-password]').forEach(function (button) {
      button.addEventListener('click', function () {
        var input = document.getElementById(button.getAttribute('data-toggle-password'));
        if (!input) return;
        var visible = input.type === 'text';
        input.type = visible ? 'password' : 'text';
        button.setAttribute('aria-label', visible ? 'Lihat password' : 'Sembunyikan password');
        var icon = button.querySelector('i');
        if (icon) icon.setAttribute('data-lucide', visible ? 'eye' : 'eye-off');
        refreshIcons();
      });
    });
  }

  function bindPasswordMeter() {
    var input = $('#registerPassword');
    var meter = $('[data-password-meter]');
    if (!input || !meter) return;
    var bars = $$('span', meter);
    input.addEventListener('input', function () {
      var value = input.value;
      var score = 0;
      if (value.length >= 8) score += 1;
      if (value.length >= 12) score += 1;
      if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
      if (/[0-9]/.test(value)) score += 1;
      if (/[^A-Za-z0-9]/.test(value)) score += 1;
      score = Math.min(4, score);
      bars.forEach(function (bar, index) {
        bar.classList.remove('is-weak', 'is-medium', 'is-strong');
        if (index < score) {
          bar.classList.add(score <= 1 ? 'is-weak' : score <= 2 ? 'is-medium' : 'is-strong');
        }
      });
    });
  }

  function bindConfirmForms() {
    document.addEventListener('submit', function (event) {
      var form = event.target;
      if (!form || !form.matches || !form.matches('form[data-confirm]')) return;
      var message = form.getAttribute('data-confirm') || 'Lanjutkan aksi ini?';
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  function bindCountdowns() {
    var nodes = $$('[data-countdown]');
    if (!nodes.length) return;

    function format(ms) {
      if (ms <= 0) return 'Berakhir';
      var seconds = Math.floor(ms / 1000);
      var days = Math.floor(seconds / 86400);
      var hours = Math.floor((seconds % 86400) / 3600);
      var minutes = Math.floor((seconds % 3600) / 60);
      var secs = seconds % 60;
      if (days > 0) return days + 'h ' + hours + 'j';
      if (hours > 0) return hours + 'j ' + minutes + 'm';
      if (minutes > 0) return minutes + 'm ' + secs + 'd';
      return secs + 'd';
    }

    function update() {
      nodes.forEach(function (node) {
        var expiry = Number(node.getAttribute('data-expiry') || 0);
        var target = node.querySelector('[data-countdown-text]') || node.querySelector('b');
        if (!expiry || !target) return;
        target.textContent = format(expiry - Date.now());
      });
    }
    update();
    setInterval(update, 30000);
  }

  function bindMisc() {
    $$('input[name="ref"]').forEach(function (input) {
      input.addEventListener('input', function () {
        input.value = input.value.toUpperCase().replace(/\s+/g, '');
      });
    });

    var avatarInput = $('#avatarUrlInput');
    var avatarPreview = $('#avatarPreview');
    if (avatarInput && avatarPreview) {
      avatarInput.addEventListener('change', function () {
        var value = avatarInput.value.trim();
        if (!value || !/^https?:\/\//i.test(value)) return;
        avatarPreview.innerHTML = '';
        var image = document.createElement('img');
        image.src = value;
        image.alt = '';
        image.referrerPolicy = 'no-referrer';
        avatarPreview.appendChild(image);
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    refreshIcons();
    bindCopyButtons();
    bindNav();
    bindAnnouncements();
    bindToasts();
    bindFaq();
    bindPasswordToggles();
    bindPasswordMeter();
    bindConfirmForms();
    bindCountdowns();
    bindMisc();
    window.Nusa = {
      refreshIcons: refreshIcons,
      copyText: copyText,
      showToast: showToast
    };
  });
})();
