# BrowserExtension/ Technical Map

This is a read-only technical map of the `BrowserExtension/` subproject (SHIELD / DIY-MOD Chrome extension). All paths are relative to `/Users/nazeebahmed/Desktop/SHIELD/BrowserExtension/` unless given as absolute. Line numbers / symbol names are cited where they anchor a specific claim; some are omitted for broad file-level summaries.

---

## 1. Build config & manifest

**Manifest version:** MV3 (`public/manifest.json:2` — `"manifest_version": 3`).

**Build pipeline** (`package.json:7-10`):
```
"dev": "vite"
"build": "tsc && vite build && vite build --config interceptor.config.js && node fix-manifest.js"
"preview": "vite preview"
"fix-manifest": "node fix-manifest.js"
```
So a full build is four sequential steps: TypeScript typecheck, the main Vite build (background + content-script + popup + options, driven by `vite-plugin-web-extension`), a second standalone Vite build for the page-context interceptor bundle, then a manifest post-processing script.

- `vite.config.js` uses `vite-plugin-web-extension` (`webExtension({...})`, lines 6-13) pointed at `public/manifest.json`, with `additionalInputs: ["src/content/interceptor/interceptor.ts"]` so the plugin is aware of that extra entry even though the second build actually emits it. Custom `rollupOptions.output.entryFileNames` (lines 26-37) force fixed output paths: the interceptor chunk → `injected.js`, the background entry → `src/background/index.js`, the content-script entry → `src/content/content-script.js`.
- `interceptor.config.js` is a *separate* Vite config (not merged with the main one) that bundles `src/content/interceptor/interceptor.ts` alone as an IIFE library (`build.lib`, lines 10-20) named `interceptor`, emitting `dist/injected.js`. `emptyOutDir: false` (line 13) so it doesn't wipe out what the first build produced.
- `fix-manifest.js` runs last and post-processes `dist/manifest.json` to replace any leftover `.ts` extensions with `.js` in `background.service_worker` and each `content_scripts[].js` entry (lines 19-46) — see section 7 for why this is needed.

**Manifest permissions** (`public/manifest.json:14-21`):
```json
"permissions": ["storage", "tabs", "webRequest", "scripting", "identity", "activeTab"]
```

**Host permissions** (`public/manifest.json:22-30`):
```json
"host_permissions": [
  "*://*.twitter.com/*",
  "*://*.x.com/*",
  "*://*.reddit.com/*",
  "http://localhost:8001/*",
  "http://127.0.0.1:8001/*",
  "https://diymod.s3.us-east-2.amazonaws.com/*",
  "https://diy-mod.s3.us-east-2.amazonaws.com/*"
]
```

**Content script matches** (`public/manifest.json:41-48`):
```json
"content_scripts": [{
  "matches": ["*://*.twitter.com/*", "*://*.x.com/*", "*://*.reddit.com/*"],
  "js": ["src/content/content-script.js"],
  "css": ["src/content/content-styles.css"],
  "run_at": "document_start",
  "all_frames": false
}]
```
So the extension only ever activates on Twitter/X and Reddit, injecting at `document_start` in the top frame only.

**Other manifest notables:**
- `action.default_popup` → `src/popup/popup.html` (`public/manifest.json:7-9`).
- `options_ui.page` → `src/options/options.html`, opened in a full tab (`open_in_tab: true`, lines 10-13).
- `oauth2` block configures a Google client ID and `userinfo.email`/`userinfo.profile` scopes (lines 31-37) used by the Google sign-in flow in `src/background/index.ts`.
- `background.service_worker` → `src/background/index.js` (MV3 service worker, not a persistent background page) (lines 38-40).
- `web_accessible_resources` exposes `injected.js`, `icons/*`, and `src/content/content-styles.css` to the three supported site patterns (lines 50-55) — this is what lets the isolated-world content script `fetch`/inject `injected.js` into the page.
- A fixed `key` field is present (line 5) — pins the extension ID across dev/unpacked loads so that OAuth redirect URIs and `chrome.runtime.id`-based unpacked testing stay stable.

---

## 2. Directory roles

### `src/background/`
Single file: **`src/background/index.ts`**. Runs as the MV3 service worker. Responsibilities:
- Generates/stores the anonymous `user_id` (`initializeUserId`, `getUserId`, lines 58-71) in `chrome.storage.sync`.
- Google OAuth sign-in/out via `chrome.identity.getAuthToken` (`signInWithGoogle`, `launchGoogleAuthFlow`, `fetchGoogleUserInfo`, `signOut`, lines 74-221).
- Loads/saves extension `settings` object in `chrome.storage.sync` (`loadSettings`/`saveSettings`, lines 256-264).
- `checkServerConnection()` pings the backend `/ping` (lines 267-279).
- `pollForImageResult()` — proxies image-result polling requests to the backend `/get_img_result` on behalf of the page context, to dodge CSP restrictions that would block a direct page-context fetch to `localhost:8001` (lines 282-331).
- Central `chrome.runtime.onMessage` listener (lines 334-505) handling the message types documented in section 4.
- `chrome.runtime.onInstalled` — initializes config/user id/settings, opens a welcome page on fresh install, and opens the WebSocket connection if enabled (lines 517-570).
- Periodic `setInterval` every 20s writing `keepAlive` timestamp to `chrome.storage.local` to help keep the service worker alive (lines 23-25).

