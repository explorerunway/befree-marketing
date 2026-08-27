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
const pricing = readPage('pricing');
assert.ok(pricing.includes('https://app.heybefree.app/plan'), 'Pricing must link to web checkout');
assert.ok(pricing.includes('Get Pro in your browser'), 'Pricing must offer a browser-only journey');
assert.ok(!pricing.includes('No trial timer that flips to paid'), 'Optional trials must disclose renewal');
const terms = readPage('terms');
for (const required of ['RevenueCat Web Billing', 'Stripe', 'does not cancel a subscription']) {
  assert.ok(terms.includes(required), `Missing billing disclosure: ${required}`);
}
console.log('Static build verified: five clean routes/canonicals, web checkout link, billing disclosures.');
