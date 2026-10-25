/* ZeroixApi — admin console */
(function () {
  'use strict';

  function bindSidebar() {
    var sidebar = document.getElementById('adminSidebar');
    var button = document.getElementById('adminMenuBtn');
    var backdrop = document.getElementById('adminBackdrop');
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

  function bindRedeemForm() {
    var type = document.getElementById('redeemType');
    var value = document.getElementById('redeemValue');
    var hint = document.getElementById('redeemHint');
    if (!type || !value || !hint) return;

    var config = {
      quota: { placeholder: '1000', hint: 'Jumlah request yang ditambahkan ke kuota user.' },
      days: { placeholder: '30', hint: 'Jumlah hari yang ditambahkan ke masa aktif user.' },
      plan: { placeholder: 'plus', hint: 'Key plan: starter, plus, pro, business, elite, atau ultimate.' }
    };

    function update() {
      var item = config[type.value] || config.quota;
      value.placeholder = item.placeholder;
      hint.textContent = item.hint;
      if (type.value === 'plan') {
        value.setAttribute('inputmode', 'text');
      } else {
        value.setAttribute('inputmode', 'numeric');
      }
    }

    type.addEventListener('change', update);
    update();
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindSidebar();
    bindRedeemForm();
  });
})();
