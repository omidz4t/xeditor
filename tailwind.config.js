/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{svelte,ts}',
    './packages/svelte/src/**/*.{svelte,ts}',
  ],
  corePlugins: {
    preflight: false,
  },
  important: false,
  theme: {
    extend: {},
  },
  plugins: [],
}
