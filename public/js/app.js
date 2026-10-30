// Small progressive enhancements. Every page works without this file.
(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  // Let the styled title card show through when a thumbnail can't load.
  $$('img[data-hide-on-error]').forEach(function (img) {
    var hide = function () { img.remove(); };
    if (img.complete && img.naturalWidth === 0) hide();
    else img.addEventListener('error', hide);
  });

  // Mobile navigation.
  var toggle = $('.nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var nav = $('#site-nav');
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  // Confirm destructive actions.
  $$('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });

  // Credits editor: add / remove rows.
  var rows = $('[data-credit-rows]');
  var template = $('#credit-row-template');
  if (rows && template) {
    $$('[data-add-credit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var row = template.content.firstElementChild.cloneNode(true);
        $('select', row).value = btn.dataset.addCredit;
        rows.appendChild(row);
        $(btn.dataset.addCredit ? 'input' : 'select', row).focus();
      });
    });
    rows.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-remove-credit]');
      if (!btn) return;
      var row = btn.closest('.credit-row');
      if ($$('.credit-row', rows).length > 1) row.remove();
      else $('input', row).value = '';
    });
  }

  // Live preview of the embedded film while filling in the link.
  var videoInput = $('[data-video-preview]');
  if (videoInput) {
    var preview = $('.video-preview');
    var update = function () {
      var embed = toEmbed(videoInput.value);
      if (!embed) { preview.hidden = true; preview.innerHTML = ''; return; }
      if (preview.dataset.src === embed) return;
      preview.dataset.src = embed;
      preview.innerHTML = '';
      var iframe = document.createElement('iframe');
      iframe.src = embed;
      iframe.title = 'Preview';
      iframe.allow = 'fullscreen; picture-in-picture';
      preview.appendChild(iframe);
      preview.hidden = false;
    };
    videoInput.addEventListener('change', update);
    videoInput.addEventListener('blur', update);
    update();
  }

  function toEmbed(raw) {
    var url;
    try { url = new URL(raw.trim()); } catch (e) { return null; }
    var host = url.hostname.replace(/^www\.|^m\./, '');
    var parts = url.pathname.split('/').filter(Boolean);
    var yt = /^[A-Za-z0-9_-]{11}$/;
    var id = null;
    if (host === 'youtu.be') id = parts[0];
    else if (host === 'youtube.com') id = url.searchParams.get('v') || (['embed', 'shorts', 'live'].indexOf(parts[0]) >= 0 ? parts[1] : null);
    if (id && yt.test(id)) return 'https://www.youtube-nocookie.com/embed/' + id;
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      var vid = parts.slice().reverse().find(function (p) { return /^\d{5,12}$/.test(p); });
      if (vid) return 'https://player.vimeo.com/video/' + vid + '?dnt=1';
    }
    return null;
  }

  // Word meter for recommendations.
  $$('textarea[data-min-words]').forEach(function (area) {
    var min = Number(area.dataset.minWords);
    var meter = area.closest('form').querySelector('.word-meter');
    var bar = $('.word-meter-bar span', meter);
    var label = $('.word-meter-label', meter);
    var update = function () {
      var words = (area.value.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
      bar.style.width = Math.min(100, (words / min) * 100) + '%';
      meter.classList.toggle('is-ready', words >= min);
      label.textContent = words >= min
        ? words + ' words — ready to publish'
        : words + ' / ' + min + ' words · ' + (min - words) + ' to go';
    };
    area.addEventListener('input', update);
    update();
  });

  // Filter recommendations by craft.
  var recFilter = $('[data-rec-filter]');
  if (recFilter) {
    recFilter.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-role]');
      if (!btn) return;
      $$('button', recFilter).forEach(function (b) { b.classList.toggle('active', b === btn); });
      $$('.recommendation[data-role]').forEach(function (rec) {
        rec.hidden = btn.dataset.role !== '' && rec.dataset.role !== btn.dataset.role;
      });
    });
  }

  // Collapse long recommendations, unless one is linked directly.
  $$('.collapsible').forEach(function (el) {
    if (el.scrollHeight < 340 || location.hash === '#' + el.closest('[id]').id) return;
    el.classList.add('is-collapsed');
    var more = document.createElement('button');
    more.type = 'button';
    more.className = 'link-button read-more small';
    more.textContent = 'Read the full recommendation ↓';
    more.addEventListener('click', function () {
      el.classList.remove('is-collapsed');
      more.remove();
    });
    el.after(more);
  });

  // Preview the chosen set photo.
  $$('[data-image-preview]').forEach(function (input) {
    var img = input.parentElement.querySelector('.file-drop-preview');
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) { img.hidden = true; return; }
      img.src = URL.createObjectURL(file);
      img.hidden = false;
    });
  });
})();
