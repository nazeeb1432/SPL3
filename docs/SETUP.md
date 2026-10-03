# SHIELD Setup

Three independent subprojects, each run separately. The Backend needs three services running
concurrently (Redis, a Celery worker, the API server) before the extension will do anything useful.

## 1. Redis

The backend hardcodes `redis://localhost:6379/0` as both the Celery broker/backend
(`Backend/tasks.py`) and the cache connection (`Backend/ServerCache/RedisCache.py`,
`host='localhost', port=6379`) — Homebrew's default install/port matches this exactly, no config
needed.

```bash
brew install redis
redis-server            # foreground; or `brew services start redis` to run it as a background service
```

Verify it's up: `redis-cli ping` should print `PONG`.

## 2. Backend setup

```bash
cd Backend
python3 -m venv venv     # skip if venv/ already exists in the repo
source venv/bin/activate
pip install -r requirements.txt

cp .env.template .env    # then fill in real values — see Backend/CLAUDE.md gotchas
```

`.env` must contain real values, not placeholders — at minimum `OPENAI_API_KEY` and
`GOOGLE_API_KEY`. See `docs/backend.md`'s env-var table for the full set actually read by code
(several vars the backend reads, e.g. `USE_S3`, `DEBUG_MODE`, `PROCESSING_MODE`,
`WEBSOCKETS_ENABLED`, are **not** in `.env.template` — add them yourself if you need non-default
behavior).

## 3. Celery worker

Exact invocation, verified against `Backend/celery_gevent_worker.py` (which imports the shared
Celery `app` instance — named `'ImageProcessor'` — from `tasks.py`, after calling
`gevent.monkey.patch_all()`):

```bash
cd Backend
source venv/bin/activate
celery -A celery_gevent_worker worker --loglevel=info -P gevent -c 1000
```

Run this in its own terminal, with Redis already up — the worker will fail to connect otherwise.

## 4. Backend API server

```bash
cd Backend
source venv/bin/activate
python app.py
```

Confirmed in `Backend/app.py`'s `if __name__ == '__main__':` block: binds Hypercorn to
`0.0.0.0:8001` with `use_reloader = True` (auto-restarts on source-file changes). The extension's
default config (`BrowserExtension/src/shared/config.ts`) points at
`http://127.0.0.1:8001`, matching this port.

Check it's alive: `curl http://localhost:8001/ping` should return a `{"status":"success",...}` JSON body.

## 5. Build and load the extension

```bash
cd BrowserExtension
npm install
npm run build
```

This is `tsc && vite build && vite build --config interceptor.config.js && node fix-manifest.js`
(exact script from `BrowserExtension/package.json`) — do not run `vite build` directly, or you skip
the second interceptor bundle and the manifest fix-up (see `docs/extension.md`).

Then load it into Chrome:
1. Go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `BrowserExtension/dist` folder (not the repo root, not `src/`)

For iterative frontend-only work, `npm run dev` starts a Vite dev server, but MV3 extensions still
need a `npm run build` + reload in `chrome://extensions` to pick up most changes — `dev` mode is
mainly useful for faster iteration on popup/options HTML, not the content-script/interceptor
pipeline.

## Run order

Start in this order: `redis-server` → Celery worker → `python app.py` → load/reload the extension.
If you change Backend code, Hypercorn's reloader picks it up automatically; if you change
BrowserExtension code, you must re-run `npm run build` and click the reload icon for the extension in
`chrome://extensions`.
