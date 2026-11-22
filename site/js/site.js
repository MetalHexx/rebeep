// ReBeep product page. Progressive only: the page reads fully without this file.
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.add('js');

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- scroll reveal (below-the-fold elements only, so nothing flashes) ----------
  var revealEls = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
  if (!reduceMotion && 'IntersectionObserver' in window) {
    var vh = window.innerHeight || 800;
    var pending = revealEls.filter(function (el) {
      return el.getBoundingClientRect().top > vh;
    });
    pending.forEach(function (el) { el.classList.add('is-pending'); });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        el.classList.remove('is-pending');
        if (el.classList.contains('card')) el.classList.add('is-on');
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -24px 0px', threshold: 0 });
    pending.forEach(function (el) { io.observe(el); });
  }

  // ---------- card glow that follows the cursor ----------
  var cards = document.querySelectorAll('[data-glow]');
  Array.prototype.forEach.call(cards, function (card) {
    card.addEventListener('pointermove', function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
    card.addEventListener('pointerleave', function () {
      card.style.removeProperty('--mx');
      card.style.removeProperty('--my');
    });
  });

  // ---------- pause the how-it-works animation (WCAG 2.2.2) ----------
  var flow = document.querySelector('.flow');
  var pause = document.querySelector('.flow__pause');
  if (flow && pause && !reduceMotion) {
    pause.hidden = false;
    var label = pause.querySelector('.flow__pause-label');
    pause.addEventListener('click', function () {
      var paused = flow.classList.toggle('is-paused');
      pause.setAttribute('aria-pressed', paused ? 'true' : 'false');
      if (label) label.textContent = paused ? 'Play animation' : 'Pause animation';
    });
  }

  // ---------- video facade: nothing loads from YouTube until play ----------
  var ID_RE = /^[A-Za-z0-9_-]{11}$/;
  var slot = document.querySelector('.video[data-video-id]');
  if (slot) {
    var id = slot.getAttribute('data-video-id') || '';
    if (ID_RE.test(id)) {
      var title = slot.getAttribute('data-video-title') || 'ReBeep demo video';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'video__poster';
      btn.setAttribute('aria-label', 'Play video: ' + title);
      var img = document.createElement('img');
      img.src = 'img/demo-poster.webp';
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      var play = document.createElement('span');
      play.className = 'video__play';
      play.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="M3 1h2v1h2v1h2v1h2v1h2v1h1v4h-1v1h-2v1H9v1H7v1H5v1H3z"/></svg>';
      btn.appendChild(img);
      btn.appendChild(play);
      btn.addEventListener('click', function () {
        var frame = document.createElement('iframe');
        frame.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&cc_load_policy=1';
        frame.title = title;
        frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        frame.allowFullscreen = true;
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        slot.replaceChildren(frame);
        frame.focus();
      });
      slot.replaceChildren(btn);
    }
  }
})();
