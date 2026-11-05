import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version.split('.').slice(0, 2).join('.')) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      workbox: { globIgnores: ['**/exceljs*'], importScripts: ['push-sw.js'], skipWaiting: true, clientsClaim: true, cleanupOutdatedCaches: true },
      includeAssets: ['logo-mark.png', 'favicon-64.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Compass · SToMS',
        short_name: 'Compass',
        description: 'Single Teas operations: indents, stock, purchases and closing.',
        theme_color: '#0F4D2A',
        background_color: '#F6F7F6',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ]
});
