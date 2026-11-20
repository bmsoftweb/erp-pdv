import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const raiz = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PDV funciona offline: service worker só no build (em desenvolvimento fica desligado, como no next-pwa)
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: { navigateFallbackDenylist: [/^\/api\//], globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'] },
      manifest: {
        name: 'PDV Cupom Fiscal',
        short_name: 'Cupom PWA',
        description: 'Sistema de frente de caixa com funcionamento offline.',
        start_url: '/',
        display: 'standalone',
        background_color: '#f9fafb',
        theme_color: '#2563eb',
        shortcuts: [
          {
            name: 'Iniciar com Auto-Print',
            short_name: 'Auto-Print',
            description: 'Inicia o PDV com modo de impressão automática',
            url: '/?kiosk=1',
            icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  // Data da última atualização do PAF (Menu Fiscal › Identificação do PAF-NFC-e)
  define: { __BUILD_DATA__: JSON.stringify(new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })) },
  resolve: { alias: { '@': raiz } },
  build: { outDir: 'dist' },
});
