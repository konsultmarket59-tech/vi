import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  base: './', // required so built assets load correctly from file:// in Electron
  plugins: [react()],
  build: {
    // Две страницы: «Личный чат» и отдельная программа «Монтаж» — код общий.
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        montage: resolve(__dirname, 'montage.html'),
      },
    },
  },
})
