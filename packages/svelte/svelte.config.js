import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/** @type {import('@sveltejs/vite-plugin-svelte').SvelteConfig} */
export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    runes: true,
    warningFilter: (warning) => warning.code !== 'css_unused_selector',
  },
  onwarn(warning, handler) {
    if (warning.code === 'css_unused_selector') return
    handler(warning)
  },
}
