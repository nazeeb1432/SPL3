# Backend/ Guide

FastAPI + Celery/Redis + SQLite backend. ASGI server is **Hypercorn**, bound to `0.0.0.0:8001`
(`Backend/app.py`, `if __name__ == '__main__'` block). Uvicorn is listed in requirements as an
unused alternative (commented out in the same block).

## Folder-by-folder guide

| Folder | Purpose |
|---|---|
| `Backend/` (root) | `app.py` (FastAPI app + all routes), `tasks.py` (Celery tasks + registries), `celery_gevent_worker.py` (worker entrypoint), `settings.py` (loads `.env`, exposes `OPENAI_API_KEY`/`GOOGLE_API_KEY`), `config.yaml` (non-secret runtime config), `models.py` (Pydantic request models for `app.py`), `requirements.txt`, one-off scripts (`process_json_custom_feed.py`, `process_comparison.py`, `reddit_post_fetcher.py` — each both importable by the live server *and* runnable as a CLI). |
| `database/` | SQLAlchemy models (`models.py`) and query/write helpers (`operations.py`), re-exported through `__init__.py`. Physical DB file: `Backend/filters.db` (SQLite). |
| `llm/` | All LLM-driven text/filter logic: `processor.py` (`LLMProcessor` — content match + text intervention), `chat.py` (`FilterCreationChat`, backs `/chat`), `vision.py` (`VisionFilterCreator`, backs `/chat/image`), `filter_creator.py` (one-shot NL→filter), `prompts.py` (prompt text), `chat_system_prompt.py`, `response_models.py` (Pydantic structured-output schemas). |
| `processors/` | Platform dispatch + shared pipeline: `base_processor.py` (`Post`, `ContentProcessor`), `reddit_processor.py`, `twitter_processor.py`, `standalone_custom_processor.py` (isolated `/custom-feed/*` research pipeline). |
| `ImageProcessor/` | `ImageProcessor.py` — entry point called synchronously per post image; picks a filter/interventions via `FilterUtils`, then hands off to Celery (non-blocking). `ObjectDetector/GroundingDINODetector.py` — local HuggingFace zero-shot detector, no API key needed. |
| `FilterUtils/` | `get_image_filter_information()` / `get_best_filter()` — one GPT-4o vision call that both picks the best-matching filter for an image and recommends/ranks candidate interventions (`top3_interventions`/`next2_interventions`). |
| `interventions/` | One file per image intervention (`blur.py`, `occlusion.py`, `shrink.py`, `replacement.py`, `inpainting.py`, `warning.py`, `stylization.py`, plus `stylize_*`/`selective_stylize_*` variants), each extending `base.py:ImageIntervention`. Pluggable — register new ones in `tasks.py:INTERVENTION_REGISTRY`. |
| `ml_models/` | Provider wrappers implementing `base.py:ImageModel`: `openai_models.py`, `gemini_models.py`, `grounding_dino_model.py`. Registered in `tasks.py:MODEL_REGISTRY` as `"openai"`, `"gemini"`, `"local"`/`"grounding_dino"`. |
| `ServerCache/` | `Cache.py` (interface), `RedisCache.py` (concrete Redis impl, TTL 3600s), `CacheManager.py:ImageCacheManager` (per-image-URL cache keyed by image URL, with a filter-string sub-key and an LLM fuzzy-match fallback; publishes to Redis pub/sub channel `image_processing_complete`), `Singletons.py` (process-wide `image_cache` instance). |
| `custom_feed_models_pkg/` | Pydantic models exclusively for the `/custom-feed/*` research path — isolated from the live extension's models in `models.py`. |
| `utils/` | `config.py` (`ConfigManager` singleton), `storage.py` (S3 vs local-disk, `_StorageManager`), `errors.py`, `logging.py`, `default_filters.py`, `preference_manager.py`, `json_utils.py`. |
| `data/requests/` | Per-request raw in/out feed bodies, one subdir per request (`<user_id_prefix>_<timestamp>/`). |
| `temp/uploads/` | Local-disk image storage when `USE_S3=false` (jobs subfolder per Celery `job_id`). |

