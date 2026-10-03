# BrowserExtension/CLAUDE.md

Operational notes for `BrowserExtension/`. Contexts, message catalogue, storage keys, and the build
pipeline are documented in `../docs/extension.md` and `../docs/ARCHITECTURE.md` — this file is
commands + conventions + gotchas only.

## Build / run

```bash
npm install
npm run build     # tsc && vite build && vite build --config interceptor.config.js && node fix-manifest.js
npm run dev        # vite dev server (popup/options iteration only — see gotcha below)
```

Load unpacked: `chrome://extensions` → enable Developer mode → "Load unpacked" → select
`BrowserExtension/dist` (not `src/`, not the repo root).

There is no test runner configured and no lint script in `package.json`.

## Conventions

- All backend calls go through `src/shared/api/api-service.ts` (`apiService` singleton) — don't add
  new ad-hoc `fetch()` calls elsewhere except where the existing popup chat flow already does so
  directly (`popup.ts: sendToLLM`/`sendImageToLLM`).
- Cross-world communication is `window.postMessage`/`CustomEvent` on `window` (isolated world ⇄ page
  context), and `chrome.runtime.sendMessage` (background ⇄ any other context) — never assume direct
  function calls work across a context boundary; see `../docs/extension.md`'s message catalogue
  before adding a new message type.
- `src/content/platforms/{reddit,twitter}.ts` and `src/content/services/interceptor.ts` are dead
  code (no live import reaches them) — do not build on top of them. The live interception path is
  `src/content/interceptor/` + `src/utils/markers.ts`.
- Marker constants (`__BLUR_START__` etc.) in `src/shared/constants.ts` must stay in sync with
  `Backend/llm/processor.py`'s marker scheme — changing one side without the other silently breaks
  rendering.

## Gotchas

- **The interceptor bundle (`dist/injected.js`) and the content-script bundle are built and loaded
  separately** (`vite.config.js` vs. `interceptor.config.js`). Editing
  `src/content/interceptor/**` and reloading the extension without re-running the full `npm run
  build` will not pick up the change — always rebuild both, never run `vite build` alone.
- **`npm run dev` does not replace `npm run build` for MV3 testing.** The Vite dev server is useful
  for fast iteration on popup/options markup, but the content-script/interceptor/background bundles
  still need a real `npm run build` + an extension reload in `chrome://extensions` to take effect in
  a loaded tab.
- **WebSocket image notifications are off by default** (`useWebSockets: false` in
  `src/shared/config.ts`), and even if enabled, the default `websocketUrl` port (8010) doesn't match
  the backend's actual bind (8001) — don't debug "WebSocket not connecting" as a regression; it's the
  shipped default. The extension's real default path for deferred images is HTTP polling
  (`GET /get_img_result`).
- Running `fix-manifest.js` is not optional — it is the step that turns leftover `.ts` references in
  `dist/manifest.json` into the real `.js` output paths. Skipping it (by running `vite build`
  directly) can leave a `dist/` Chrome can't fully load.
