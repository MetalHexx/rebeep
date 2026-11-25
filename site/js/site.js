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

  // ---------- the studio TV: channels that change by themselves ----------
  // WAI-ARIA carousel with a pause button (WCAG 2.2.2). It holds still on hover and focus, off screen, in a hidden
  // tab and under reduced motion. A picture loads only when its channel is next.
  var stopTv = function () {};
  var tv = document.querySelector('.tv');
  if (tv) {
    var chans = Array.prototype.slice.call(tv.querySelectorAll('.tv__ch'));
    var live = tv.querySelector('.tv__channels');
    var num = tv.querySelector('.tv__num');
    var controls = tv.querySelector('.tv__controls');
    var pauseBtn = tv.querySelector('[data-tv="pause"]');
    var sprite = tv.querySelector('.tv__sprite');
    var frameCount = sprite ? parseInt(sprite.getAttribute('data-frames'), 10) || 1 : 1;
    if (sprite) sprite.style.setProperty('--frames', String(frameCount));
    var HOLD = 4500; // a still channel, in ms, unless it has data-hold
    var FRAME = 1600; // one F12 roll on the patch editor
    var OFF = 460; // the CRT shrink, matching site.css
    var DARK = 120;
    var ON = 420;
    var cur = 0;
    var frame = 0;
    var timer = 0;
    var osdTimer = 0;
    var busy = false;
    var paused = false;
    var held = false;
    var seen = false;
    var visible = !('IntersectionObserver' in window);
    var stopped = false;

    // Anything moves only while this holds. Hover and keyboard focus (held) stop only the channel changes: the
    // patch editor keeps rolling for whoever is looking at it.
    var running = function () {
      return !reduceMotion && !paused && !stopped && visible && !document.hidden;
    };
    var isSynth = function (i) { return chans[i].classList.contains('tv__ch--synth'); };
    var holdFor = function (i) { return parseInt(chans[i].getAttribute('data-hold'), 10) || HOLD; };
    var rolling = function () { return isSynth(cur) && (frame < frameCount - 1 || held); };
    // Fetch the channel's picture now: an eager <img> loads even while its channel is hidden.
    var warm = function (i) {
      var img = chans[i].querySelector('img[loading="lazy"]');
      if (img) img.loading = 'eager';
    };
    var setFrame = function (f) {
      frame = f;
      if (sprite) sprite.style.setProperty('--frame', String(f));
    };
    var osd = function () {
      var rec = chans[cur].hasAttribute('data-video-id');
      tv.classList.add('osd-on');
      clearTimeout(osdTimer);
      osdTimer = setTimeout(function () { if (!rec) tv.classList.remove('osd-on'); }, 2000);
    };
    var show = function (i) {
      chans[cur].hidden = true;
      chans[i].hidden = false;
      cur = i;
      setFrame(0);
      num.textContent = '0' + (i + 1);
      tv.classList.toggle('is-rec', chans[i].hasAttribute('data-video-id'));
      osd();
      warm((i + 1) % chans.length);
    };
    var change = function (step, byHand) {
      if (busy || stopped) return;
      var next = (cur + step + chans.length) % chans.length;
      live.setAttribute('aria-live', byHand || paused ? 'polite' : 'off');
      warm(next);
      if (reduceMotion) { show(next); return; }
      busy = true;
      tv.classList.add('is-off');
      setTimeout(function () {
        show(next);
        tv.classList.remove('is-off');
        tv.classList.add('is-dark');
        setTimeout(function () {
          tv.classList.remove('is-dark');
          tv.classList.add('is-on');
          setTimeout(function () { tv.classList.remove('is-on'); busy = false; schedule(); }, ON);
        }, DARK);
      }, OFF);
    };
    var tick = function () {
      timer = 0;
      if (!running()) return;
      if (rolling()) {
        setFrame((frame + 1) % frameCount);
        schedule();
      } else if (!held) {
        change(1, false);
      }
    };
    // (Re)start the clock for the current step, or stop it.
    var schedule = function () {
      clearTimeout(timer);
      timer = 0;
      if (busy || !running()) return;
      if (rolling() || isSynth(cur)) timer = setTimeout(tick, FRAME);
      else if (!held) timer = setTimeout(tick, holdFor(cur));
    };

    controls.hidden = false;
    if (reduceMotion) pauseBtn.hidden = true;
    tv.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-tv]') : null;
      if (!btn) return;
      var what = btn.getAttribute('data-tv');
      if (what === 'pause') {
        paused = !paused;
        pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
        pauseBtn.setAttribute('aria-label', paused ? 'Play the channels' : 'Pause the channels');
        live.setAttribute('aria-live', paused ? 'polite' : 'off');
        schedule();
      } else {
        change(what === 'next' ? 1 : -1, true);
      }
    });
    // A mouse over the TV, or keyboard focus on its buttons, holds the channel. A tap or a click does not.
    var hover = false;
    var focused = false;
    var hold = function () { held = hover || focused; schedule(); };
    tv.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') { hover = true; hold(); } });
    tv.addEventListener('pointerleave', function () { hover = false; hold(); });
    tv.addEventListener('focusin', function (e) {
      try { focused = e.target.matches(':focus-visible'); } catch (err) { focused = true; }
      hold();
    });
    tv.addEventListener('focusout', function (e) {
      if (!tv.contains(e.relatedTarget)) { focused = false; hold(); }
    });
    document.addEventListener('visibilitychange', schedule);

    if (!visible) {
      // Dark until the TV is on screen, then it switches on.
      if (!reduceMotion) tv.classList.add('is-dark');
      new IntersectionObserver(function (entries) {
        visible = entries[0].intersectionRatio >= 0.3;
        if (visible && !seen) {
          seen = true;
          warm(0);
          warm(1);
          if (reduceMotion) { osd(); schedule(); return; }
          busy = true;
          setTimeout(function () {
            tv.classList.remove('is-dark');
            tv.classList.add('is-on');
            osd();
            setTimeout(function () { tv.classList.remove('is-on'); busy = false; schedule(); }, ON);
          }, 250);
          return;
        }
        schedule();
      }, { threshold: [0, 0.3] }).observe(tv);
    } else {
      warm(1);
      osd();
      schedule();
    }

    stopTv = function () {
      stopped = true;
      clearTimeout(timer);
      tv.classList.remove('osd-on', 'is-rec');
      tv.classList.add('is-video');
      controls.hidden = true;
    };
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
        stopTv(); // the TV stays on the video from now on
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
