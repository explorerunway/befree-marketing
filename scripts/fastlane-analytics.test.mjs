import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONSENT_KEY, FASTLANE_ORIGIN, FASTLANE_SCRIPT, TRACKER_KEYS,
  createFastlaneAnalytics, initFastlaneAnalytics, safeMarketingUrl, safeReferrer,
} from '../src/lib/fastlane-analytics.js';

const EVENTS = FASTLANE_ORIGIN + '/api/v1/events/';

function browser({ href = 'https://heybefree.app/', referrer = '', consent, dnt, gpc, failWrites = false, failReads = false, ui = false } = {}) {
  const storage = new Map(consent ? [[CONSENT_KEY, consent]] : []);
  const writes = [];
  const requests = [];
  const scripts = [];
  let reloads = 0;
  const win = new EventTarget();
  win.Response = Response;
  win.location = { href, get hash() { return new URL(this.href).hash; }, reload() { reloads += 1; } };
  win.localStorage = {
    getItem(key) { if (failReads) throw new Error('storage blocked'); return storage.get(key) ?? null; },
    setItem(key, value) { if (failWrites) throw new Error('storage blocked'); writes.push(['set', key, value]); storage.set(key, value); },
    removeItem(key) { if (failWrites) throw new Error('storage blocked'); writes.push(['remove', key]); storage.delete(key); },
  };
  win.fetch = function (input, init) {
    assert.equal(this, win);
    requests.push(['fetch', input, init]);
    return Promise.resolve(new Response(null, { status: 202 }));
  };
  win.navigator = {
    doNotTrack: dnt,
    globalPrivacyControl: gpc,
    sendBeacon(url, data) { assert.equal(this, win.navigator); requests.push(['beacon', url, data]); return false; },
  };
  function controls() {
    const status = { textContent: '' };
    const allow = new EventTarget();
    const deny = new EventTarget();
    return {
      dataset: {}, status, allow, deny, hidden: true, open: false,
      querySelectorAll(selector) {
        return [{
          '[data-analytics-status]': status,
          '[data-analytics-allow]': allow,
          '[data-analytics-deny]': deny,
        }[selector]].filter(Boolean);
      },
    };
  }
  const details = ui ? controls() : null;
  const prompt = ui ? controls() : null;
  win.document = {
    referrer,
    createElement(tag) { assert.equal(tag, 'script'); return new EventTarget(); },
    head: { appendChild(script) { scripts.push(script); } },
    getElementById(id) { return id === 'website-analytics' ? details : id === 'fastlane-consent-prompt' ? prompt : null; },
  };
  return { win, storage, writes, requests, scripts, details, prompt, get reloads() { return reloads; } };
}

test('only public paths, known anchors and bounded campaign labels are safe', () => {
  for (const url of [
    'https://heybefree.app/', 'https://heybefree.app/index.html',
    'https://heybefree.app/pricing.html', 'https://heybefree.app/mac/',
    'https://heybefree.app/adhd?ref=TT-SPRING&utm_source=instagram&utm_medium=social&utm_campaign=august-2026',
    'https://heybefree.app/#features', 'https://heybefree.app/#download',
    'https://heybefree.app/#website-analytics', 'https://heybefree.app/android#become-tester',
  ]) assert.equal(safeMarketingUrl(url), true, url);
  for (const url of [
    'not-a-url', 'http://heybefree.app/', 'https://app.heybefree.app/',
    'https://heybefree.app/private/person-name', 'https://heybefree.app/404',
    'https://heybefree.app/?code=private', 'https://heybefree.app/?email=name%40example.com',
    'https://heybefree.app/#access_token=private', 'https://heybefree.app/#unknown',
    'https://heybefree.app/?ref=A&ref=B', 'https://heybefree.app/?utm_campaign=name%40example.com',
    'https://heybefree.app/?utm_term=free%20text', 'https://heybefree.app/?utm_source=',
    'https://heybefree.app/?ref=' + 'A'.repeat(33),
    'https://heybefree.app/?utm_campaign=' + 'A'.repeat(65),
    'https://heybefree.app/?constructor=value', 'https://heybefree.app/?__proto__=value',
    'https://name:secret@heybefree.app/',
  ]) assert.equal(safeMarketingUrl(url), false, url);
});