## Routes (`Backend/app.py`)

| Method | Path | Handler |
|---|---|---|
| OPTIONS | `/{path:path}` | `handle_options` |
| GET | `/ping` | `ping` |
| POST | `/get_feed` | `process_feed_route` |
| GET | `/filters` | `get_filters_route` |
| POST | `/filters` | `create_filter_route` |
| PUT | `/filters/{filter_id}` | `update_filter_route` |
| DELETE | `/filters/{filter_id}` | `delete_filter_route` |
| POST | `/chat` | `chat` |
| POST | `/chat/image` | `chat_with_image` |
| GET | `/get_img_result` | `get_img_result` |
| GET | `/get_img_base64` | `get_img_base64` |
| POST | `/user/update` | `update_user_info_endpoint` |
| WS | `/ws/{user_id}` | `websocket_endpoint` (message `type`s: `chat`, `filter_update`, `wait_for_image`, `ping`, `pong`, `custom_feed_process`, `custom_feed_auto_filter`) |
| POST | `/custom-feed/process` | `process_custom_feed` |
| POST | `/custom-feed/process-with-filters` | `process_custom_feed_with_filters` |
| GET | `/custom-feed/image-status/{session_id}` | `get_custom_image_status` |
| POST | `/custom-feed/save` | `save_custom_feed_endpoint` |
| GET | `/custom-feed/list/{user_id}` | `list_user_custom_feeds` |
| GET | `/custom-feed/retrieve/{feed_id}` | `retrieve_custom_feed` |
| DELETE | `/custom-feed/{feed_id}` | `delete_custom_feed_endpoint` |
| POST | `/custom-feed/process-comparison` | `process_comparison_endpoint` |
| GET | `/custom-feed/comparison-sets/{user_id}` | `list_user_comparison_sets` |
| GET | `/custom-feed/comparison-set/{user_id}/{comparison_set_id}` | `get_feeds_in_comparison_set` |
| GET | `/custom-feed/comparison/{comparison_set_id}` | `get_comparison_feeds` (legacy) |
| POST | `/auth/login-email` | `login_with_email` |
| GET | `/auth/user/{user_id}` | `get_user_info` |
| GET | `/api/feeds/{user_id}` | `get_feeds_list` |
| GET | `/api/feed/{feed_id}/html` | `get_feed_html` |
| POST | `/upload-feed` | `upload_feed` |
| POST | `/human-preferences/submit` | `submit_human_preferences` |
| GET | `/human-preferences/list/{user_id}` | `list_human_preferences` |
| GET | `/human-preferences/stats/{comparison_set_id}` | `get_preference_stats` |

A global `@app.middleware("http")` (`add_private_network_header`) adds
`Access-Control-Allow-Private-Network` to every response. `StaticFiles` is mounted at `/temp/uploads`.
`/custom-feed/*`, `/auth/*`, `/api/feeds*`, `/upload-feed`, `/human-preferences/*` back the
`reddit-clone/` research tool, not the browser extension.

## Celery tasks (`Backend/tasks.py`)

Celery app: `Celery('ImageProcessor', broker='redis://localhost:6379/0', backend='redis://localhost:6379/0')`.

| Task | Purpose |
|---|---|
| `run_intervention_workflow` (bind=True) | Primary entry point, called from `ImageProcessor.process_image()`. Checks the cache, then dispatches `direct` mode (one named intervention) or `rank` mode (default): `process_image_batch` → `run_scoring_and_find_best_batch` → `finalize_workflow`. |
| `process_image_batch` | Downloads the source image once, then runs every candidate intervention concurrently (gevent `Pool`) via `INTERVENTION_REGISTRY`/`MODEL_REGISTRY`. |
| `process_image_intervention` | Runs exactly one named intervention — used by `direct` mode. |
| `run_scoring_and_find_best_batch` | Chord callback: builds one `score_intervention` subtask per successful candidate, chords into `finalize_workflow`. |
| `score_intervention` | VLM call scoring one candidate against the original image, using `IMAGE_SCORER_SYSTEM_PROMPT`/`IMAGE_SCORER_USER_PROMPT_TEMPLATE` (`llm/prompts.py`). |
| `finalize_workflow` | Chord callback: picks the highest-scoring candidate, writes it to the Redis image cache. |

