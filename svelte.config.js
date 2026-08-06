import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/** @type {import('@sveltejs/vite-plugin-svelte').SvelteConfig} */
export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    runes: true,
    // Classes often live on child components / {@html} / portals; scoped unused-CSS
    // analysis produces mostly false positives after the Vue→Svelte migration.
    warningFilter: (warning) => warning.code !== 'css_unused_selector',
  },
  onwarn(warning, handler) {
    if (warning.code === 'css_unused_selector') return
    handler(warning)
  },
}
