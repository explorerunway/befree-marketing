import { defineConfig } from 'astro/config';

// Static output — Vercel serves dist/ as-is (cleanUrls in vercel.json).
export default defineConfig({
  site: 'https://heybefree.app',
  output: 'static',
  // Vercel cleanUrls maps /pricing to pricing.html. Directory-format pages
  // become /pricing/index in prebuilt output and leave /pricing returning 404.
  build: { format: 'file' },
});
