// ============================================
// NŪR — PWA Install + Service Worker
// ============================================

(function () {
  // Register service worker (HTTPS or localhost only)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  const installBtn = document.getElementById('install-btn');
  if (!installBtn) return;

  let deferredPrompt = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  // Hide when already installed
  if (isStandalone()) {
    installBtn.setAttribute('hidden', '');
    return;
  }

  // Device / browser detection for correct hint
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isFirefox = /Firefox/i.test(ua) || /FxiOS/i.test(ua);
  const isSamsung = /SamsungBrowser/i.test(ua);
  // iOS has WebKit-wrapped third-party browsers that CANNOT install PWAs —
  // only real Safari can. Detect them so we tell the user to switch.
  const iOSChrome  = isIOS && /CriOS/i.test(ua);
  const iOSFirefox = isIOS && /FxiOS/i.test(ua);
  const iOSEdge    = isIOS && /EdgiOS/i.test(ua);
  const iOSOther   = isIOS && (iOSChrome || iOSFirefox || iOSEdge);

  // Chromium: beforeinstallprompt gives us a programmatic installer
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.classList.add('is-native'); // visual tweak for native prompt
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installBtn.setAttribute('hidden', '');
    try {
      if (typeof ui !== 'undefined') ui.showToast(i18n.t('installApp') + ' ✓', 'success', 2500);
    } catch (_) {}
  });

  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try {
        await deferredPrompt.userChoice;
      } finally {
        deferredPrompt = null;
      }
      return;
    }
    // Fallback: instruction modal (always works)
    showInstallHint();
  });

  function showInstallHint() {
    const existing = document.getElementById('install-hint');
    if (existing) { existing.remove(); return; }

    const { title, steps = [], note } = buildInstructions() || {};

    const modal = document.createElement('div');
    modal.id = 'install-hint';
    modal.className = 'ios-install-hint';
    modal.innerHTML = `
      <div class="ios-install-card" role="dialog" aria-modal="true" aria-labelledby="install-hint-title">
        <button class="ios-install-close" aria-label="Close">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
        <img src="logo.png" alt="" class="ios-install-logo">
        <h3 id="install-hint-title">${esc(title)}</h3>
        <p>${esc(i18n.t('installHint'))}</p>
        <ol>
          ${steps.map((s) => `<li>${s}</li>`).join('')}
        </ol>
        ${note ? `<p class="ios-install-note">${esc(note)}</p>` : ''}
      </div>
    `;
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('.ios-install-close')) modal.remove();
    });
    document.body.appendChild(modal);
  }

  function buildInstructions() {
    // Every string comes from i18n, so the card speaks the language the user
    // picked rather than defaulting to Russian.
    if (iOSOther) {
      const browser = iOSChrome ? 'Chrome' : iOSFirefox ? 'Firefox' : 'Edge';
      const t = i18n.install('iosAlt');
      return { ...t, title: String(t.title).replace('{browser}', browser) };
    }
    if (isIOS) return i18n.install('ios');
    if (isSamsung) return i18n.install('samsung');
    if (isFirefox && isAndroid) return i18n.install('ffAndroid');
    if (isFirefox) return i18n.install('ffDesktop');
    if (isAndroid) return i18n.install('android');
    return i18n.install('desktop');
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );
  }
})();
