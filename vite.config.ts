import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const GTM_ID = 'GTM-KQVTRVDV';

/** Google Tag Manager for the Vercel production site only: dev, previews and the desktop exe stay without it. */
function googleTagManager(): Plugin {
  return {
    name: 'google-tag-manager',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'script', attrs: { async: true, src: `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}` }, injectTo: 'head-prepend' },
      {
        tag: 'script',
        children: "\n  window.dataLayer = window.dataLayer || [];\n  function gtag(){dataLayer.push(arguments);}\n  gtag('js', new Date());\n",
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig({
  plugins: [svelte(), ...(process.env.VERCEL_ENV === 'production' ? [googleTagManager()] : [])],
  clearScreen: false,
  server: { port: 5174, strictPort: true },
  worker: { format: 'es' },
  build: { target: 'esnext' },
  // The jSquash codecs load their WASM by a URL relative to the module; prebundling breaks that URL.
  optimizeDeps: { exclude: ['@jsquash/oxipng', '@jsquash/jpeg', '@jsquash/webp'] },
});
