import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: { port: 5174, strictPort: true },
  worker: { format: 'es' },
  build: { target: 'esnext' },
  // The jSquash codecs load their WASM by a URL relative to the module; prebundling breaks that URL.
  optimizeDeps: { exclude: ['@jsquash/oxipng', '@jsquash/jpeg', '@jsquash/webp'] },
});
