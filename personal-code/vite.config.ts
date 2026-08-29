import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' is required so built assets load from file:// inside Electron.
// The dev server runs on 5174 so it can coexist with personal-chat's 5173.
export default defineConfig({
  base: './',
  server: { port: 5174, strictPort: true },
  plugins: [react()],
})