Worker entrypoint: `Backend/celery_gevent_worker.py` (`gevent.monkey.patch_all()` then imports the
shared `app` Celery instance from `tasks.py`) — invoked as
`celery -A celery_gevent_worker worker --loglevel=info -P gevent -c 1000`.

## Data models (`Backend/database/models.py`, SQLAlchemy, `declarative_base()`)

- **`User`** (`users`) — `id`, `email`, `created_at`, `last_active`, `preferences` (JSON). Cascade-deletes `filters`.
- **`Filter`** (`filters`) — `id`, `user_id` (FK), `filter_text`, `filter_type`, `intensity` (1-5), `filter_metadata` (JSON), `is_active`, `created_at`, `updated_at`, `expires_at`, `content_type` (enum `ContentType`: `text`/`image`/`all`), `is_temporary`. Computed `is_expired` property.
- **`ProcessingLog`** (`processing_logs`) — `id`, `user_id` (FK), `platform`, `content_hash`, `matched_filters` (JSON), `processing_time`, `created_at`, `processing_metadata` (JSON).
- **`CustomFeed`** (`custom_feeds`) — `id`, `user_id` (FK), `title`, `feed_html`, `feed_metadata` (JSON), `comparison_set_id` (groups original/filtered pairs), `feed_type` (`original`/`filtered`), `filter_config` (JSON), timestamps.
- **`HumanPreference`** (`human_preferences`) — `id`, `user_id` (FK), `comparison_set_id`, `post_id`, `post0_text_content`, `post1_text_content`, `text_preference` (0/1/NULL), `post0_image_url`, `post1_image_url`, `image_preference` (0/1/NULL), `created_at`.

All reads/writes go through `database/operations.py:get_db()` (commit-on-success,
rollback-on-exception). `app.py` imports exclusively via `from database import ...`
(a curated re-export from `database/__init__.py`), except `HumanPreference` helpers and a couple of
routes which import `database.operations`/`database.models` directly.

## LLM / ML usage

| Provider | Where | Model(s) |
|---|---|---|
| OpenAI | `llm/chat.py` (chat model) | `gpt-4o` (config.yaml `llm.chat_model`) |
| OpenAI | `llm/vision.py` (filter creation from image) | `gpt-4o` (`llm.filter_model`) |
| OpenAI | `llm/filter_creator.py` | `os.getenv('FILTER_CREATION_MODEL')`, default `gpt-4o` |
| OpenAI | `llm/processor.py` (content match + text intervention, `AsyncOpenAI`) | `gpt-4o-mini` (`llm.content_model`) |
| OpenAI | `FilterUtils/FilterUtils.py` (image filter/intervention selection) | `gpt-4o` (hardcoded) |
| OpenAI | `ml_models/openai_models.py` | `gpt-4o-mini` (describe), `gpt-image-1`/`dall-e-2` (edit), `gpt-4o` (score/detect) |
| Google Gemini | `llm/processor.py` (`google.genai` client; imported but the active text-intervention path uses OpenAI, not this) | — |
| Google Gemini | `ml_models/gemini_models.py` (live image generate/edit/score path) | `gemini-2.5-flash-image` (generate/edit), `gemini-2.5-flash` (score/detect) |
| Google Gemini (via OpenAI-compatible endpoint) | `ServerCache/CacheManager.py` (fuzzy filter-match fallback) | `gemini-2.5-flash` |
| Local (no API key) | `ml_models/grounding_dino_model.py` → `ImageProcessor/ObjectDetector/GroundingDINODetector.py` | HuggingFace `AutoModelForZeroShotObjectDetection` zero-shot detector |

