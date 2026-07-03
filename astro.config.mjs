import { defineConfig } from 'astro/config';

// Static output — Vercel serves dist/ as-is (cleanUrls in vercel.json).
export default defineConfig({
  site: 'https://heybefree.app',
  output: 'static',
});
