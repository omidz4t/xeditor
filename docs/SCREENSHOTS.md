# Screenshots

Product UI captures for the landing site are **generated locally or in CI** and are **not** stored in git.

- Local / CI output: `docs/screenshots/` or `dist/screenshots/` (gitignored)
- Pages deploy copies them into `dist-pages/screenshots/` only for GitHub Pages

```bash
npm run screenshots
# or against local Pages build:
npm run build:pages && npm run preview:pages
BASE_URL=http://127.0.0.1:4173 APP_PATH=/app/ OUT_DIR=dist/screenshots npm run screenshots
node scripts/build-pages.mjs
```

See also `scripts/screenshot-app.mjs` and `.github/workflows/pages.yml`.