test('referrers with private paths, queries or fragments are excluded', () => {
  for (const referrer of ['', 'https://www.instagram.com/', 'https://app.heybefree.app/', 'https://heybefree.app/pricing?ref=TT-SPRING']) {
    assert.equal(safeReferrer(referrer), true, referrer);
  }
  for (const referrer of ['https://example.com/private/name', 'https://example.com/?q=private', 'https://example.com/#token', 'https://heybefree.app/?code=private', 'https://user:password@example.com/', 'http://example.com/', 'invalid']) {
    assert.equal(safeReferrer(referrer), false, referrer);
  }
});

test('no choice means no script, storage writes or network wrappers', () => {
  const b = browser();
  const originalFetch = b.win.fetch;
  const originalBeacon = b.win.navigator.sendBeacon;
  const controller = createFastlaneAnalytics(b.win);
  assert.equal(controller.state().choice, 'unknown');
  assert.deepEqual(b.scripts, []);
  assert.deepEqual(b.writes, []);
  assert.deepEqual(b.requests, []);
  assert.equal(b.win.fetch, originalFetch);
  assert.equal(b.win.navigator.sendBeacon, originalBeacon);
});

test('allow persists explicit consent and requests the async head script only once', () => {
  const b = browser();
  const controller = createFastlaneAnalytics(b.win);
  controller.choose(true);
  controller.choose(true);
  assert.equal(createFastlaneAnalytics(b.win), controller);
  assert.equal(b.storage.get(CONSENT_KEY), 'granted');
  assert.equal(b.scripts.length, 1);
  assert.equal(b.scripts[0].src, FASTLANE_SCRIPT);
  assert.equal(b.scripts[0].async, true);
  assert.equal(b.scripts[0].referrerPolicy, 'no-referrer');
  assert.equal(controller.state().loaded, false);
  b.scripts[0].dispatchEvent(new Event('load'));
  assert.equal(controller.state().loaded, true);
});

test('saved grants load, while saved refusals clean only leftover tracker identifiers', () => {
  const allowed = browser({ consent: 'granted' });
  createFastlaneAnalytics(allowed.win);
  assert.equal(allowed.scripts.length, 1);
  assert.deepEqual(allowed.writes, []);
  const denied = browser({ consent: 'denied' });
  for (const key of TRACKER_KEYS) denied.storage.set(key, 'old-value');
  denied.storage.set('campaign-ref', 'KEEP-ME');
  createFastlaneAnalytics(denied.win);
  assert.equal(denied.scripts.length, 0);
  for (const key of TRACKER_KEYS) assert.equal(denied.storage.has(key), false);
  assert.equal(denied.storage.get('campaign-ref'), 'KEEP-ME');
  assert.equal(denied.storage.get(CONSENT_KEY), 'denied');
});

test('DNT and GPC cannot be overridden by a saved grant or Allow action', () => {
  for (const options of [{ dnt: '1' }, { dnt: 'yes' }, { gpc: true }]) {
    const b = browser({ consent: 'granted', ...options });
    const controller = createFastlaneAnalytics(b.win);
    controller.choose(true);
    assert.equal(controller.state().block, 'privacy');
    assert.deepEqual(b.scripts, []);
    assert.deepEqual(b.writes, []);
  }
});

test('sensitive URLs, unsafe referrers and nonproduction hosts never load the vendor', () => {
  for (const options of [
    { href: 'https://heybefree.app/?code=private' },
    { href: 'https://heybefree.app/#access_token=private' },
    { href: 'https://heybefree.app/private/path' },
    { href: 'https://app.heybefree.app/' },
    { href: 'http://127.0.0.1:4323/' },
    { href: 'https://preview.vercel.app/' },
    { referrer: 'https://heybefree.app/?token=private' },
    { referrer: 'https://example.com/private/path' },
  ]) {
    const b = browser({ consent: 'granted', ...options });
    createFastlaneAnalytics(b.win).choose(true);
    assert.deepEqual(b.scripts, [], JSON.stringify(options));
    assert.deepEqual(b.requests, [], JSON.stringify(options));
  }
});

