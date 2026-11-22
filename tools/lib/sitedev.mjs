/**
 * The dev client the preview server injects into served pages, kept as strings so `tools/` stays
 * all `.mjs`. Both files are same-origin and CSP-clean: no inline `<style>`, no `style=""` markup.
 * The JS template has no backticks, `${` or backslashes, so it reaches the browser as written.
 */

/** `/rebeep/__dev/dev.js`: live reload on the server's `reload` event, and the font-trial switcher. */
export const DEV_JS = `(function () {
  'use strict';

  var EVENTS_URL = '/rebeep/__dev/events';
  var TRIAL_URL = '/rebeep/fonts/trial/';
  var STORAGE_KEY = 'rebeep-dev-font';

  var source = new EventSource(EVENTS_URL);
  source.addEventListener('reload', function () {
    location.reload();
  });

  function readSaved() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return null;
    }
  }

  function save(key) {
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch (err) {
      /* storage is blocked: the choice just will not persist */
    }
  }

  async function loadFontTrial() {
    var fonts;
    try {
      var res = await fetch(TRIAL_URL + 'fonts.json', { cache: 'no-store' });
      if (!res.ok) return;
      fonts = await res.json();
    } catch (err) {
      return;
    }
    if (!Array.isArray(fonts)) return;
    fonts = fonts.filter(function (font) {
      return font && typeof font.key === 'string' && font.key !== '' && font.key !== '0' && typeof font.name === 'string';
    });
    if (fonts.length === 0) return;

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = TRIAL_URL + 'trial.css';
    document.head.appendChild(link);

    var panel = document.createElement('div');
    panel.className = 'rebeep-dev-fonts';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', 'Font trial (dev only)');
    var title = document.createElement('div');
    title.className = 'rebeep-dev-fonts__title';
    title.textContent = 'dev · font trial';
    panel.appendChild(title);

    var buttons = new Map();
    function select(key, persist) {
      if (key === '0') delete document.documentElement.dataset.font;
      else document.documentElement.dataset.font = key;
      buttons.forEach(function (button, buttonKey) {
        button.classList.toggle('is-active', buttonKey === key);
        button.setAttribute('aria-pressed', String(buttonKey === key));
      });
      if (persist) save(key);
    }

    fonts.concat([{ key: '0', name: 'fallback' }]).forEach(function (font) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'rebeep-dev-fonts__item';
      button.textContent = font.key + ' · ' + font.name;
      button.addEventListener('click', function () {
        select(font.key, true);
      });
      buttons.set(font.key, button);
      panel.appendChild(button);
    });
    document.body.appendChild(panel);

    var saved = readSaved();
    select(buttons.has(saved) ? saved : fonts[0].key, false);

    document.addEventListener('keydown', function (event) {
      if (event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return;
      var active = document.activeElement;
      if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return;
      if (buttons.has(event.key)) select(event.key, true);
    });
  }

  loadFontTrial();
})();
`;

/** `/rebeep/__dev/dev.css`: the font-trial panel, clearly dev-only and isolated from the page's styles. */
export const DEV_CSS = `.rebeep-dev-fonts {
  all: initial;
  position: fixed;
  right: 12px;
  bottom: 12px;
  z-index: 2147483647;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 176px;
  padding: 8px;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #f0f0f0;
  background: rgba(16, 16, 16, 0.94);
  border: 1px dashed #b0b090;
  border-radius: 6px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.55);
}

.rebeep-dev-fonts__title {
  padding: 0 4px 4px;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #b0b090;
}

.rebeep-dev-fonts__item {
  all: unset;
  box-sizing: border-box;
  padding: 3px 6px;
  border-radius: 3px;
  color: #f0f0f0;
  cursor: pointer;
}

.rebeep-dev-fonts__item:hover {
  background: rgba(240, 240, 240, 0.12);
}

.rebeep-dev-fonts__item:focus-visible {
  outline: 2px solid #70d030;
  outline-offset: 1px;
}

.rebeep-dev-fonts__item.is-active {
  color: #101010;
  background: #50d010;
}

@media print {
  .rebeep-dev-fonts {
    display: none;
  }
}
`;
