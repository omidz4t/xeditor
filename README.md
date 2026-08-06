# Collab Markdown Editor (Svelte)

Full Svelte 5 port of the Vue collab WebXDC markdown editor under `../editor/`.

Same collaboration stack (Yjs + webxdc), same block model (`@xproeditor/core`), same app features (pages, comments, presence, import/export, vim mode, polls, tables, …) with UI in Svelte instead of Vue.

## Layout

| Path | Role |
|------|------|
| `src/` | App shell — mirrors `editor/src/` |
| `packages/core/` | Framework-agnostic engine — mirrors `editor/packages/core/` |
| `packages/svelte/` | `@xproeditor/svelte` — mirrors `editor/packages/vue/` |

## Commands

```bash
make install
make dev       # Vite + mock webxdc
make run       # multi-peer webxdc-dev
make build     # dist/ + dist-xdc/app.xdc
```

## Notes

- Icons: `@lucide/svelte`
- Styles: `import '@xproeditor/svelte/style.css'`
- Vue original remains at `../editor/` for reference
