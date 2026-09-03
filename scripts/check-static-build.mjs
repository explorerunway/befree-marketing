import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Vercel cleanUrls expects flat .html output. A successful Astro directory
// build previously deployed /pricing/index while /pricing silently returned 404.
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
assert.equal(vercel.cleanUrls, true);
assert.equal(vercel.trailingSlash, false);
assert.ok(vercel.rewrites?.some(({ source, destination }) => source === '/' && destination === '/index'),
  'The prebuilt homepage needs its explicit index route');
const readPage = (name) => readFileSync(new URL(`../dist/${name}.html`, import.meta.url), 'utf8');
for (const page of ['index', 'pricing', 'mac', 'android', 'adhd']) {
  const html = readPage(page);
  const canonical = `https://heybefree.app${page === 'index' ? '/' : `/${page}`}`;
  assert.ok(html.includes(`rel="canonical" href="${canonical}"`), `${page}: incorrect canonical`);
}
for (const page of ['index', 'pricing', 'mac', 'android', 'adhd']) {
  const html = readPage(page);
  assert.ok(html.includes('id="website-analytics"'), page + ': missing persistent analytics settings');
  assert.ok(html.includes('id="fastlane-consent-prompt"'), page + ': missing optional analytics prompt');
  assert.ok(!/<script[^>]*\bsrc=["']https:\/\/aromatic-caribou-889\.convex\.site/.test(html),
    page + ': Fastlane must load through consent, never a direct script tag');
}
const pricing = readPage('pricing');
assert.ok(pricing.includes('https://app.heybefree.app/plan'), 'Pricing must link to web checkout');
assert.ok(pricing.includes('Get Pro in your browser'), 'Pricing must offer a browser-only journey');
assert.ok(!pricing.includes('No trial timer that flips to paid'), 'Optional trials must disclose renewal');
const terms = readPage('terms');
for (const required of ['RevenueCat Web Billing', 'Stripe', 'does not cancel a subscription']) {
  assert.ok(terms.includes(required), `Missing billing disclosure: ${required}`);
}
const privacy = readPage('privacy');
for (const required of ['Optional website analytics (Fastlane)', 'befree-fastlane-consent-v1', 'Global Privacy Control', 'https://www.usefastlane.ai/privacy']) {
  assert.ok(privacy.includes(required), 'Missing Fastlane privacy disclosure: ' + required);
}
assert.ok(readPage('subprocessors').includes('Fastlane (Possibility Studios Pty Ltd)'), 'Missing Fastlane provider disclosure');

// ---------------------------------------------------------------------------
// Claims that must never reach a public page.
//
// WHY THIS LIVES HERE. The app repo has scripts/check-claims.sh, written after
// the "audio never leaves your phone" incident (AUDIT_FINDINGS F1) shipped a
// false privacy claim across the store description, the metadata files, the
// privacy policy, the DPIA, the video scripts and the social kit. That guard
// scans paths inside the APP repo and therefore cannot see this site at all —
// so on 2026-09-04 the same claim was found live here in new wording ("Your
// device turns speech into text"), which its regex would not have matched even
// if it could reach us. This is the third widening of that guard's scope and
// the first one on the surface the public actually reads.
//
// Scanning dist/ rather than src/ is deliberate: it catches a claim whichever
// file produced it, including a component or a data array.
const CLAIMS = [
  {
    // F1. Apple may process audio on ITS servers depending on device and
    // language, so no page may state where transcription happens. The
    // defensible claim, and the one docs/privacy-policy.md uses, is that
    // BeFree never receives or stores the raw audio.
    pattern:
      /audio never leaves|voice never leaves|never leaves (your|the) phone|your device turns speech into text|transcri\w+ (happens|stays|is done) (on|entirely on) (your |the )?device/i,
    why: 'states WHERE transcription happens; Apple may process audio on its servers (AUDIT_FINDINGS F1). Say "BeFree never receives or stores your raw audio".',
  },
  {
    // A numeric free allowance cannot be honoured from a static page. The app
    // keys every stated allowance on the `pro_gates` capability (decision 029
    // §2: "the 20 never appears beside a wall that stops at 3"), and this site
    // cannot read that dial. On 2026-09-04 the pricing page promised "20
    // AI-sorted captures every 30 days" while the build then at Apple walled
    // iPhone at 3.
    pattern: /\b\d+\s+AI-sorted captures\b|\bcaptures every \d+ days\b/i,
    why: 'states a numeric free allowance this site cannot key to `pro_gates` (decision 029 §2). Describe the allowance without a number, or key it.',
  },
  {
    // "Forever" is a promise about the future of a tier that is actively being
    // tuned. Free-to-start is the claim that survives a packaging change.
    pattern: /free forever|\$0\s*<[^>]*>\s*forever|stay free for as long as/i,
    why: 'promises the free tier never changes. Use "free to start".',
  },
];
const PUBLIC_PAGES = ['index', 'pricing', 'mac', 'android', 'adhd', 'privacy', 'terms', 'support', 'subprocessors', 'accessibility', 'data-deletion'];
for (const page of PUBLIC_PAGES) {
  let html;
  try {
    html = readPage(page);
  } catch {
    continue; // a page that does not exist cannot carry a claim
  }
  for (const { pattern, why } of CLAIMS) {
    const hit = html.match(pattern);
    assert.ok(!hit, `${page}.html: banned claim ${JSON.stringify(hit?.[0])} — ${why}`);
  }
}

console.log(`Static build verified: clean routes/canonicals, checkout, billing and optional analytics disclosures; ${CLAIMS.length} banned claims absent from ${PUBLIC_PAGES.length} public pages.`);
