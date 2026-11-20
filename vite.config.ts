import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './', // relative paths so dist/ works on GitHub Pages or any subfolder
  plugins: [react()],
})
