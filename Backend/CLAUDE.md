# Backend/CLAUDE.md

Operational notes for `Backend/`. Architecture, routes, tasks, and LLM usage are documented in
`../docs/backend.md` and `../docs/ARCHITECTURE.md` — this file is commands + gotchas only.

## Run (three separate terminals, in this order)

```bash
redis-server                                                        # terminal 1
cd Backend && source venv/bin/activate
celery -A celery_gevent_worker worker --loglevel=info -P gevent -c 1000   # terminal 2
cd Backend && source venv/bin/activate
python app.py                                                       # terminal 3 — Hypercorn on :8001, auto-reloads on save
```

## Setup

```bash
cd Backend
python3 -m venv venv        # venv/ already exists in the repo — skip if present
source venv/bin/activate
pip install -r requirements.txt
cp .env.template .env       # then fill in real values, see gotchas below
```

No test suite exists despite `pytest`/`pytest-asyncio` in `requirements.txt`. No lint/format step is
wired up (`black`, `flake8`, `mypy` are deps but not scripted) — run manually if needed.

Config precedence: `config.yaml` for durable settings, env vars (`Backend/.env`) for
per-environment overrides — see `../docs/backend.md` for the full read-vs-template env var
cross-check.

## Gotchas (verified against current source)

- **Requires Python 3.10+.** `requirements.txt` pins `contourpy==1.3.1`; contourpy 1.3.x dropped
  Python 3.9 wheel support, so a 3.9 venv will fail to install this dependency.
- **`google-genai` is commented out in `requirements.txt` (lines ~111/114) but is a hard,
  unconditional import.** `llm/processor.py:8` does `from google import genai` at module level (not
  inside a try/except), so you must `pip install google-genai` separately even though
  `requirements.txt` doesn't list it — otherwise the backend fails to start.
- **The historical "`tasks.py` imports `ml_models`/`ImageProcessor`/`FilterUtils` before
  `load_dotenv()`" bug is already fixed.** Current `tasks.py` calls `load_dotenv(..., override=True)`
  at lines 14-15, *before* importing `ml_models`/`interventions`/`utils.storage` (lines 19-24) — so
  `OPENAI_API_KEY`/`GOOGLE_API_KEY` are in `os.environ` by the time those modules load. If you see an
  "API key not found" error at worker startup today, it's not this ordering issue — check `.env`
  itself instead.
- **`.env` must contain real values**, not just be copied from `.env.template` and left with
  placeholder strings — `ConfigManager`/the OpenAI and Gemini SDK clients don't hard-fail at import
  time on a placeholder key, they fail later (often confusingly) on the first real API call.
- Celery app name is `'ImageProcessor'` (defined in `tasks.py`, not in
  `celery_gevent_worker.py`) — the `-A celery_gevent_worker` flag works because that module imports
  and re-exposes the same `app` object; don't point `-A` at `tasks` directly out of habit, either
  works but keep using `celery_gevent_worker` per the gevent monkey-patch ordering it provides.
- Redis and the SQLite DB path are hardcoded (`localhost:6379`, `sqlite:///filters.db` via
  `config.yaml`) — `REDIS_URL`/`DATABASE_URL`/`HOST`/`PORT` in `.env.template` are not read by any
  code path; don't expect setting them to do anything.
