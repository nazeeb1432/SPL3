# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

SHIELD is based on **DIY-MOD**, a personalized content moderation system that transforms (rather
than blocks) social media content — blurring, overlaying warnings, rewriting text, or AI-editing
images — based on each user's natural-language filter preferences. It implements the system
described in the CHI '26 paper "What If Moderation Didn't Mean Suppression?" (see `README.md` and
`Paper/`).

## Folder layout

1. **`Backend/`** — Python/FastAPI server + Celery workers. Does all LLM/vision processing, filter
   storage, and caching. This is where almost all backend work happens.
2. **`BrowserExtension/`** — Chrome MV3 extension (TypeScript/Vite) that intercepts Reddit/Twitter/X
   network responses and DOM, and rewrites them according to the Backend's response.
3. **`reddit-clone/`** — Next.js app used only for controlled user-study experiments (Dual-Feed
   System). Not part of the production extension flow.

## Repo-wide rules

- The three subprojects are **independent and only communicate over HTTP/WebSocket** — there is no
  shared build, no shared package, no direct imports across them. Treat each as its own project with
  its own dependencies and its own `CLAUDE.md`.
- The browser extension's interceptor bundle (page JS context) and content-script bundle (isolated
  world) are compiled and loaded **separately** — a change to one does not take effect for the
  other's context until both are rebuilt. Never load a stale `BrowserExtension/dist/` after running
  `vite build` directly instead of `npm run build` (see `docs/extension.md`).
- Text content processing is **synchronous** in the request/response cycle (up to 3 sequential LLM
  calls per matched post); image processing is **always deferred** to Celery and polled/pushed back
  separately. Don't assume both paths behave the same way.
- Two code paths in `BrowserExtension/src/content/` (`platforms/reddit.ts`, `platforms/twitter.ts`,
  `services/interceptor.ts`) and `shared/network.ts` are dead — not reachable from any live Vite
  entry point. Don't extend them; the live interception path is
  `content/interceptor/` + `utils/markers.ts`.

## Documentation map

Detailed, source-verified documentation lives in `docs/` — read these before making non-trivial
changes rather than re-deriving architecture from scratch:

- **`docs/ARCHITECTURE.md`** — what SHIELD does, a component diagram, the main content-processing
  sequence diagram, and the extension-to-backend API contract table.
- **`docs/backend.md`** — folder-by-folder Backend guide, full route/Celery-task/data-model list, LLM
  usage, and the config/env-var cross-check (what's read in code vs. what's in `.env.template`).
- **`docs/extension.md`** — each extension context's role, the full message/storage-key catalogue,
  and the build process.
- **`docs/SETUP.md`** — exact, verified commands to run Redis, the Celery worker, the API server, and
  build/load the extension.

Each subproject also has its own short `CLAUDE.md` (`Backend/CLAUDE.md`,
`BrowserExtension/CLAUDE.md`) with run/test/build commands and gotchas specific to that half — check
those first when working inside either subproject.
