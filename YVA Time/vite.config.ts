import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The UI (renderer). Main + preload are bundled by scripts/build-main.mjs.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
})
