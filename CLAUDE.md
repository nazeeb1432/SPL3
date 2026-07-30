# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SHIELD is based on **DIY-MOD**, a personalized content moderation system that transforms (rather than blocks) social media content — blurring, overlaying warnings, rewriting text, or AI-editing images — based on each user's natural-language filter preferences. It implements the system described in the CHI '26 paper "What If Moderation Didn't Mean Suppression?" (see `README.md` and `Paper/`).

The repo has three independent subprojects that only communicate over HTTP/WebSocket — there is no shared build:

1. **`Backend/`** — Python/FastAPI server + Celery workers. Does all LLM/vision processing, filter storage, and caching. This is where almost all backend work happens.
2. **`BrowserExtension/`** — Chrome MV3 extension (TypeScript/Vite) that intercepts Reddit/Twitter/X network responses and DOM, and rewrites them according to the Backend's response.
3. **`reddit-clone/`** — Next.js app used only for controlled user-study experiments (Dual-Feed System). Not part of the production extension flow.

## Common Commands

### Backend (Python 3.8+)
```bash
cd Backend
source venv/bin/activate           # venv already exists in repo
pip install -r requirements.txt

# Run the three required services (separate terminals):
redis-server
celery -A celery_gevent_worker worker --loglevel=info -P gevent -c 1000
python app.py                      # Hypercorn server on http://localhost:8001, auto-reloads on save
```
No test suite currently exists in `Backend/` despite `pytest`/`pytest-asyncio` being listed in `requirements.txt`. There is no configured lint/format step (black/flake8/mypy are listed as deps but not wired to a script) — run them manually if needed, e.g. `black .`, `flake8 .`.

Environment variables live in `Backend/.env` (copy from `.env.template`); requires `OPENAI_API_KEY` and `GOOGLE_API_KEY`. `Backend/config.yaml` holds non-secret runtime config (LLM model names, processing thresholds, DB URL, logging).

Useful one-off scripts (all run from `Backend/`):
```bash
python process_json_custom_feed.py --create-example      # generate a sample feed JSON
python process_json_custom_feed.py custom_feed_example.json --save --user demo-user --title "Test Feed"
python process_comparison.py                              # generate original+filtered comparison feeds
python reddit_post_fetcher.py                              # standalone Reddit fetch helper
```

### Browser Extension (Node 16+)
```bash
cd BrowserExtension
npm install
npm run build     # tsc + two vite builds (main bundle + isolated interceptor bundle) + fix-manifest.js
npm run dev        # vite dev server
```
Load unpacked from `BrowserExtension/dist` via `chrome://extensions`. There is no test runner configured.

### Reddit Clone / Dual-Feed research tool (Node 16+)
```bash
cd reddit-clone
npm install
npm run dev        # http://localhost:3000, needs NEXT_PUBLIC_API_URL in .env.local pointing at the Backend
npm run lint
```

## Backend Architecture

**Request flow (`app.py`):** The extension POSTs raw feed HTML/JSON to `/get_feed` with a `url` used to detect platform (`reddit` vs `twitter`/`x`). `PLATFORM_PROCESSORS` dispatches to `processors/reddit_processor.py` or `processors/twitter_processor.py`, both subclassing `processors/base_processor.py:ContentProcessor`. Each incoming/outgoing feed body is also logged to `Backend/data/requests/<user_id>_<timestamp>/`.

**Content pipeline (`ContentProcessor.process_post`):**
1. Loads the user's active `Filter` rows from SQLite (`database/`) as `ContentFilter` objects.
2. `llm/processor.py:LLMProcessor.evaluate_content` asks an LLM whether post text matches any filter, applying per-intensity confidence thresholds (stricter in `balanced` mode, looser in `aggressive` mode — set in `config.yaml` under `processing.default_mode`).
3. If matched, `LLMProcessor.process_content` picks an intervention level — either forced via `post_metadata['text_intervention']` or dynamically chosen by `select_text_intervention` (an LLM call scoring "Modify Segments"/"Add Warning"/"Rewrite" against coherence/fidelity/emotional-impact) — then wraps the affected text in one of three marker pairs (`__BLUR_START__/END__`, `__OVERLAY_START__/END__`, `__REWRITE_START__/END__`) inside `[TITLE]`/`[BODY]` tags. These markers are later parsed and rendered by the extension (`BrowserExtension/src/utils/markers.ts`), not by the backend.
4. Images go through a separate path: `ImageProcessor/ImageProcessor.py` calls `FilterUtils.get_best_filter` to pick the most relevant filter for an image, then dispatches a Celery job (`tasks.py:run_intervention_workflow`) rather than blocking the request — the API response marks the image `"status": "DEFERRED"` and the extension polls `/get_img_result` or waits on the `/ws/{user_id}` WebSocket for `image_processed` events.

