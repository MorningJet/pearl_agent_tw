import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { plazaSyncPlugin } from './vite.plaza-sync.js'

/** GitHub Pages project site needs `/<repo>/`; local/Vercel keep `/`. */
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  plugins: [tailwindcss(), plazaSyncPlugin()],
  server: {
    host: true,
    port: 5173,
    // Local NewebPay worker: npm run newebpay:dev → http://127.0.0.1:8787
    proxy: {
      '/newebpay-api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/newebpay-api/, ''),
      },
    },
    // Plaza sync rewrites these files; ignoring prevents full reload → jump to Home.
    watch: {
      ignored: [
        '**/src/shared/data/plazaDesigns.json',
        '**/data/plaza_ugc.json',
        '**/data/plaza_designs.xlsx',
      ],
    },
  },
})