### `src/content/`
The content-script / page-interceptor layer. Subdivided into:
- **`content-script.ts`** — isolated-world entry point injected at `document_start`. Loads config, injects the page-context interceptor script, wires up message/event listeners, and sets up a bridge (`setupExtensionBridge`) that lets the page context ask the content script to poll/wait for image-processing results via `chrome.runtime` (since page-context JS cannot call Chrome APIs directly).
- **`content-styles.css`** — stylesheet loaded via the manifest's `content_scripts[].css`.
- **`interceptor/`** (page-context, isolated-world bundle, built separately — see §3):
  - `index.ts` — trivial bootstrap: `new RequestInterceptor().start()`.
  - `interceptor.ts` — the `RequestInterceptor` class; owns the configured list of `subscribedEndpoints` (Twitter/Reddit feed endpoint names) and composes the four sub-components below; also overrides `history.pushState`/`replaceState` to dispatch a `locationchange` event (`setupUrlChangeTracking`, lines 120-145) and relays `diymod_poll_image_response` messages back onto `window` (`setupExtensionMessaging`, lines 150-160).
  - `network/base-interceptor.ts` — `BaseInterceptor` abstract class: shared `shouldInterceptUrl()` matching logic and `dispatchSaveBatchEvent()` (dispatches a `SaveBatch` CustomEvent on `window`).
  - `network/fetch-interceptor.ts` — `FetchInterceptor`: overrides `window.fetch`, see §3.
  - `network/xhr-interceptor.ts` — `XhrInterceptor`: overrides `XMLHttpRequest.prototype.{open,send,setRequestHeader}`, see §3.
  - `ui/dom-processor.ts` — `DomProcessor`: `MutationObserver`-driven scanner that finds marker text/images in the live DOM and replaces/transforms them (calls into `src/utils/markers.ts`); also has an opt-in `hideInitialPosts()` behavior (gated by `config.features.hideInitialPosts`) that hides the first 3 `article.w-full.m-0` posts on load, and `setupScrollAwareOverlays()` which uses an `IntersectionObserver` to lower z-index of off-screen overlays.
  - `ui/style-manager.ts` — `StyleManager`: injects a `<style id="diymod-injected-styles">` block defining the blur/overlay/rewrite/processing CSS classes directly in the page (since `chrome.runtime.getURL()` isn't usable from injected page-context scripts), and listens for `updateStyles`/`settingsResponse` `window` messages to set CSS variables on `:root`.
- **`modules/`** (isolated-world helpers used by `content-script.ts`):
  - `script-injector.ts` — `injectInterceptorScript()`: creates a `<script src="chrome-extension://.../injected.js">` and appends it to `document.head`, removing it on load.
  - `message-handler.ts` — `setupMessageListeners()`: handles `chrome.runtime.onMessage` for `getStatus`/`toggleDebug`/`settingsUpdated`/`updateStyles`, opens a `settings-sync` port, and requests initial settings (`requestInitialSettings()`) which it then relays into the page via `window.postMessage`.
  - `event-handler.ts` — `setupEventListeners()`: listens for the `SaveBatch` CustomEvent dispatched by the injected interceptor, forwards the intercepted feed to the backend via `api-connector.ts`, and dispatches `CustomFeedReady` back onto `window` with either the processed or (on error) original response.
  - `api-connector.ts` — `testApiConnection()` and `processInterceptedRequest()` / `batchProcessFeed()`, thin wrappers around `apiService.processFeed()`/`apiService.testConnection()`.
  - `platform-detector.ts` — `getCurrentPlatform()`: returns `'twitter'` or `'reddit'` based on `window.location.href`, else `null`.
- **`platforms/reddit.ts`, `platforms/twitter.ts`** and **`services/interceptor.ts`**: a complete *alternate* adapter-based interception implementation (`RedditAdapter`/`TwitterAdapter` implementing `PlatformAdapter`, plus a second `RequestInterceptor` class that overrides `fetch`/XHR directly and calls `apiService.processContent()`). **UNVERIFIED as dead code by this read-only audit, but strongly indicated**: `grep` across `src/` found no import of `content/services/interceptor.ts`, `content/platforms/reddit.ts`, or `content/platforms/twitter.ts` from any file reachable from the actual Vite entry points (`content-script.ts`, `background/index.ts`, `popup.ts`, `options.ts`, `interceptor.ts`); the only references are internal to `services/interceptor.ts` itself (`import { redditAdapter } ...`, `import { twitterAdapter } ...`). This looks like an earlier architecture superseded by the marker-based pipeline (`utils/markers.ts` + `interceptor/ui/dom-processor.ts`) and the `event-handler.ts`/`api-connector.ts` flow, left in the tree.

### `src/popup/`
Toolbar popup UI (opens on extension-icon click).
- `popup.html` / `popup.css` — markup/styling; includes a `#websocket-status` indicator, sign-in/out buttons, chat area, options area, and "My Filters"/"New Chat" controls.
- `popup.ts` — `PopupController` class: drives the natural-language filter-creation chat (`sendToLLM`/`sendImageToLLM` → backend `/chat`, `/chat/image`), filter CRUD via `apiService` (`loadAndDisplayFilters`, `removeFilter`, `handleConfigSave` → `apiService.createFilter`), WebSocket-status display (via `getWebSocketStatus` message to background), and Google auth UI (`initAuthentication()`, using `getUserInfo`/`signIn`/`signOut` messages to background). State machine driven by the Zustand `useFilterStore` (`src/shared/state/filter-store.ts`).
- `popup-state-manager.ts` — `PopupStateManager`: persists/restores in-progress chat state (`currentState`, `filterData`, `conversationHistory`, `chatAreaContent`) to `chrome.storage.local` under key `savedPopupState`, debounced (500ms) and capped to a 3-minute (comment says "30 minutes" but the code checks `3 * 60 * 1000` — see `popup-state-manager.ts:191`, a likely stale comment) validity window; only restores when in `CLARIFYING` or `FILTER_CONFIG` state.

### `src/options/`
Full-page settings UI (opened via `chrome.runtime.openOptionsPage()` or directly as a tab per `options_ui.open_in_tab`).
- `options.html` / `options.css` — sectioned settings page (user account, visual settings, default settings, filter management, server settings — anchors at `options.html:12-18`).
- `options.ts` — loads/saves the whole `config` object (visual preferences: blur intensity/hover, overlay/rewrite border styling, sync-borders toggle; processing preferences: `processingMode`, default content type/duration) via `loadConfig()`/`saveConfig()` from `shared/config.ts`; broadcasts style changes to content scripts via a `updateStyles` runtime message (`updateContentScriptStyles()`); full filter CRUD table (`loadFilters`, `renderFilterTable`, `saveFilter`, `editFilter`, `deleteFilter`) backed by `apiService`; filter import/export to/from a downloaded JSON file (`exportFilters`/`importFilters`); Google auth UI mirroring the popup's.

### `src/shared/`
Cross-context code shared between background/content/popup/options (note: some of it, like `config.ts` and `client.ts`, is also imported by the page-context interceptor bundle, so it must tolerate `chrome` being undefined — see the `typeof chrome !== 'undefined'` guards in `client.ts:33` and `config.ts:217,289`).
- `config.ts` — the single `Config` object (`config`) holding API base/polling/websocket URLs and endpoint paths, feature flags, per-platform selector/intercept-pattern config, user-study flags, logging level, and `userPreferences`. `loadConfig()`/`saveConfig()` persist/restore it (minus `userId`) to/from `chrome.storage.sync` key `diy_mod_config`; `isDevelopment()` checks a `localStorage` override, then whether `update_url` is absent from the manifest (unpacked-dev heuristic), then `process.env.NODE_ENV`.
- `constants.ts` — `MARKERS` (the `__BLUR_START__`/`__OVERLAY_START__`/`__REWRITE_START__` string constants and their `_END__` counterparts, plus `REWRITE_SEPARATOR`, `PROCESSED_IMAGE`, `OVERLAY_IMAGE`), `DIY_IMG_ATTR = "diy-mod-image"` (the HTML attribute the backend writes onto `<img>` tags with a JSON intervention config), `CSS_CLASSES`, `CSS_VARIABLES`.
- `client.ts` — `MainHttpClient` (exported singleton `client`): a secondary HTTP client with request-batching (`addToBatch`/`executeBatch`/`executeParallel`) and `logEvent()`. Used by `background/index.ts` (`client.logEvent(...)`) and optionally by `api-service.ts`'s batching path.
- `types.ts` — all shared TypeScript types/interfaces: `Platform`, `Post`/`ProcessedPost`/`PlatformAdapter` (used only by the apparently-unused `platforms/*`/`services/interceptor.ts`), `Settings`, `Filter`, `FilterState` enum + `FilterData`, `InterceptedRequest`, `ServerResponse<T>`, `FeedResponse`, `LLMResponse`, plus global `WindowEventMap` augmentation declaring the custom `SaveBatch`/`CustomFeedReady` events.
- `network.ts` — **UNVERIFIED as dead code**: exports `sendServerRequest`, `processFeed`, `logEvent`, `testConnection`, `getUserFilters`, `updateFilter`, `deleteFilter` — functionally overlapping with `api-service.ts`. `grep` found no importer of `shared/network.ts` anywhere in `src/`. Likely superseded by `shared/api/api-service.ts`.
- `logging-config.ts` — a `LoggingConfig` shape (websocket/api/dom granular logging toggles) persisted to `localStorage` key `diy_mod_logging_config`, with `enableDebugLogging()`/`disableVerboseLogging()` helpers. **UNVERIFIED as dead/partially-used code**: no importer of `getLoggingConfig`/`setLoggingConfig` was found in the files read; the actual runtime logging gating observed elsewhere uses `config.logging.level` (from `shared/config.ts`) directly, not this module.
- `api/api-service.ts` — see §6.
- `api/index.ts` — re-exports `api-service.ts`.
- `websocket/websocket-client.ts` — see §6.
- `websocket/index.ts` — re-exports `WebSocketClient`/`getWebSocketClient`.
- `state/filter-store.ts` — Zustand store `useFilterStore`: `currentState` (a `FilterState`), `filterData`, `handleResponse(data: LLMResponse)` (drives state transitions off the backend chat response's `type` field), `updateFilterData`, `transitionTo`, `reset`.
- `state/index.ts` — re-exports `filter-store.ts`.

### `src/utils/`
- `markers.ts` — the extension-side counterpart to the backend's text-marker scheme (see `Backend/llm/processor.py` per root `CLAUDE.md`). Maintains a registry (`registerMarkerHandler`/`registerImageMarkerHandler`) of text/image marker handlers; built-in handlers for `blur`/`overlay`/`rewrite` are registered at module load (lines 1147-1169). Key exports: `processMarkedText()`, `hasAnyMarkers()`, `processMarkedImage()` (dispatches on a parsed `DIY_IMG_ATTR` JSON config's `type` field: `overlay`/`blur`/`processed`/`cartoonish`/`edit_to_replace`), `applyOverlayToImage()`, `applyBlurToImage()`, plus the deferred-image polling/WebSocket-wait flow (`processCartoonishImageMarker` → `startImagePolling` → `waitForImageResult`, which `window.postMessage`s a `diymod_wait_for_image` request that `content-script.ts`'s bridge picks up) and DOM indicator helpers (`addImageModificationIndicator`).
- `logger.ts` — `logger` object with per-area (`api`, `interceptor`, `ui`, `websocket`, `content`) `debug`/`info`/`warn`/`error` functions gated by `config.logging.level`; also an unused (`@ts-ignore`'d) `Logger` class with a `remoteLog()` method that POSTs to `${config.api.baseUrl}/logging` if `config.logging.enableRemoteLogging` is true. **UNVERIFIED**: no evidence `enableRemoteLogging` is ever set true, and the `Logger` class itself appears unused — only the `createLogger`-based `logger` export is imported elsewhere.
- `logging-utils.ts` and `logging.ts` — **not read in this pass**; `markers.ts` and `api-service.ts` import `safeUrlLog`, `debugLog`, `logError`, `logInfo` from both `./logging` and `./logging-utils` (e.g. `markers.ts:4-5` imports `safeUrlLog` from `logging-utils` separately from `logging`), suggesting near-duplicate helper modules. Flagging for follow-up rather than guessing their contents.

---

## 3. Interception

**What's intercepted:** Only responses whose URL's last non-query path segment matches a hard-coded allowlist in `RequestInterceptor.config.subscribedEndpoints` (`src/content/interceptor/interceptor.ts:32-55`):
- Twitter/X: `HomeTimeline`, `HomeLatestTimeline`
- Reddit: `home-feed`, `popular-feed`, `all-feed`, `best`, `hot`, `new`, `rising`, `controversial`, `top`, `gilded`, `promoted`, `ads`, plus pagination endpoints `partial`, `more_posts`, `partial-more-posts`, `morecomments`, `svc/shreddit`.

Matching logic lives in `BaseInterceptor.shouldInterceptUrl()` (`src/content/interceptor/network/base-interceptor.ts:31-72`): it extracts the last path segment and checks direct membership in the list; for `reddit.com` hosts specifically, if the URL has an `after`/`cursor` query param (a pagination request) it additionally checks whether any path segment is in the list, or whether the last segment contains `"partial"`/`"more"`.

**How — two mechanisms, both overriding global browser APIs in the page's own JS context:**
1. **Fetch override** — `FetchInterceptor.overrideFetch()` (`src/content/interceptor/network/fetch-interceptor.ts:38-152`) replaces `window.fetch`. For a matched URL it calls the real fetch, clones the response twice (one clone returned to the page immediately-ish, one read for processing), stringifies the body (JSON or text), and dispatches a `SaveBatch` CustomEvent with an `InterceptedRequest` payload (`id`, `url`, `startTime`, `type`, `response`). It then returns a `Promise<Response>` that resolves either when a matching `CustomFeedReady` event arrives (processed body) or after a `config.api.requestTimeoutMs` (60s) timeout (falls back to the original clone).
2. **XHR override** — `XhrInterceptor.overrideXHR()` (`src/content/interceptor/network/xhr-interceptor.ts:54-156`) monkey-patches `XMLHttpRequest.prototype.open`/`send`/`setRequestHeader` to tag each XHR instance with `_url`/`_id`/`_startTime`, wraps `onreadystatechange` to intercept the `DONE` state, dispatches the same `SaveBatch` event, and stores the XHR + its original callback in an `eventHandlers` map keyed by request id. `setupResponseListener()` (lines 161-194) listens for `CustomFeedReady` and uses `Object.defineProperty` to override `xhr.responseText`/`xhr.response` with the processed body before invoking the original callback.

**Injection mechanism (page context vs isolated world):** `src/content/content-script.ts` runs in the content script's isolated world at `document_start` (per the manifest). It cannot override the page's own `window.fetch`/`XMLHttpRequest` in a way that affects the page's own JS, because the isolated world has a separate global object. So `modules/script-injector.ts`'s `injectInterceptorScript()` creates a `<script src="chrome-extension://<id>/injected.js">` tag and appends it to `document.head` — this loads `dist/injected.js` (the output of the second, `interceptor.config.js`, Vite build) *as a page script*, running in the page's own JS context, which is where the actual `fetch`/XHR overrides in `interceptor.ts`/`fetch-interceptor.ts`/`xhr-interceptor.ts` take effect. Communication back across the isolated-world/page-context boundary happens via `window.postMessage`/`window.addEventListener('message', ...)` and via `CustomEvent`s dispatched on `window` (`SaveBatch`, `CustomFeedReady`, `locationchange`) — both mechanisms are visible to both worlds on the same `window` object. This is exactly why `BrowserExtension/CLAUDE.md`'s architecture note says the interceptor and content-script bundles are "compiled and loaded separately."

---

## 4. Message passing

### `chrome.runtime.sendMessage` / `onMessage` (background ⇄ content script / popup / options)

All handled in `src/background/index.ts:334-505` unless noted.

| Message `type` | Sender | Receiver | Payload shape | Response shape |
|---|---|---|---|---|
| `getStatus` | content-script.ts (`ensureBackgroundScriptReady`, line 175); also content modules/message-handler.ts handles this *type* as `action` on the content-script side for messages *from* background | background | `{ type: 'getStatus' }` | `{ status: 'active', version, mode, logging }` |
| `updateStyles` | options.ts (`updateContentScriptStyles`), background (forwarding) | background → (fan-out) all tabs matching twitter/x/reddit via `chrome.tabs.sendMessage` | `{ type: 'updateStyles', cssVariables: Record<string,string> }` | `{ success: true }` (from background to sender) |
| `getSettings` | content/modules/message-handler.ts (`requestInitialSettings`) | background | `{ type: 'getSettings' }` | `{ settings }` (falls back to `defaultSettings`) |
| `updateSettings` | (options/popup — call site not directly observed in files read, but background implements it) | background → fan-out `settingsUpdated` to all tabs | `{ type: 'updateSettings', settings: Partial<Settings> }` | `{ success: true, settings }` |
| `testConnection` | (UI) | background | `{ type: 'testConnection' }` | `{ connected: boolean }` |
| `signIn` | popup.ts (`initAuthentication`), options.ts (`handleSignIn`) | background | `{ type: 'signIn' }` | `{ success: boolean, user?: GoogleUserInfo }` |
| `signOut` | popup.ts, options.ts (`handleSignOut`) | background | `{ type: 'signOut' }` | `{ success: boolean }` |
| `getUserInfo` | popup.ts (`initAuthentication`), options.ts (`checkAuthState`), `api-service.ts` (`getUserInfo()`) | background | `{ type: 'getUserInfo' }` | `{ user: { id, isGoogle, user?: {name,email,picture} } \| null }` |
| `getWebSocketStatus` | popup.ts (`setupWebSocketStatus`) | background | `{ type: 'getWebSocketStatus' }` | `{ connected: boolean }` |
| `pollImageResult` | content-script.ts (`setupExtensionBridge`, legacy polling fallback branch) | background | `{ type: 'pollImageResult', imageUrl: string, filters: string[] }` | `{ success: boolean, result?, error? }` |
| `websocketStatusChanged` | background (not shown being sent in the files read, but popup.ts listens for it) | popup | `{ type: 'websocketStatusChanged', connected: boolean }` | — (broadcast, no response) |
| `filters_updated` | `api-service.ts` (`wsClient.on('filters_updated', ...)` handler, forwarding a WS event) | any listener (none observed consuming it) | `{ type: 'filters_updated', filters: <ws message data> }` | — |
| `chat_stream` | `api-service.ts` (`wsClient.on('chat_response', ...)` handler) | any listener (none observed consuming it) | `{ type: 'chat_stream', data: <ws message data> }` | — |
| `getStatus` (content, `action` field) | background | content-script (`modules/message-handler.ts:25-33`) | `{ action: 'getStatus' }` | `{ status: 'active', platform, url, debug }` |
| `toggleDebug` | background | content-script | `{ action: 'toggleDebug' }` | `{ success: true, debug }` (also `window.postMessage({type:'toggleDebug'})` into page) |
| `settingsUpdated` (content, `type` field) | background (fan-out) | content-script (`modules/message-handler.ts:44-48`) | `{ type: 'settingsUpdated', settings }` | `{ success: true }` (also relayed into page via `window.postMessage`) |
| `updateStyles` (content, `type` field) | background (fan-out) | content-script (`modules/message-handler.ts:51-55`) | `{ type: 'updateStyles', cssVariables }` | `{ success: true }` (relayed into page) |

`chrome.runtime.connect({ name: "settings-sync" })` is opened by `content/modules/message-handler.ts:59` purely to keep a long-lived port alive for settings sync detection; background's matching `chrome.runtime.onConnect` handler (`src/background/index.ts:508-514`) only logs disconnects — no messages are exchanged over this port in the code read.

### `window.postMessage` (isolated-world content-script ⇄ page-context interceptor)

| Message `type` | Sender | Receiver | Payload |
|---|---|---|---|
| `diymod_get_extension_id` | page context (not shown in files read, but handled by bridge) | content-script.ts (`setupExtensionBridge`, line 36) | `{ type: 'diymod_get_extension_id' }` → replies `{ type: 'diymod_extension_id', extensionId }` |
| `diymod_wait_for_image` | page context (`utils/markers.ts: waitForImageResult`, line 713) | content-script.ts (`setupExtensionBridge`, line 45) | `{ type, requestId, imageUrl, filters }` → replies `{ type: 'diymod_image_processed', requestId, result? , error? }` (via `apiService.waitForImageProcessing`) |
| `diymod_poll_image_request` (legacy fallback) | page context | content-script.ts (line 83) | `{ type, requestId, imageUrl, filters }` → forwards to background as `pollImageResult`, replies `{ type: 'diymod_poll_image_response', requestId, response }` |
| `diymod_poll_image_response` | content-script.ts | interceptor.ts (`setupExtensionMessaging`, line 152) re-broadcasts the same message back onto `window` for page-context listeners | `{ type, requestId, response }` |
| `diymod_image_processed` | content-script.ts | page context (`utils/markers.ts: waitForImageResult`'s message listener, line 727) | `{ type, requestId, result? , error? }` |
| `getSettings` | page context (`interceptor/ui/style-manager.ts: setupStyleListener`, line 209) | content-script.ts (`modules/event-handler.ts:35-50`) | `{ type: 'getSettings' }` → content-script calls `chrome.runtime.sendMessage({type:'getSettings'})` then replies `{ type: 'settingsResponse', settings }` |
| `settingsResponse` | content-script.ts (`modules/event-handler.ts`, `modules/message-handler.ts: requestInitialSettings`) | page context (`interceptor/ui/style-manager.ts:190-205`) | `{ type: 'settingsResponse', settings }` |
| `updateStyles` | content-script.ts (`modules/message-handler.ts: handleSettingsUpdate`/`handleStyleUpdate`) | page context (`interceptor/ui/style-manager.ts:184-187`) | `{ type: 'updateStyles', cssVariables }` |
| `settingsUpdated` | content-script.ts (`modules/message-handler.ts: handleSettingsUpdate`, line 73) | page context (no direct listener observed in `interceptor/` files; likely informational/future use) | `{ type: 'settingsUpdated', settings }` |
| `toggleDebug` | content-script.ts (`modules/message-handler.ts:38`) | page context (no listener observed in files read) | `{ type: 'toggleDebug' }` |

### `CustomEvent` on `window` (page-context interceptor ⇄ isolated-world content-script, same `window` object)

| Event name | Dispatched by | Listened by | Detail payload |
|---|---|---|---|
| `SaveBatch` | `BaseInterceptor.dispatchSaveBatchEvent()` (`network/base-interceptor.ts:77-86`), called from both `FetchInterceptor` and `XhrInterceptor` | `content/modules/event-handler.ts:19` (`setupEventListeners`) | `InterceptedRequest { id, url, type, startTime, response }` |
| `CustomFeedReady` | `content/modules/event-handler.ts` (`handleInterceptedRequest`/`sendOriginalResponse`) | `FetchInterceptor`'s per-request listener (`fetch-interceptor.ts:117`) and `XhrInterceptor.setupResponseListener()` (`xhr-interceptor.ts:164`) | `{ id, url?, response: string }` |
| `locationchange` | `RequestInterceptor.setupUrlChangeTracking()` (`interceptor.ts:120-145`), fired on `history.pushState`/`replaceState`/`popstate` | `interceptor.ts` itself (just logs the new URL) — no other consumer observed | native `Event` (no detail) |

---

## 5. Storage

### `chrome.storage.sync` (synced across the user's signed-in Chrome instances)
| Key | Shape | Read/write sites |
|---|---|---|
| `user_id` | `string` (UUID from `crypto.randomUUID()`, or Google user id after sign-in) | Written: `background/index.ts: initializeUserId` (line 62), `signInWithGoogle` (line 93), `signOut` (line 210); also written redundantly by `shared/config.ts: loadUserId()` (line 265) if missing. Read: `background/index.ts` (`getUserId`, `getUserInfo`, `getWebSocketStatus` handler), `shared/config.ts` (`loadUserId`, `loadConfig`), `shared/api/api-service.ts: getUserId()` (line 846), `popup.ts: init()`/`waitForUserId()`. |
| `google_user_info` | `GoogleUserInfo { id, email?, name?, picture?, token? }` | Written: `background/index.ts: signInWithGoogle` (line 96). Read/removed: `background/index.ts: getUserInfo` (line 235), `signOut` (line 196, then `remove`d at line 206). |
| `settings` | `{ enabled, blurHoverEffect, blurIntensity, overlayStyle, showOverlayBorder, overlayBorderWidth, overlayBorderColor, showRewriteBorder, rewriteBorderWidth, rewriteBorderColor, darkMode, accentColor, imageProcessing: { enabled, maxPostsWithImages, maxImagesPerPost } }` (see `defaultSettings`, `background/index.ts:28-46`) | Written/read exclusively in `background/index.ts` (`loadSettings`/`saveSettings`), exposed to other contexts only via the `getSettings`/`updateSettings` runtime messages. |
| `diy_mod_config` | The entire `Config` object from `shared/config.ts` (minus `userId`, which is preserved separately) | Written: `shared/config.ts: saveConfig()`. Read: `shared/config.ts: loadConfig()` (merges onto in-memory defaults via `Object.assign`). |
| `diy_mod_user_id` | `string` — written by `options.ts: regenerateUserId()` (line 430) | **Likely dead/inconsistent**: this key is distinct from `user_id` (the one actually read everywhere else); `regenerateUserId()` also sets `config.userId` and the `userIdInput` field directly but does not appear to update the canonical `user_id` key, so the "regenerate" feature in Options may not actually change the ID used by API calls. Flagging as a discrepancy rather than fixing it (read-only task). |

### `chrome.storage.local` (per-device only)
| Key | Shape | Read/write sites |
|---|---|---|
| `keepAlive` | `number` (timestamp) | Written every 20s by `background/index.ts:24` purely to keep the MV3 service worker from being suspended; not read anywhere observed. |
| `savedPopupState` | `PopupSessionState { currentState: FilterState, filterData: FilterData, conversationHistory: any[], chatAreaContent: string, timestamp: number }` | Written: `popup-state-manager.ts: saveCurrentState()` (debounced 500ms, only while in `CLARIFYING`/`FILTER_CONFIG`). Read: `popup-state-manager.ts: restoreSavedState()` (only restores if not too old — code checks `3 * 60 * 1000` ms despite a comment saying 30 minutes — and only if current state is `INITIAL`/`COMPLETE`). Removed: `popup-state-manager.ts: clearStorageState()`, called after a filter is saved or the user declines to resume. Also watched via `chrome.storage.onChanged` by both `popup.ts:131` (cross-instance refresh) and `popup-state-manager.ts: setupStorageListener()` (debug logging only). |

### `localStorage` (page/extension-page scoped, not `chrome.storage`)
| Key | Shape | Read/write sites |
|---|---|---|
| `diy_mod_dev_mode` | `'true' \| 'false'` string | Written: `shared/config.ts: setDevelopmentMode()`; also cleared by `options.ts: resetDefaults()`. Read: `shared/config.ts: isDevelopment()`. |
| `diy_mod_logging_config` | JSON-serialized `LoggingConfig` (see `shared/logging-config.ts`) | Written/read only within `shared/logging-config.ts` itself (`getLoggingConfig`/`setLoggingConfig`); **UNVERIFIED as actually consumed elsewhere** — no caller of `getLoggingConfig`/`enableDebugLogging` was found among the files read. |

---

## 6. Backend calls

All via `src/shared/api/api-service.ts` (`ApiService`, exported singleton `apiService`) unless noted; base URL is `config.api.baseUrl` = `'http://127.0.0.1:8001'` by default (`shared/config.ts:104`).

| Endpoint | Method | Caller(s) | Payload | Notes |
|---|---|---|---|---|
| `/get_feed` (`config.api.endpoints.process`) | POST | `apiService.processFeed()` (line 181), called from `content/modules/api-connector.ts: processInterceptedRequest`/`batchProcessFeed` | `{ user_id, url, data: { feed_info: { response: <raw feed string> } } }`; header `Authorization: Bearer <token>` if a Google token exists | Response expected as `FeedResponse { feed: { response: string } }`. Has a batching path (`client.postRequest`) gated by `config.api.batchingEnabled` (default `false`). |
| `/process_content` | POST | `apiService.processContent()` (line 264) — used only by the apparently-unused `content/services/interceptor.ts` adapter path | `{ tab_id: chrome.runtime.id, user_id, extension_version, data: { posts } }` | Returns `result.processed_posts`. |
| `/chat` | POST | `apiService.sendChatMessage()` (line 360); also called directly via `fetch` in `popup.ts: sendToLLM()` (line 529) | `{ message, history, user_id }` | Returns `LLMResponse`. Has a batching variant via `client.addToBatch('/chat', ...)`. |
| `/chat/image` | POST (multipart `FormData`) | `apiService.processImage()` (line 474); also called directly via `fetch` in `popup.ts: sendImageToLLM()` (line 466) | `FormData` with `image` (File), optional `message`, `history` (JSON string), `user_id` | Returns `LLMResponse`. |
| `/filters?user_id=<id>` | GET | `apiService.getUserFilters()` (line 516); also called directly via `fetch` in `popup.ts: checkExistingFilters()` (line 301) | — | Returns `{ status, filters: Filter[] }`. |
| `/filters` | POST | `apiService.createFilter()` (line 552) | `{ user_id, filter_text, content_type, intensity, duration }` | |
| `/filters/<id>?user_id=<id>` | DELETE | `apiService.deleteFilter()` (line 590) | — | |
| `/filters/<id>` | PUT | `apiService.updateFilter()` (line 621) | `{ user_id, filter_text, content_type, intensity, duration }` | |
| `/ping` | GET | `apiService.testConnection()` (line 662); `background/index.ts: checkServerConnection()`; `options.ts: testConnection()`; `content/modules/api-connector.ts: testApiConnection()` (via `apiService.testConnection`) | — | Simple reachability check. |
| `/get_img_result` (`config.api.endpoints.imageResult`) | GET | `apiService.pollForImageResult()` (private, line 759, fallback when WebSocket unavailable); `background/index.ts: pollForImageResult()` (line 285, for the legacy page→background polling bridge) | Query params: `img_url`, `filters` (JSON-stringified array) | Polled with either exponential backoff or a "custom timing" schedule (first two attempts 5s, remaining 2.5s ± jitter) per `config.api.polling`; returns `{ status: 'COMPLETED', processed_value, base64_url? }` when ready. |
| `/user/update` | POST | `background/index.ts: updateUserInfoOnServer()` (line 120) | `{ user_id, email }` | Only called if `config.userStudy.active && config.userStudy.collectEmail` are both true. |
| `https://www.googleapis.com/oauth2/v1/userinfo?alt=json` | GET | `background/index.ts: fetchGoogleUserInfo()` (line 167) | header `Authorization: Bearer <token>` | Not the SHIELD backend — Google's own userinfo endpoint, used after `chrome.identity.getAuthToken`. |
| `https://accounts.google.com/o/oauth2/revoke?token=<token>` | GET | `background/index.ts: signOut()` (line 199) | — | Revokes the Google OAuth token on sign-out. |
| `${config.api.baseUrl}/logging` | POST | `utils/logger.ts: Logger.remoteLog()` (line 54) | `{ level, message, context, timestamp, data }` | Part of the apparently-unused `Logger` class (see §2); gated by `config.logging.enableRemoteLogging` which defaults `false` (`shared/config.ts:196`) and is never observed being set `true`. |

### WebSocket

`src/shared/websocket/websocket-client.ts` — `WebSocketClient` class, singleton accessor `getWebSocketClient(userId)`.
- **URL:** `${config.api.websocketUrl}/${userId}` where `config.api.websocketUrl = 'ws://127.0.0.1:8010/ws'` (`shared/config.ts:106`) — note this is a *different port* (8010) than the REST API's 8001, and `config.api.websockets.useWebSockets` **defaults to `false`** (`shared/config.ts:132`), so WebSocket usage is opt-in/disabled by default in this build; the extension falls back to the HTTP polling path (`/get_img_result`) described above.
- **Connect/heartbeat:** `connect()` opens the socket and on `onopen` starts a 30s heartbeat (`startHeartbeat()`, sends `{type:'ping', data:{timestamp}}`), expecting a `pong` within 270s or it force-closes and reconnects (`ws.close()`); reconnection uses exponential backoff capped at 15s, max 20 attempts (`getReconnectDelay()`, `maxReconnectAttempts`).
- **Outgoing message types sent via `wsClient.send(type, data, requestId?)`:**
  - `ping` — heartbeat (`{ timestamp }`).
  - `pong` — reply to server's `ping` (`{ timestamp }`).
  - `wait_for_image` — registers interest in a deferred image result: `{ image_url, filters }`, sent from `apiService.waitForImageProcessing()` (line 743) and re-sent on reconnect via `reRegisterPendingImages()` (line 894).
- **Incoming message types handled via `wsClient.on(type, handler)` registrations in `api-service.ts: initializeWebSocket()`:**
  - `image_processed` — `{ image_url, result, filters, base64_url? }`; resolves the matching callback registered by `waitForImageProcessing()` (exact or normalized-URL match), preferring `base64_url` over the raw URL to avoid CSP/mixed-content issues.
  - `filters_updated` — rebroadcast to extension contexts via `chrome.runtime.sendMessage({ type: 'filters_updated', filters: message.data })`.
  - `chat_response` — rebroadcast via `chrome.runtime.sendMessage({ type: 'chat_stream', data: message.data })`.
  - `reconnected` — synthetic client-side event (not from the server) fired by `WebSocketClient` itself when `onopen` detects `reconnectAttempts > 0 || connectionCount > 1`; `api-service.ts` uses it to refresh `userId` and re-register pending image waits.
- Matches the root `CLAUDE.md`'s description of the backend's `ConnectionManager`/`/ws/{user_id}` protocol with heartbeat/registration.

---

## 7. Build & load instructions

**Build:**
```bash
cd BrowserExtension
npm install
npm run build
```
This runs, in order (`package.json:8`): `tsc` (typecheck only — Vite does its own transpilation, so this step exists to catch type errors, not to emit files used by the bundle) → `vite build` (emits `dist/manifest.json`, `dist/src/background/index.js`, `dist/src/content/content-script.js`, `dist/src/popup/*`, `dist/src/options/*`, copies `public/` assets) → `vite build --config interceptor.config.js` (emits `dist/injected.js` + its sourcemap, without clearing `dist/` thanks to `emptyOutDir: false`) → `node fix-manifest.js` (patches `dist/manifest.json`).

**Load unpacked:**
1. `chrome://extensions`
2. Enable "Developer mode"
3. "Load unpacked" → select `BrowserExtension/dist`

**Why `fix-manifest.js` exists:** `vite-plugin-web-extension` processes the manifest's `background.service_worker` and `content_scripts[].js` entries as *source* references, so when the input manifest (`public/manifest.json`) points at TypeScript-looking paths, the plugin can emit `dist/manifest.json` still referencing `.ts` extensions (e.g. `src/background/index.ts`) even though the actual compiled output on disk is `.js` (per the custom `entryFileNames` mapping in `vite.config.js`). A manifest pointing at a `.ts` file that doesn't exist in `dist/` would make Chrome fail to load the service worker or content script. `fix-manifest.js` reads `dist/manifest.json` after the Vite build, does a literal `.replace('.ts', '.js')` on `background.service_worker` and each `content_scripts[].js` string (`fix-manifest.js:19-46`), and writes the file back — this is exactly the reload-stale-`dist/` caveat called out in the root `CLAUDE.md`'s Browser Extension Architecture section ("changes to one don't take effect for the other's context, and `dist/manifest.json` is only correct after `fix-manifest.js` runs"). Running `vite build` directly (skipping the `npm run build` script) would skip this step and leave a manifest Chrome can't fully load for the background/content-script paths.

---

## Appendix: files not fully read in this pass

- `src/utils/logging.ts`, `src/utils/logging-utils.ts` — referenced (and apparently overlapping) helper modules exporting `safeUrlLog`, `debugLog`, `logError`, `logInfo`; not opened in this audit. **UNVERIFIED: exact contents/duplication relationship between the two files.**
- `src/options/options.css`, `src/popup/popup.css`, `src/content/content-styles.css` — stylesheets, not analyzed for content (out of scope for a message/API/storage map).
- `dist/` build output and `public/libs/client.js` — build artifacts / a vendored library file, not part of the source map.
