// ============================================
// NŪR — PWA Install + Service Worker
// ============================================

(function () {
  // Register service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  const installBtn = document.getElementById('install-btn');
  let deferredPrompt = null;

  // Hide button if already installed (display-mode standalone)
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (isStandalone()) {
    installBtn?.setAttribute('hidden', '');
    return;
  }

  // Chromium: beforeinstallprompt gives us a programmatic installer
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    if (installBtn) installBtn.hidden = true;
    try { if (typeof ui !== 'undefined') ui.showToast(i18n.t('installApp') + ' ✓', 'success', 2500); } catch (_) {}
  });

  installBtn?.addEventListener('click', async () => {
    // iOS: no prompt API. Show manual hint.
    if (!deferredPrompt) {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      if (isIOS) {
        showIOSHint();
        return;
      }
      installBtn.hidden = true;
      return;
    }
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } finally {
      deferredPrompt = null;
      installBtn.hidden = true;
    }
  });

  function showIOSHint() {
    if (document.getElementById('ios-install-hint')) return;
    const modal = document.createElement('div');
    modal.id = 'ios-install-hint';
    modal.className = 'ios-install-hint';
    modal.innerHTML = `
      <div class="ios-install-card" role="dialog" aria-modal="true">
        <button class="ios-install-close" aria-label="Close">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
        <img src="logo.png" alt="" class="ios-install-logo">
        <h3>NŪR</h3>
        <p>${escapeHtml(i18n.t('installHint'))}</p>
        <ol>
          <li>Tap <strong>Share</strong> <span aria-hidden="true">⎋</span></li>
          <li>Scroll &amp; tap <strong>Add to Home Screen</strong></li>
          <li>Tap <strong>Add</strong></li>
        </ol>
      </div>
    `;
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('.ios-install-close')) modal.remove();
    });
    document.body.appendChild(modal);
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }
})();