Prompt templates live in `llm/prompts.py` (`FILTER_CREATION_PROMPT`, `FILTER_EVALUATION_PROMPT`,
`IMAGE_SCORER_SYSTEM_PROMPT`/`IMAGE_SCORER_USER_PROMPT_TEMPLATE`); the conversational system prompt is
in `llm/chat_system_prompt.py`; structured-output schemas in `llm/response_models.py` and inline in
`FilterUtils/FilterUtils.py`.

## Config and environment variables

`utils/config.py:ConfigManager` is a singleton: loads `config.yaml`, then `_apply_env_vars()`
overrides specific fields from env vars. `config.yaml` is for durable settings; env vars are for
per-environment overrides.

### Env vars actually read by code (grepped `os.getenv(`/`os.environ[`/`os.environ.get(` across all of `Backend/`, excluding `venv/`)

| Var | Read in | In `.env.template`? |
|---|---|---|
| `OPENAI_API_KEY` | `settings.py`, `llm/chat.py`, `llm/filter_creator.py`, `llm/processor.py`, `llm/vision.py`, `FilterUtils/FilterUtils.py`, `utils/config.py` (`_apply_env_vars`) | Yes |
| `GOOGLE_API_KEY` | `settings.py`, `llm/processor.py`, `ServerCache/CacheManager.py` | Yes |
| `FILTER_CREATION_MODEL` | `llm/filter_creator.py` directly; also mapped by `utils/config.py` to `llm.filter_model` | Yes |
| `CHAT_MODEL` | `utils/config.py` → `llm.chat_model` | Yes |
| `CONTENT_PROCESS_MODEL` | `utils/config.py` → `llm.content_model` | Yes |
| `PARALLEL_WORKERS` | `utils/config.py` → `processing.parallel_workers` | Yes |
| `AWS_ACCESS_KEY_ID` | `utils/storage.py` | Yes |
| `AWS_SECRET_ACCESS_KEY` | `utils/storage.py` | Yes |
| `AWS_STORAGE_BUCKET_NAME` | `utils/storage.py` | Yes |
| **`WEBSOCKETS_ENABLED`** | `app.py:76` (default `"true"`) | **No — missing from `.env.template`** |
| **`DEBUG_MODE`** | `utils/logging.py`; `utils/config.py` → `logging.level` | **No — missing** (template instead has a commented, unread `LOG_LEVEL`) |
| **`PROCESSING_MODE`** | `utils/config.py` → `processing.default_mode` | **No — missing** |
| **`USE_S3`** | `utils/storage.py:23` (default `"true"`) | **No — missing** |
| **`AWS_S3_REGION_NAME`** | `utils/storage.py` (default `"us-east-1"`) | **No — missing** |

### Vars in `.env.template` never read anywhere in code

- `IMAGE_PROCESSOR_URL`
- `REDIS_URL` (commented; Redis connection is hardcoded `localhost:6379` in both `tasks.py` and `ServerCache/RedisCache.py`)
- `DATABASE_URL` (commented; DB URL is hardcoded via `config.yaml`'s `database.url`, not env)
- `HOST` / `PORT` (commented; Hypercorn bind is hardcoded `0.0.0.0:8001` in `app.py`)
- `LOG_LEVEL` (commented; the code path that actually controls log level reads `DEBUG_MODE`, not `LOG_LEVEL`)

**Takeaway:** `.env.template` should add `WEBSOCKETS_ENABLED`, `DEBUG_MODE`, `PROCESSING_MODE`,
`USE_S3`, `AWS_S3_REGION_NAME`, and either wire up or remove `IMAGE_PROCESSOR_URL`/`REDIS_URL`/
`DATABASE_URL`/`HOST`/`PORT`/`LOG_LEVEL` (this doc only reports the mismatch — no `.env.template`
edit was made as part of this pass).
