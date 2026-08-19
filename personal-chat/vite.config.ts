import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './', // required so built assets load correctly from file:// in Electron
  plugins: [react()],
})
