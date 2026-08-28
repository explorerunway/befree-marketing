// The vendor sends full URLs and persists visitor IDs. Keep it separate from
// Vercel's cookie-free measurement: explicit consent, public pages only, and a
// transport gate that also covers navigation and the final page-leave event.
export const FASTLANE_SCRIPT = 'https://aromatic-caribou-889.convex.site/api/a/am_dQ1of6oJtd8eYQpA';
export const FASTLANE_ORIGIN = new URL(FASTLANE_SCRIPT).origin;
export const CONSENT_KEY = 'befree-fastlane-consent-v1';
export const TRACKER_KEYS = ['am_vid', 'am_sid', 'am_st'];
const SITE_ORIGIN = 'https://heybefree.app';
const CONTROLLER_KEY = '__befreeFastlaneConsentV1';
const PATHS = new Set(['/', '/pricing', '/mac', '/android', '/adhd']);
const HASHES = new Set(['', '#website-analytics', '#try', '#features', '#connects', '#download', '#tiers', '#become-tester']);
const CAMPAIGN_LIMITS = { ref: 32, utm_source: 64, utm_medium: 32, utm_campaign: 64, utm_content: 64, utm_term: 64 };

function safeUrlParts(url) {
  if (url.username || url.password || url.href.length > 1024 || !HASHES.has(url.hash)) return false;
  const seen = new Set();
  for (const [name, value] of url.searchParams) {
    const limit = Object.hasOwn(CAMPAIGN_LIMITS, name) ? CAMPAIGN_LIMITS[name] : 0;
    if (!limit || seen.has(name) || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) || value.length > limit) return false;
    seen.add(name);
  }
  return true;
}

export function safeMarketingUrl(value) {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/(.)\/$/, '$1');
    return url.origin === SITE_ORIGIN && PATHS.has(path) && safeUrlParts(url);
  } catch {
    // Unknown URLs are excluded, never repaired and sent to the provider.
    return false;
  }
}

export function safeReferrer(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    if (url.origin === SITE_ORIGIN) return safeMarketingUrl(value);
    // Cross-origin referrers normally contain just the origin. A private path,
    // search query or fragment from another site cannot be safely classified.
    return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

function safeLocalPreview(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !url.username && !url.password && safeMarketingUrl(`${SITE_ORIGIN}${url.pathname}${url.search}${url.hash}`);
  } catch {
    return false;
  }
}

export function privacySignal(win) {
  const nav = win.navigator;
  return nav.globalPrivacyControl === true || [nav.doNotTrack, nav.msDoNotTrack, win.doNotTrack]
    .some((value) => value === '1' || value === 'yes');
}