test('transport wrappers preserve unrelated requests, return values, inputs and receivers', async () => {
  const b = browser({ consent: 'granted' });
  createFastlaneAnalytics(b.win);
  const init = { method: 'POST', body: 'test' };
  const response = await b.win.fetch('/api/unrelated', init);
  assert.equal(response.status, 202);
  assert.equal(b.requests[0][1], '/api/unrelated');
  assert.equal(b.requests[0][2], init);
  const data = new Blob(['test']);
  assert.equal(b.win.navigator.sendBeacon('https://example.com/events', data), false);
  assert.equal(b.requests[1][2], data);
  assert.equal(b.win.navigator.sendBeacon(EVENTS, data), false);
  assert.equal((await b.win.fetch(new Request(EVENTS), init)).status, 202);
  assert.equal(b.requests.length, 4);
});

test('unsafe navigation suspends all subsequent Fastlane sends, even after returning to a safe URL', async () => {
  const b = browser({ consent: 'granted' });
  const controller = createFastlaneAnalytics(b.win);
  b.win.location.href = 'https://heybefree.app/?code=private';
  assert.equal(b.win.navigator.sendBeacon(EVENTS, new Blob(['event'])), true);
  assert.equal(b.requests.length, 0);
  b.win.location.href = 'https://heybefree.app/';
  assert.equal((await b.win.fetch(new Request(EVENTS), { method: 'POST' })).status, 204);
  assert.equal(controller.state().block, 'suspended');
  assert.equal(b.requests.length, 0);
  await b.win.fetch('https://example.com/unrelated');
  assert.equal(b.requests.length, 1);
});

test('ordinary section anchors remain safe during a visit', () => {
  const b = browser({ consent: 'granted' });
  const controller = createFastlaneAnalytics(b.win);
  for (const hash of ['#features', '#download', '#website-analytics']) {
    b.win.location.href = 'https://heybefree.app/' + hash;
    b.win.dispatchEvent(new Event('hashchange'));
    assert.equal(controller.state().block, null);
    b.win.navigator.sendBeacon(EVENTS, 'event');
  }
  assert.equal(b.requests.length, 3);
});

test('a runtime browser privacy signal prevents sends immediately', async () => {
  const b = browser({ consent: 'granted' });
  createFastlaneAnalytics(b.win);
  b.win.navigator.globalPrivacyControl = true;
  assert.equal(b.win.navigator.sendBeacon(EVENTS, 'event'), true);
  assert.equal((await b.win.fetch(EVENTS)).status, 204);
  assert.equal(b.requests.length, 0);
});

test('revocation saves denial, clears only vendor keys and blocks unload events before reload', async () => {
  const b = browser({ consent: 'granted' });
  const controller = createFastlaneAnalytics(b.win);
  for (const key of TRACKER_KEYS) b.storage.set(key, 'old-value');
  b.storage.set('campaign-ref', 'KEEP-ME');
  controller.choose(false);
  assert.equal(b.storage.get(CONSENT_KEY), 'denied');
  for (const key of TRACKER_KEYS) assert.equal(b.storage.has(key), false);
  assert.equal(b.storage.get('campaign-ref'), 'KEEP-ME');
  assert.equal(b.reloads, 1);
  assert.equal(b.win.navigator.sendBeacon(EVENTS, 'page_leave'), true);
  assert.equal((await b.win.fetch(EVENTS)).status, 204);
  assert.equal(b.requests.length, 0);
});

test('revocation in another tab blocks pending events and reloads an active tracker', () => {
  const b = browser({ consent: 'granted' });
  createFastlaneAnalytics(b.win);
  b.storage.set(CONSENT_KEY, 'denied');
  const event = new Event('storage');
  Object.defineProperty(event, 'key', { value: CONSENT_KEY });
  b.win.dispatchEvent(event);
  assert.equal(b.reloads, 1);
  assert.equal(b.win.navigator.sendBeacon(EVENTS, 'page_leave'), true);
  assert.equal(b.requests.length, 0);
});

