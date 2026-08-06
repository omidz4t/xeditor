import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    svelte({
      configFile: resolve(__dirname, '../../svelte.config.js'),
    }),
  ],
  build: {
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'XProEditorSvelte',
      fileName: () => 'index.js',
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        'svelte',
        'svelte/internal',
        'svelte/store',
        'svelte/easing',
        'svelte/transition',
        'svelte/animate',
        'svelte/motion',
        '@xproeditor/core',
        '@lucide/svelte',
        /^@lucide\/svelte(\/.*)?$/,
        'highlight.js',
        /^highlight\.js(\/.*)?$/,
      ],
      output: {
        assetFileNames: (asset) =>
          asset.name?.endsWith('.css') ? 'style.css' : (asset.name ?? 'assets/[name][extname]'),
      },
    },
  },
  resolve: {
    alias: {
      '@xproeditor/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
})