export function createFastlaneAnalytics(win, onChange = () => {}) {
  if (win[CONTROLLER_KEY]) return win[CONTROLLER_KEY];
  let requested = false;
  let loaded = false;
  let forcedOff = false;
  let suspended = false;
  let error = '';

  function choice() {
    if (forcedOff) return 'denied';
    try {
      const value = win.localStorage.getItem(CONSENT_KEY);
      return value === 'granted' || value === 'denied' ? value : 'unknown';
    } catch {
      // No readable choice (including private-browsing storage failures) is off.
      return 'unknown';
    }
  }

  function contextBlock() {
    if (privacySignal(win)) return 'privacy';
    if (safeLocalPreview(win.location.href)) return 'preview';
    if (!safeMarketingUrl(win.location.href)) return 'address';
    if (!safeReferrer(win.document.referrer)) return 'referrer';
    return null;
  }

  function state() {
    return { choice: choice(), block: contextBlock() || (suspended ? 'suspended' : null), requested, loaded, error };
  }

  const notify = () => onChange(state());

  function canSend() {
    if (forcedOff || suspended || choice() !== 'granted') return false;
    if (contextBlock()) {
      // Stay off for the rest of this document. A later safe URL must not let
      // the vendor send a queued page-leave containing the earlier unsafe URL.
      suspended = true;
      notify();
      return false;
    }
    return true;
  }

  function isTrackerRequest(input) {
    try {
      const value = typeof input === 'string' || input instanceof URL ? input : input.url;
      return new URL(value, win.location.href).origin === FASTLANE_ORIGIN;
    } catch {
      // Leave unrelated/invalid requests to the native API's normal handling.
      return false;
    }
  }

  function guardTransports() {
    try {
      if (typeof win.fetch === 'function') {
        const originalFetch = win.fetch.bind(win);
        const guardedFetch = (input, init) => {
          if (isTrackerRequest(input) && !canSend()) {
            // Acknowledge a locally discarded optional event to avoid retries.
            return Promise.resolve(new win.Response(null, { status: 204 }));
          }
          return originalFetch(input, init);
        };
        win.fetch = guardedFetch;
        if (win.fetch !== guardedFetch) throw new Error('fetch is not writable');
      }
      if (typeof win.navigator.sendBeacon === 'function') {
        const originalBeacon = win.navigator.sendBeacon.bind(win.navigator);
        const guardedBeacon = (url, data) => {
          if (isTrackerRequest(url) && !canSend()) return true;
          return originalBeacon(url, data);
        };
        win.navigator.sendBeacon = guardedBeacon;
        if (win.navigator.sendBeacon !== guardedBeacon) throw new Error('sendBeacon is not writable');
      }
      return true;
    } catch {
      error = 'Fastlane stays off because this browser could not protect analytics requests.';
      console.warn('[Fastlane analytics] Transport protection unavailable; tracker not loaded.');
      return false;
    }
  }

  function load() {
    if (requested || error || !canSend() || !guardTransports()) return;
    const script = win.document.createElement('script');
    script.id = 'befree-fastlane-tracker';
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.src = FASTLANE_SCRIPT;
    script.addEventListener('load', () => {
      loaded = true;
      notify();
    });
    script.addEventListener('error', () => {
      error = 'Your choice is saved, but Fastlane could not load. It may be blocked by your browser.';
      console.warn('[Fastlane analytics] Tracker could not load.');
      notify();
    });
    try {
      requested = true;
      win.document.head.appendChild(script);
    } catch {
      error = 'Fastlane stays off because this browser could not load its script.';
      console.warn('[Fastlane analytics] Tracker insertion failed.');
    }
  }

  function clearTrackerStorage() {
    for (const key of TRACKER_KEYS) {
      try {
        win.localStorage.removeItem(key);
      } catch {
        console.warn('[Fastlane analytics] Browser could not clear a tracker identifier.');
      }
    }
  }

  function choose(allow) {
    if (allow && privacySignal(win)) return notify();
    forcedOff = !allow; // Block page-leave immediately, even if persistence fails.
    error = '';
    let saved = false;
    try {
      win.localStorage.setItem(CONSENT_KEY, allow ? 'granted' : 'denied');
      saved = win.localStorage.getItem(CONSENT_KEY) === (allow ? 'granted' : 'denied');
    } catch {
      console.warn('[Fastlane analytics] Browser could not save analytics preference.');
    }
    if (!saved) {
      forcedOff = true;
      error = 'Fastlane is off on this page. Your browser could not save the choice; clear this site’s browser data to keep it off on future visits.';
    }
    if (!allow || !saved) clearTrackerStorage();
    if (allow && saved) load();
    notify();
    // Removing a script element cannot undo its listeners or history patches.
    // Reload only after a saved refusal, so an old saved grant cannot restart it.
    if (!allow && saved && requested) win.location.reload();
  }

  win.addEventListener('storage', (event) => {
    if (event.key !== CONSENT_KEY && event.key !== null) return;
    if (choice() !== 'granted') {
      forcedOff = true;
      clearTrackerStorage();
      if (requested) win.location.reload();
    }
    notify();
  });
  for (const name of ['focus', 'pageshow', 'popstate', 'hashchange']) {
    win.addEventListener(name, () => {
      if (requested) canSend();
      notify();
    });
  }
  const controller = { state, choose };
  win[CONTROLLER_KEY] = controller;
  // A script already in flight at revocation can finish while the old document
  // unloads. Clean up only its keys on the next page with a saved refusal.
  if (choice() === 'denied') clearTrackerStorage();
  load();
  notify();
  return controller;
}

export function initFastlaneAnalytics(win) {
  const details = win.document.getElementById('website-analytics');
  if (!details) return;
  const prompt = win.document.getElementById('fastlane-consent-prompt');
  const roots = [details, prompt].filter(Boolean);
  const statuses = roots.flatMap((root) => Array.from(root.querySelectorAll('[data-analytics-status]')));
  const allows = roots.flatMap((root) => Array.from(root.querySelectorAll('[data-analytics-allow]')));
  const denies = roots.flatMap((root) => Array.from(root.querySelectorAll('[data-analytics-deny]')));
  const controller = createFastlaneAnalytics(win, ({ choice, block, requested, loaded, error }) => {
    details.dataset.fastlaneState = error ? 'error' : block ? 'blocked' : loaded ? 'loaded' : requested ? 'loading' : 'off';
    if (prompt) prompt.hidden = choice !== 'unknown' || (block !== null && block !== 'preview');
    for (const allow of allows) allow.disabled = block === 'privacy' || choice === 'granted';
    for (const deny of denies) deny.disabled = false;
    const blocks = {
      privacy: 'Fastlane is off because your browser requests Do Not Track or Global Privacy Control.',
      preview: 'Fastlane stays off in this preview. You can test the choice here without sending visitor data.',
      address: 'Fastlane stays off on this address to protect private URL information.',
      referrer: 'Fastlane stays off on this visit to protect information in the referring URL.',
      suspended: 'Fastlane is paused for this page after its address changed. A fresh visit to a regular marketing page can resume it.',
    };
    const message = error || (block ? blocks[block] : choice === 'granted'
      ? loaded ? 'Fastlane analytics are allowed and the tracker has loaded in this browser.' : 'Your choice is saved. Fastlane is loading.'
      : choice === 'denied' ? 'Fastlane analytics are off in this browser.' : 'Fastlane analytics are off until you allow them.');
    for (const status of statuses) status.textContent = message;
  });
  for (const allow of allows) allow.addEventListener('click', () => controller.choose(true));
  for (const deny of denies) deny.addEventListener('click', () => controller.choose(false));
  if (win.location.hash === '#website-analytics') details.open = true;
}