test('inaccessible storage, failed persistence and unwrappable transports fail closed', (t) => {
  t.mock.method(console, 'warn', () => {});
  const unreadable = browser({ consent: 'granted', failReads: true });
  createFastlaneAnalytics(unreadable.win);
  assert.equal(unreadable.scripts.length, 0);
  const unwritable = browser({ failWrites: true });
  const failed = createFastlaneAnalytics(unwritable.win);
  failed.choose(true);
  assert.equal(failed.state().choice, 'denied');
  assert.match(failed.state().error, /could not save/);
  assert.equal(unwritable.scripts.length, 0);
  for (const target of ['fetch', 'sendBeacon']) {
    const b = browser({ consent: 'granted' });
    const host = target === 'fetch' ? b.win : b.win.navigator;
    Object.defineProperty(host, target, { value: host[target], writable: false });
    const controller = createFastlaneAnalytics(b.win);
    assert.equal(b.scripts.length, 0);
    assert.match(controller.state().error, /could not protect/);
  }
});

test('a failed opt-out write never reloads into an old grant or sends another event', (t) => {
  t.mock.method(console, 'warn', () => {});
  const b = browser({ consent: 'granted', failWrites: true });
  const controller = createFastlaneAnalytics(b.win);
  controller.choose(false);
  assert.equal(controller.state().choice, 'denied');
  assert.match(controller.state().error, /off on this page/);
  assert.equal(b.reloads, 0);
  assert.equal(b.win.navigator.sendBeacon(EVENTS, 'page_leave'), true);
  assert.equal(b.requests.length, 0);
});

test('first-visit prompt is visible without a focus call, and choice dismisses it', () => {
  const b = browser({ ui: true });
  initFastlaneAnalytics(b.win);
  assert.equal(b.prompt.hidden, false);
  assert.equal(b.prompt.allow.disabled, false);
  assert.equal(b.details.dataset.fastlaneState, 'off');
  b.prompt.deny.dispatchEvent(new Event('click'));
  assert.equal(b.prompt.hidden, true);
  assert.equal(b.storage.get(CONSENT_KEY), 'denied');
  assert.equal(b.scripts.length, 0);
  b.details.allow.dispatchEvent(new Event('click'));
  assert.equal(b.details.dataset.fastlaneState, 'loading');
  assert.match(b.details.status.textContent, /loading/);
  b.scripts[0].dispatchEvent(new Event('load'));
  assert.equal(b.details.dataset.fastlaneState, 'loaded');
  assert.match(b.details.status.textContent, /tracker has loaded/);
});

test('load failure remains visibly distinct from a loaded tracker', (t) => {
  t.mock.method(console, 'warn', () => {});
  const b = browser({ ui: true, consent: 'granted' });
  initFastlaneAnalytics(b.win);
  b.scripts[0].dispatchEvent(new Event('error'));
  assert.equal(b.details.dataset.fastlaneState, 'error');
  assert.match(b.details.status.textContent, /could not load/);
});

test('privacy and unsafe production URLs suppress prompt; local preview is inactive', () => {
  for (const options of [{ dnt: '1' }, { gpc: true }, { href: 'https://heybefree.app/?token=private' }]) {
    const b = browser({ ui: true, ...options });
    initFastlaneAnalytics(b.win);
    assert.equal(b.prompt.hidden, true);
    assert.equal(b.details.dataset.fastlaneState, 'blocked');
    assert.equal(b.scripts.length, 0);
  }
  const local = browser({ ui: true, href: 'http://127.0.0.1:4323/' });
  initFastlaneAnalytics(local.win);
  assert.equal(local.prompt.hidden, false);
  assert.match(local.prompt.status.textContent, /preview/);
  local.prompt.allow.dispatchEvent(new Event('click'));
  assert.equal(local.scripts.length, 0);
  assert.equal(local.requests.length, 0);
});

test('privacy-page link reopens the persistent footer settings', () => {
  const b = browser({ ui: true, href: 'https://heybefree.app/#website-analytics', consent: 'denied' });
  initFastlaneAnalytics(b.win);
  assert.equal(b.details.open, true);
  assert.equal(b.prompt.hidden, true);
});
