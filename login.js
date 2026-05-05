/*! TN Login — shared across index + all 8 templates.
 *
 *  Tiny module that handles:
 *    • Login modal (3-letter A-Z nick, no password yet)
 *    • Top-bar nick badge with logout dropdown
 *    • localStorage persistence under 'tn_user_nick'
 *    • Public API: TNLogin.getNick(), TNLogin.requireLogin(), TNLogin.logout()
 *
 *  Use:
 *    <link rel="stylesheet" href="login.css"> (or include the CSS inline)
 *    <script src="login.js"></script>
 *    <script>
 *      // In index.html: enforce login before showing UI
 *      TNLogin.requireLogin().then(nick => { ... });
 *
 *      // In template HTML: show badge, but don't block UI
 *      TNLogin.attachBadge();
 *    </script>
 *
 *  No password yet — this is intentional. Real auth comes later.
 */
(function (window) {
  'use strict';

  const LS_KEY = 'tn_user_nick';
  const NICK_RE = /^[A-Z]{3}$/;

  // ============================================================
  // Style — injected once into <head>. Designed to match TN red theme.
  // ============================================================
  const CSS = `
.tn-login-overlay {
  position: fixed; inset: 0; z-index: 100000;
  background: rgba(0,0,0,0.92);
  display: none;
  align-items: center; justify-content: center;
  backdrop-filter: blur(4px);
}
.tn-login-overlay.open { display: flex; }
.tn-login-panel {
  background: #141414;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px;
  padding: 36px 44px;
  min-width: 380px; max-width: 460px;
  color: #fff;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0,0,0,0.6);
}
.tn-login-title {
  font-family: 'Organica', sans-serif;
  font-weight: 600;
  font-size: 18px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #DC0F2E;
  margin-bottom: 8px;
}
.tn-login-sub {
  font-size: 13px;
  color: rgba(255,255,255,0.6);
  margin-bottom: 28px;
}
.tn-login-input {
  font-family: 'Organica', 'Courier New', monospace;
  font-size: 38px;
  font-weight: 600;
  letter-spacing: 0.4em;
  text-align: center;
  text-transform: uppercase;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.15);
  color: #fff;
  border-radius: 8px;
  padding: 16px 20px 16px 36px;  /* extra left to balance the letter-spacing */
  width: 200px;
  outline: none;
  transition: border-color 150ms;
}
.tn-login-input:focus {
  border-color: #DC0F2E;
}
.tn-login-input.invalid {
  border-color: #DC0F2E;
  animation: tnLoginShake 250ms;
}
@keyframes tnLoginShake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-6px); }
  75% { transform: translateX(6px); }
}
.tn-login-error {
  font-size: 12px;
  color: #DC0F2E;
  min-height: 16px;
  margin-top: 8px;
}
.tn-login-actions {
  margin-top: 24px;
}
.tn-login-btn {
  background: #DC0F2E;
  color: #fff;
  border: none;
  padding: 12px 32px;
  border-radius: 6px;
  font-family: 'Organica', sans-serif;
  font-weight: 500;
  font-size: 13px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 150ms;
}
.tn-login-btn:hover { background: #b80825; }
.tn-login-btn:disabled {
  opacity: 0.4; cursor: not-allowed;
}

/* ===== Top-bar nick badge ===== */
.tn-nick-badge {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'Organica', 'Courier New', monospace;
  font-weight: 500;
  font-size: 12px;
  letter-spacing: 0.1em;
  color: rgba(255,255,255,0.85);
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 4px;
  padding: 6px 10px 6px 12px;
  cursor: pointer;
  user-select: none;
  transition: background 150ms, border-color 150ms;
}
.tn-nick-badge:hover {
  background: rgba(255,255,255,0.1);
  border-color: rgba(255,255,255,0.2);
}
.tn-nick-badge .nick {
  font-weight: 600;
  letter-spacing: 0.15em;
  color: #fff;
}
.tn-nick-badge .arrow {
  font-size: 9px;
  color: rgba(255,255,255,0.5);
  margin-left: 2px;
}
.tn-nick-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 140px;
  background: #1a1a1a;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  padding: 4px;
  display: none;
  z-index: 1000;
  box-shadow: 0 8px 20px rgba(0,0,0,0.5);
}
.tn-nick-menu.open { display: block; }
.tn-nick-menu button {
  display: block; width: 100%;
  background: transparent; border: none;
  color: rgba(255,255,255,0.85);
  text-align: left;
  font-family: inherit;
  font-size: 12px;
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 100ms;
}
.tn-nick-menu button:hover { background: rgba(255,255,255,0.08); }
.tn-nick-menu button.danger { color: #ff6178; }
.tn-nick-menu button.danger:hover { background: rgba(220,15,46,0.1); color: #ff8090; }
`;

  function injectCss() {
    if (document.getElementById('tn-login-css')) return;
    const style = document.createElement('style');
    style.id = 'tn-login-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ============================================================
  // Storage helpers
  // ============================================================
  function getNick() {
    try {
      const n = localStorage.getItem(LS_KEY);
      if (n && NICK_RE.test(n)) return n;
    } catch (_) {}
    return null;
  }
  function setNick(nick) {
    try { localStorage.setItem(LS_KEY, nick); } catch (_) {}
  }
  function clearNick() {
    try { localStorage.removeItem(LS_KEY); } catch (_) {}
  }

  // ============================================================
  // Login modal — returns Promise that resolves with the entered nick
  // ============================================================
  function showLoginModal(opts) {
    opts = opts || {};
    injectCss();
    return new Promise((resolve) => {
      let overlay = document.getElementById('tn-login-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'tn-login-overlay';
        overlay.className = 'tn-login-overlay';
        overlay.innerHTML = `
          <div class="tn-login-panel">
            <div class="tn-login-title">${opts.title || 'Přihlášení'}</div>
            <div class="tn-login-sub">${opts.sub || 'Zadej svůj 3-písmenný nick (A–Z)'}</div>
            <input type="text" id="tn-login-input" class="tn-login-input"
                   maxlength="3" autocomplete="off" autocapitalize="characters"
                   spellcheck="false" />
            <div class="tn-login-error" id="tn-login-error"></div>
            <div class="tn-login-actions">
              <button class="tn-login-btn" id="tn-login-btn">Přihlásit</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
      }
      const input  = document.getElementById('tn-login-input');
      const btn    = document.getElementById('tn-login-btn');
      const errEl  = document.getElementById('tn-login-error');

      function showError(msg) {
        errEl.textContent = msg || '';
        input.classList.add('invalid');
        setTimeout(() => input.classList.remove('invalid'), 300);
      }
      function attempt() {
        const v = (input.value || '').toUpperCase().trim();
        if (!NICK_RE.test(v)) {
          showError('Nick musí být přesně 3 písmena A–Z');
          return;
        }
        setNick(v);
        overlay.classList.remove('open');
        // Tear down listeners
        input.removeEventListener('keydown', onKey);
        btn.removeEventListener('click', attempt);
        resolve(v);
      }
      function onKey(e) {
        // Force uppercase as user types
        const start = input.selectionStart;
        input.value = input.value.toUpperCase().replace(/[^A-Z]/g, '');
        input.setSelectionRange(start, start);
        if (e.key === 'Enter') {
          e.preventDefault();
          attempt();
        }
      }

      input.value = '';
      errEl.textContent = '';
      input.addEventListener('keydown', onKey);
      input.addEventListener('input', onKey);
      btn.addEventListener('click', attempt);

      overlay.classList.add('open');
      setTimeout(() => input.focus(), 50);
    });
  }

  // ============================================================
  // requireLogin — open modal if no nick stored, resolve otherwise
  // ============================================================
  async function requireLogin(opts) {
    const existing = getNick();
    if (existing) return existing;
    return await showLoginModal(opts);
  }

  // ============================================================
  // Top-bar badge — small "JAZ ▾" pill with logout menu
  // ============================================================
  function attachBadge(container, opts) {
    injectCss();
    opts = opts || {};
    container = container || document.body;

    // Create badge if not present
    let badge = document.getElementById('tn-nick-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'tn-nick-badge';
      badge.className = 'tn-nick-badge';
      badge.innerHTML = `
        <span class="nick" id="tn-nick-text">—</span>
        <span class="arrow">▾</span>
        <div class="tn-nick-menu" id="tn-nick-menu">
          <button data-act="change">Změnit nick</button>
          <button data-act="logout" class="danger">Odhlásit</button>
        </div>
      `;
      container.appendChild(badge);
    }
    refreshBadge();

    const menu = document.getElementById('tn-nick-menu');
    if (!badge._wired) {
      badge._wired = true;
      badge.addEventListener('click', (e) => {
        // Don't toggle if clicking a menu button
        if (e.target.closest('button')) return;
        menu.classList.toggle('open');
      });
      // Close menu on outside click
      document.addEventListener('click', (e) => {
        if (!badge.contains(e.target)) menu.classList.remove('open');
      });
      menu.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', async () => {
          menu.classList.remove('open');
          if (b.dataset.act === 'logout') {
            if (!confirm('Opravdu se odhlásit?')) return;
            clearNick();
            // Re-prompt on logout (else app has no nick context)
            const newNick = await showLoginModal();
            refreshBadge();
            if (opts.onChange) opts.onChange(newNick);
          } else if (b.dataset.act === 'change') {
            const newNick = await showLoginModal({ sub: 'Zadej nový 3-písmenný nick' });
            refreshBadge();
            if (opts.onChange) opts.onChange(newNick);
          }
        });
      });
    }
    return badge;
  }

  function refreshBadge() {
    const text = document.getElementById('tn-nick-text');
    if (text) text.textContent = getNick() || '—';
  }

  // ============================================================
  // Public API
  // ============================================================
  window.TNLogin = {
    getNick,
    setNick,
    clearNick,
    requireLogin,
    showLoginModal,
    attachBadge,
    refreshBadge,
  };
})(window);
