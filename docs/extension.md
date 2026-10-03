# BrowserExtension/ Guide

MV3 Chrome extension (TypeScript, built with Vite + `vite-plugin-web-extension`). Only activates on
`*.twitter.com`, `*.x.com`, `*.reddit.com` (per `content_scripts.matches` in `public/manifest.json`).

## Contexts and their roles

| Context | Entry file | Role |
|---|---|---|
| **Background (MV3 service worker)** | `src/background/index.ts` | Generates/stores the anonymous `user_id`; Google OAuth sign-in/out (`chrome.identity.getAuthToken`); loads/saves `settings`; `/ping` health check; proxies image-result polling for page-context requests (CSP workaround); central `chrome.runtime.onMessage` router; 20s `keepAlive` heartbeat to resist service-worker suspension. |
| **Content script (isolated world)** | `src/content/content-script.ts` | Runs at `document_start`. Injects the page-context interceptor (`injected.js`), bridges page-context requests to `chrome.runtime`/background (since page JS can't call Chrome APIs directly), relays settings/style updates between background and page. |
| **Page-context interceptor** (separate bundle, injected as a `<script src="...injected.js">`) | `src/content/interceptor/interceptor.ts` (built via `interceptor.config.js`) | Overrides `window.fetch` and `XMLHttpRequest` in the page's own JS context to capture Reddit/Twitter feed responses before the page reads them; also runs `DomProcessor` (MutationObserver-based marker scanning/rendering) and `StyleManager` (injects CSS for blur/overlay/rewrite). |
| **Popup** | `src/popup/popup.ts` | Toolbar popup: natural-language filter-creation chat (`/chat`, `/chat/image`), filter CRUD, WebSocket-status display, Google auth UI. State driven by the Zustand `useFilterStore`. |
| **Options** | `src/options/options.ts` | Full-page settings UI: visual preferences (blur/overlay/rewrite styling), processing mode defaults, full filter CRUD table, filter import/export to JSON, Google auth UI. |

Two code paths exist on disk but are **confirmed dead** (no live Vite entry point or import reaches
them): `src/content/platforms/reddit.ts`, `src/content/platforms/twitter.ts`,
`src/content/services/interceptor.ts` (an earlier adapter-based interception design), and
`src/shared/network.ts` (superseded by `src/shared/api/api-service.ts`).

## Why the interceptor is a separate bundle

The content script runs in the isolated world at `document_start` — it cannot override the page's
own `window.fetch`/`XMLHttpRequest` because the isolated world has a separate global object from the
page. `src/content/modules/script-injector.ts` works around this by creating a
`<script src="chrome-extension://<id>/injected.js">` tag, which runs `dist/injected.js` (the output
of the *second*, standalone `interceptor.config.js` Vite build) as a real page script in the page's
own JS context — that's where the actual `fetch`/XHR overrides take effect. The two worlds then talk
to each other via `window.postMessage`/`CustomEvent`s on the shared `window` object, never via direct
function calls.

## Message catalogue

### `chrome.runtime` messages (background ⇄ content-script / popup / options)

| Type | Direction | Payload → Response |
|---|---|---|
| `getStatus` | UI/content → background | `{type:'getStatus'}` → `{status:'active', version, mode, logging}` |
| `getSettings` | content → background | `{type:'getSettings'}` → `{settings}` |
| `updateSettings` | UI → background (fans out `settingsUpdated` to all matching tabs) | `{type:'updateSettings', settings}` → `{success, settings}` |
| `updateStyles` | options → background (fans out to all matching tabs) | `{type:'updateStyles', cssVariables}` → `{success:true}` |
| `testConnection` | UI → background | `{type:'testConnection'}` → `{connected}` |
| `signIn` / `signOut` | popup/options → background | → `{success, user?}` / `{success}` |
| `getUserInfo` | popup/options/api-service → background | → `{user: {...} \| null}` |
| `getWebSocketStatus` | popup → background | → `{connected}` |
| `pollImageResult` (legacy bridge) | content → background | `{type, imageUrl, filters}` → `{success, result?, error?}` |
| `websocketStatusChanged` | background → popup (broadcast) | `{connected}` |
| `filters_updated` / `chat_stream` | background (rebroadcast of a WS event) → any listener | — |
| `getStatus`/`toggleDebug`/`settingsUpdated`/`updateStyles` (as `action`/`type` field, background → content) | background → content-script's `modules/message-handler.ts` | relays into the page via `window.postMessage` |

A `chrome.runtime.connect({name:"settings-sync"})` port is opened by the content script but carries
no messages (background only logs its disconnect).

### `window.postMessage` (isolated-world content-script ⇄ page-context interceptor)

| Type | Direction | Purpose |
|---|---|---|
| `diymod_get_extension_id` | page → content-script | Get `chrome.runtime.id` from page context. |
| `diymod_wait_for_image` | page (`markers.ts`) → content-script | Ask content-script to wait for a deferred image result via `apiService.waitForImageProcessing` → replies `diymod_image_processed`. |
| `diymod_poll_image_request` (legacy) | page → content-script | Forwards to background's `pollImageResult`, replies `diymod_poll_image_response`. |
| `diymod_poll_image_response` | content-script → interceptor → page | Re-broadcast of the legacy poll result. |
| `diymod_image_processed` | content-script → page | Final image-processing result for `markers.ts` to swap into the DOM. |
| `getSettings` / `settingsResponse` | page (`style-manager.ts`) ⇄ content-script | Fetch current settings into the page context. |
| `updateStyles` / `settingsUpdated` / `toggleDebug` | content-script → page | Relay of the corresponding `chrome.runtime` message into the page. |

### `CustomEvent` on `window` (page-context interceptor ⇄ isolated-world content-script)

| Event | Dispatched by | Consumed by | Payload |
|---|---|---|---|
| `SaveBatch` | `BaseInterceptor.dispatchSaveBatchEvent()` (fetch/XHR interceptors) | `content/modules/event-handler.ts` | `InterceptedRequest {id, url, type, startTime, response}` |
| `CustomFeedReady` | `content/modules/event-handler.ts` | pending `fetch`/XHR promise in the interceptor bundle | `{id, url?, response}` (processed or original, on timeout/error) |
| `locationchange` | `interceptor.ts` (patches `history.pushState`/`replaceState`) | `interceptor.ts` itself (logging only) | native `Event` |

## Storage keys

### `chrome.storage.sync`

| Key | Shape | Notes |
|---|---|---|
| `user_id` | `string` | Canonical anonymous/Google user id. Written by background, read everywhere. |
| `google_user_info` | `{id, email?, name?, picture?, token?}` | Google OAuth profile. |
| `settings` | `{enabled, blurHoverEffect, blurIntensity, overlayStyle, ..., imageProcessing:{...}}` | Owned exclusively by `background/index.ts`; other contexts access it only via `getSettings`/`updateSettings` messages. |
| `diy_mod_config` | Full `Config` object (minus `userId`) | Written/read by `shared/config.ts`. |
| `diy_mod_user_id` | `string` | **Likely dead/inconsistent**: written only by `options.ts: regenerateUserId()`, distinct from the canonical `user_id` key actually used by API calls — regenerating an ID here does not change the ID the extension actually sends. |

### `chrome.storage.local`

| Key | Shape | Notes |
|---|---|---|
| `keepAlive` | timestamp | Written every 20s to resist service-worker suspension; not read anywhere. |
| `savedPopupState` | `{currentState, filterData, conversationHistory, chatAreaContent, timestamp}` | In-progress chat state, debounced 500ms, restored only within a short validity window and only from `CLARIFYING`/`FILTER_CONFIG` state. |

### `localStorage` (not `chrome.storage`)

| Key | Shape | Notes |
|---|---|---|
| `diy_mod_dev_mode` | `'true'\|'false'` | Dev-mode override consulted by `shared/config.ts: isDevelopment()`. |
| `diy_mod_logging_config` | JSON `LoggingConfig` | Written/read only within `shared/logging-config.ts`; no confirmed caller elsewhere. |

## Build process

```bash
cd BrowserExtension
npm install
npm run build
```

`package.json`'s `build` script runs four steps in order:
1. `tsc` — typecheck only (Vite does its own transpilation; this step exists purely to catch type errors).
2. `vite build` — main `vite-plugin-web-extension` build: background service worker, content script, popup, options; copies `public/` assets; emits `dist/manifest.json`.
3. `vite build --config interceptor.config.js` — a *separate* Vite config that bundles `src/content/interceptor/interceptor.ts` alone as an IIFE lib, emitting `dist/injected.js` (`emptyOutDir: false` so it doesn't wipe step 2's output).
4. `node fix-manifest.js` — post-processes `dist/manifest.json`.

**Why `fix-manifest.js` exists:** `vite-plugin-web-extension` can emit `dist/manifest.json` still
pointing at source `.ts` paths (e.g. `src/background/index.ts`) for `background.service_worker` and
`content_scripts[].js`, even though the actual compiled output on disk is `.js` (per the custom
`entryFileNames` mapping in `vite.config.js`). A manifest referencing a nonexistent `.ts` file would
make Chrome fail to load the service worker/content script. `fix-manifest.js` does a literal
`.ts` → `.js` string replace on those two manifest fields after the build. Running `vite build`
directly (skipping the npm script) skips this fix-up and can leave a broken `dist/manifest.json`.

**Load unpacked:** `chrome://extensions` → enable Developer mode → "Load unpacked" → select
`BrowserExtension/dist`.
