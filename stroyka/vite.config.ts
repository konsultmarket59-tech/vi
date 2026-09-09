import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' — иначе собранные файлы не находятся при запуске из file:// в Electron
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5175 },
})