**Async image processing (`tasks.py` + `interventions/` + `ml_models/`):** Celery tasks run under gevent (`celery_gevent_worker.py`, broker/backend = Redis). `run_intervention_workflow` supports two modes:
- `direct`: runs one named intervention from `INTERVENTION_REGISTRY` (blur, occlusion, shrink, replacement, stylization variants, inpainting, warning, selective-stylize variants) and caches the result.
- `rank` (default): batch-generates several candidate interventions concurrently (gevent pool), then uses a VLM (`score_intervention` task, via `MODEL_REGISTRY`: openai/gemini/local GroundingDINO) to score each candidate against the original image and picks the winner in `finalize_workflow`. Results are cached (`ServerCache/CacheManager.py:ImageCacheManager`, backed by Redis) and pushed both via a Redis pub/sub channel (`image_processing_complete`, consumed in `app.py:subscribe_to_image_notifications`) and directly via the in-process `ConnectionManager` for WebSocket clients.
- Interventions and models are both pluggable registries (`INTERVENTION_REGISTRY`, `MODEL_REGISTRY` in `tasks.py`) — adding a new one means creating a class in `interventions/` (extends `interventions/base.py:ImageIntervention`) or `ml_models/` (extends `ml_models/base.py:ImageModel`) and registering it in both places (`tasks.py` for workers, and anywhere else that lists candidate names, e.g. `ImageProcessor.py`'s fallback list).

**Filter model:** A `Filter`/`ContentFilter` has `filter_text`, `intensity` (1-5, drives both confidence thresholds and intervention aggressiveness), `content_type` (`text`/`image`/`all`), and optional expiry (`is_temporary`/`expires_at`). Filters are created either directly via `/filters` REST endpoints or conversationally via `/chat` and `/chat/image`, both backed by `llm/chat.py:FilterCreationChat` and `llm/vision.py:VisionFilterCreator`, which use `llm/filter_creator.py` and `llm/prompts.py` to turn natural language into structured `ContentFilter` objects.

**Custom feeds / research tooling:** `processors/standalone_custom_processor.py` and `custom_feed_models_pkg/` implement an isolated path (`/custom-feed/*` endpoints, also reachable over WebSocket via `custom_feed_process`/`custom_feed_auto_filter` message types) for processing hand-authored JSON feeds without going through the extension — used to generate the "original vs. filtered" comparison feeds consumed by `reddit-clone/`. `database/models.py:CustomFeed` groups an original/filtered pair via `comparison_set_id`; `HumanPreference` stores study-participant votes between the two, submitted via `/human-preferences/*`.

**Config precedence:** `utils/config.py:ConfigManager` is a singleton loading `config.yaml`, then overridden by specific env vars (`CONTENT_PROCESS_MODEL`, `PROCESSING_MODE`, etc. — see `_apply_env_vars`). Prefer changing `config.yaml` for durable settings; env vars are for per-environment overrides.

**Database:** SQLite (`Backend/filters.db`) via SQLAlchemy, models in `database/models.py`, all query/write helpers in `database/operations.py` re-exported through `database/__init__.py`. `app.py` and other callers import from `database` directly (e.g. `from database import get_user_filters`), not from the submodules.

## Browser Extension Architecture

MV3 extension built with Vite (`vite-plugin-web-extension`), producing three separate bundles from one `npm run build`: the main content script, the background service worker, and an isolated "interceptor" bundle (`src/content/interceptor/interceptor.ts` → `dist/injected.js`) built as a second Vite pass (`interceptor.config.js`) because it must be injected into the page's own JS context (not the content-script's isolated world) to intercept `fetch`/`XHR` before the page's own JS reads the response.

- `src/content/content-script.ts` runs in the isolated world at `document_start`, injects `injected.js` into the page, and relays messages between the page-context interceptor and the extension background/backend.
- `src/content/interceptor/` (page context): `interceptor.ts` wires up `network/fetch-interceptor.ts` and `network/xhr-interceptor.ts` to capture Reddit/Twitter API responses before the page renders them, then hands them to `ui/dom-processor.ts` and `ui/style-manager.ts` for in-place DOM rewriting.
- `src/content/platforms/{reddit,twitter}.ts` hold the platform-specific parsing/matching logic; `modules/platform-detector.ts` picks which one applies.
- `src/shared/api/api-service.ts` talks to the Backend REST endpoints; `src/shared/websocket/websocket-client.ts` maintains the `/ws/{user_id}` connection used for deferred image-processing notifications (mirrors the heartbeat/registration protocol implemented in `app.py`'s `ConnectionManager`).
- `src/utils/markers.ts` is the counterpart to `Backend/llm/processor.py`'s marker scheme — it parses `__BLUR_START__`/`__OVERLAY_START__`/`__REWRITE_START__` spans out of processed text and renders the corresponding blur/overlay/rewrite UI.
- `src/popup/` and `src/options/` are the toolbar popup and full-page settings UI; both read/write filters through `src/shared/state/filter-store.ts` (Zustand).

When changing the network interception logic, remember the interceptor bundle and content-script bundle are compiled and loaded separately — changes to one don't take effect for the other's context, and `dist/manifest.json` is only correct after `fix-manifest.js` runs (part of `npm run build`), so avoid loading a stale `dist/` after only running `vite build` directly.

## Reddit Clone (research tool)

Standard Next.js 14 App Router app (`app/`, `components/`, `lib/`). It is a read-only *consumer* of feeds already saved to the Backend's `CustomFeed`/comparison-set tables (via `process_json_custom_feed.py` or `/custom-feed/*` endpoints) — it does not talk to Reddit/Twitter directly. `lib/intervention-parser.ts` and `lib/html-parser.ts` are the frontend equivalents of the extension's marker-parsing logic, adapted for rendering saved HTML feeds rather than live-intercepted ones.
