import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { buildXDC, eruda, mockWebxdc } from '@webxdc/vite-plugins'
import { defineConfig } from 'vite'

const coreSrc = resolve(__dirname, 'packages/core/src')
const svelteSrc = resolve(__dirname, 'packages/svelte/src')

export default defineConfig(({ command }) => ({
  // WebXDC loads from webxdc://…/index.html — absolute /assets paths 404 there.
  base: command === 'build' ? './' : '/',
  // Use individual plugins (not webxdcViteConfig) so we skip basic-ssl.
  // localhost is already a secure context over HTTP, and webxdc-dev's wait-on
  // only rewrites `http:` → `http-get:` (HTTPS breaks the readiness check).
  // Custom mock: IndexedDB for status history (stock mock used localStorage and hit quota).
  plugins: [
    svelte(),
    // webxdc:// is not a CORS-capable origin; Vite’s default `crossorigin`
    // attributes break module/CSS loads inside Delta Chat.
    {
      name: 'webxdc-strip-crossorigin',
      transformIndexHtml(html) {
        return html
          .replace(/\s+crossorigin(?:="[^"]*")?/gi, '')
          .replace(/\s+crossorigin(?=[\s>])/gi, '')
      },
    },
    buildXDC(),
    eruda(),
    mockWebxdc(resolve(__dirname, 'src/dev/webxdc-mock-idb.js')),
  ],
  resolve: {
    alias: {
      '@xproeditor/core': resolve(coreSrc, 'index.ts'),
      '@xproeditor/svelte/style.css': resolve(svelteSrc, 'styles/tailwind-entry.css'),
      '@xproeditor/svelte': resolve(svelteSrc, 'index.ts'),
    },
  },
  css: {
    postcss: resolve(__dirname, 'postcss.config.js'),
  },
  build: {
    target: 'es2022',
    cssMinify: true,
    // Prefer smaller output for WebXDC packaging.
    modulePreload: false,
    // One JS + one CSS file — multi-chunk dynamic imports 404 under webxdc://
    // (relative ES module graph is unreliable in Delta Chat’s custom protocol).
    cssCodeSplit: false,
    reportCompressedSize: true,
    rollupOptions: {
      treeshake: {
        moduleSideEffects: (id, external) => {
          if (external) return false
          // CSS and Svelte modules have side effects; pure .ts can be shaken.
          if (id.includes('.css') || id.includes('.svelte')) return true
          // highlight language registration runs on import.
          if (id.includes('hljs-lite') || id.includes('highlight.js')) return true
          return false
        },
      },
      output: {
        // Single application chunk (no yjs/fflate/vim siblings).
        inlineDynamicImports: true,
      },
    },
  },
  // _vue_ref / _app_vue_ref hold conversion sources — never crawl as Vite entries.
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    watch: {
      ignored: ['**/_vue_ref/**', '**/_app_vue_ref/**', '**/context/**'],
    },
  },
}))
