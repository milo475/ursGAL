import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA (V4-10): жолооч утсандаа суулгаж, offline үед ч app нээгдэнэ
    VitePWA({
      // Шинэ хувилбар гармагц SW шууд идэвхжиж (skipWaiting), нээлттэй табуудыг
      // удирдана (clientsClaim); хуудас src/pwa.js-ээр өөрөө дахин ачаалагдана.
      registerType: 'autoUpdate',
      injectRegister: false, // бүртгэлийг src/pwa.js хийнэ
      includeAssets: ['brand/favicon-32.png', 'brand/apple-touch-icon-180.png', 'brand/mark-dark.svg'],
      manifest: {
        name: 'Ochir — захиалга, хүргэлт',
        short_name: 'Ochir',
        description: 'Захиалга, хүргэлтийн систем',
        display: 'standalone',
        start_url: '/',
        background_color: '#0B1220',
        theme_color: '#0B1220',
        icons: [
          { src: '/brand/favicon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/brand/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true, // хуучин хувилбарын precache-ийг устгана
        // App shell + asset-ууд precache хийгдэнэ; API кэшлэхгүй
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            // Жолоочийн жагсаалт: network-first, сүүлчийн амжилттай хариу кэш
            urlPattern: /\/api\/deliveries\/my$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'deliveries-my',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 4, maxAgeSeconds: 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      // /api гэсэн хүсэлтүүдийг NestJS backend (порт 3000) руу дамжуулна
      '/api': 'http://localhost:3000',
    },
  },
})
