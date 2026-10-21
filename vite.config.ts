import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the app from /<repo>/, so the deploy workflow sets BASE_PATH.
const base = process.env.BASE_PATH ?? '/';
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    VitePWA({
      // Never reload on its own: a reload mid-morning would be jarring. The app
      // offers "Update" instead (see useAppUpdate).
      registerType: 'prompt',
      includeManifestIcons: false, // the glob below already precaches everything in public/
      manifest: {
        name: 'Out the Door',
        short_name: 'Out the Door',
        description: "A live estimate of when you'll finish your routine, updating as you tick tasks off.",
        lang: 'en-AU',
        theme_color: '#11161c',
        background_color: '#11161c',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'], // the plugin adds the manifest itself
      },
    }),
  ],
});
