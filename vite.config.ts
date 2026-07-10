import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Resorts Staff App',
        short_name: 'Staff',
        description: 'Resort staff admin dashboard and reception scanner',
        theme_color: '#FFFFFF',
        background_color: '#FAFAFA',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Bump when schema/payload contracts change so installed PWAs drop stale JS.
        cacheId: 'resorts-staff-v2-owner-phones',
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'],
      },
    }),
  ],
})
