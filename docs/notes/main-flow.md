# SHIELD Main Content-Processing Flow — Verified Trace

Every claim below was verified by directly reading the cited file/line in this pass (not carried over
from `backend-map.md`/`extension-map.md` without re-checking). Anything not directly confirmed is marked
`UNVERIFIED` with a reason.

---

## Corrections to prior notes (`backend-map.md` / `extension-map.md`)

1. **Cache key is NOT `image_url + sorted filter strings`.** `backend-map.md` §4 (`ServerCache/`) states
   the cache key is built from `image_url + sorted filter strings`, citing `CacheManager.py:71-72`. That
   cited method (`_get_key`) exists but is **dead code** — `grep -rn "_get_key\b" Backend/` (excluding
   `venv/`) returns only its own definition at `ServerCache/CacheManager.py:71`, no call site anywhere.
   The methods actually used, `get_processed_value_from_cache`/`set_processed_value_to_cache`, call
   `self._get_cache_transaction_details(cache_key=image_url, ...)` (`CacheManager.py:91`, `:130`) — i.e.
   the real Redis key is the **bare `image_url` string**. The filter string (sorted/joined/normalized
   filter texts, `_get_filter_string`, `CacheManager.py:25-48`) is only used as a **sub-key inside the
   JSON dict value** stored at that Redis key (`value_dict[filter_string] = cache_value`, line 144), with
   an LLM-based fuzzy-match fallback (`_get_value_of_similar_filter`, lines 65-69) when the exact
   sub-key isn't present. `RedisCache.set` (`ServerCache/RedisCache.py:18-25`) applies a 3600s TTL.

2. **"Pruner that ranks candidate interventions, then parallel generation + a Scorer" is partially a
   mismatch with the code's actual stage names/boundaries, and does not apply to text at all.** There is
   no class or function named "Pruner" anywhere in the codebase (`grep -rn "Pruner" Backend/` — no
   results). The rough model's shape is directionally right for the **image path only** (see Hop 8
   below): one combined GPT-4o-vision call (`FilterUtils.get_best_filter` →
   `get_image_filter_information`, `FilterUtils/FilterUtils.py:53-195,197-260`) does double duty as both
   the filter-matching step *and* the "ranking" step — it returns a `top3_interventions`/`next2_interventions`
   split in the *same* response, not a separate stage. The **text** pipeline (Hop 6b) is a completely
   separate 2-to-3-call sequence (`evaluate_content` → `select_text_intervention` → one of
   `_process_low/medium/high_intensity`) that has no ranking/scoring/parallel-generation concept at all —
   conflating the two paths, as the rough model does, is the main thing to correct.

3. **Match-checking and intervention-selection are separate LLM calls for text** (confirming part of the
   rough model, but with an extra step the model omits): `evaluate_content` (filter match, one call,
   `llm/processor.py:89-163`) is followed by a **second** call `select_text_intervention`
   (`llm/processor.py:599-721`, only invoked when `post_metadata['text_intervention']` is not forced) to
   pick among "Modify Segments"/"Add Warning"/"Rewrite", and then a **third** call
   (`_process_low_intensity`/`_process_medium_intensity`/`_process_high_intensity`,
   `llm/processor.py:355-507`) actually produces the marker-wrapped text. So up to 3 sequential LLM calls
   per matched post, not a single combined call and not 2.

4. **WebSocket image-result push is disabled by default, and its configured port doesn't match the
   server anyway.** `BrowserExtension/src/shared/config.ts:132` ships `useWebSockets: false` by default,
   so the extension's default behavior is always the HTTP polling path
   (`apiService.pollForImageResult`, `shared/api/api-service.ts:759-839`) hitting `GET /get_img_result`.
   Separately, even if `useWebSockets` were flipped on, the default `websocketUrl` is
   `ws://127.0.0.1:8010/ws` (`shared/config.ts:106`), but the backend's Hypercorn server only binds
   `0.0.0.0:8001` (`Backend/app.py:1634`, confirmed no `8010` binding exists anywhere in `Backend/`) — the
   WebSocket default config points at a port the server never listens on. `extension-map.md` §6 flags the
   port mismatch but doesn't flag that `useWebSockets` is off by default *in addition to* the bad port —
   both independently mean "no WebSocket, ever, unless a developer edits two separate config values."

5. **`content/platforms/reddit.ts`/`twitter.ts` and `content/services/interceptor.ts` are confirmed dead
   code for the live flow** (extension-map.md already flagged this as "strongly indicated... UNVERIFIED
   as dead code"; this pass confirms it directly, not just by absence of evidence).
   `grep -rn "services/interceptor" BrowserExtension/src --include="*.ts"` returns **zero** importers of
   `content/services/interceptor.ts` anywhere in `src/`, and `content/services/interceptor.ts` itself is
   the only importer of `platforms/reddit.ts`/`platforms/twitter.ts` (`content/services/interceptor.ts:10-11`).
   `vite.config.js`'s only entry points are the manifest-driven ones (background/content-script/popup/options)
   plus `additionalInputs: ["src/content/interceptor/interceptor.ts"]` (`vite.config.js:12`) — none of
   which touch `services/` or `platforms/`. **This means the live extension never parses Reddit/Twitter
   JSON/HTML client-side at all** — it forwards the raw intercepted response text to the backend
   untouched (see Hop 2 below); all structural parsing happens server-side in
   `processors/reddit_processor.py`/`twitter_processor.py`.

---

## Mental-model verdict

The rough model is **roughly right for images, wrong/incomplete for everything else**:

- "Intercepts a feed response, sends the batch to the backend" — **confirmed**, with the caveat that no
  client-side platform parsing happens (correction 5) and the transport is a direct `fetch()` from the
  isolated-world content-script context, not a `chrome.runtime.sendMessage` hop to the background script
  (see Hop 3).
- "Checks each post's text/images against the user's saved filters" — **confirmed**, but text and image
  filter-matching are two entirely separate code paths (`LLMProcessor.evaluate_content` for text vs.
  `FilterUtils.get_best_filter` for images), not one shared step.
- "A Pruner that ranks candidate interventions, then parallel generation + a Scorer" — **only applies to
  images**, and even then "Pruner" isn't a real stage name — it's the same single vision call that does
  filter-matching (see correction 2). The parallel-generation-then-scoring part is accurate for images
  (Hop 8: `process_image_batch` → `run_scoring_and_find_best_batch`/`score_intervention` → `finalize_workflow`).
- For **text**, there is no "rank candidates then score" step at all — it's a linear
  evaluate → select-intervention-type → generate sequence (correction 3), and it runs **synchronously in
  the request/response path**, unlike images which are always deferred to Celery.

---

## Main flow, hop by hop

### Hop 1 — Content-script interception (fetch/XHR hook)

Two parallel overrides, both installed by the page-context `interceptor.js` bundle
(`BrowserExtension/src/content/interceptor/interceptor.ts`), **not** the isolated-world content script:

- **Fetch:** `FetchInterceptor.overrideFetch()`
  (`BrowserExtension/src/content/interceptor/network/fetch-interceptor.ts:38-152`) replaces
  `window.fetch`. For a matched URL it calls the real fetch, clones the response, and:
  ```ts
  // fetch-interceptor.ts:104-105
  self.dispatchSaveBatchEvent(interceptedData);
  ```
  then returns a `Promise<Response>` that resolves on a `CustomFeedReady` event or a 60s timeout
  (`config.api.requestTimeoutMs`, `fetch-interceptor.ts:114`).
- **XHR:** `XhrInterceptor.overrideXHR()` (`network/xhr-interceptor.ts`) patches
  `XMLHttpRequest.prototype.open/send/setRequestHeader` analogously (not re-read line-by-line this pass,
  but its existence and registration from `interceptor.ts:74-75`/`101-102` is confirmed).

**URL matching** — `BaseInterceptor.shouldInterceptUrl()`
(`BrowserExtension/src/content/interceptor/network/base-interceptor.ts:31-72`) checks the last URL path
segment against a hardcoded `subscribedEndpoints` list defined in
`BrowserExtension/src/content/interceptor/interceptor.ts:32-55` (Reddit: `home-feed`, `popular-feed`,
`all-feed`, `best`, `hot`, `new`, `rising`, `controversial`, `top`, `gilded`, `promoted`, `ads`, plus
pagination segments `partial`/`more_posts`/`partial-more-posts`/`morecomments`/`svc/shreddit`; Twitter:
`HomeTimeline`, `HomeLatestTimeline`), with extra pagination-cursor handling for Reddit
(`base-interceptor.ts:54-69`).

### Hop 2 — Platform adapter parsing: CONFIRMED DEAD, not part of the live path

**Correction 5 above applies.** The rough model's step 2 ("platform adapter parsing in `reddit.ts`") does
**not** happen client-side. The only thing the live path does with platform info client-side is
`getCurrentPlatform()` (`BrowserExtension/src/content/modules/platform-detector.ts:14-27`), which just
string-matches `window.location.href` to return `'reddit'`/`'twitter'`/`null` — used by
`event-handler.ts` purely to decide whether to proceed, not to parse the response body:
```ts
// content/modules/event-handler.ts:77-82
const platform = getCurrentPlatform();
if (!platform) { ... sendOriginalResponse(data); return; }
```
The raw intercepted response string (`data.response`) is forwarded to the backend as-is; all HTML/JSON
parsing of the Reddit feed happens server-side (Hop 6).

### Hop 3 — Message passing

**Not `chrome.runtime.sendMessage` for the feed payload itself.** The page-context interceptor and the
isolated-world content script communicate via `CustomEvent`s on the shared `window` object (both worlds
see the same `window`):
```ts
// network/base-interceptor.ts:77-86 (page context)
const event = new CustomEvent('SaveBatch', { detail: data });
window.dispatchEvent(event);
```
```ts
// content/modules/event-handler.ts:19 (isolated world)
window.addEventListener('SaveBatch', function(event: CustomEvent<InterceptedRequest>) {
  ...
  handleInterceptedRequest(event.detail);
});
```
`handleInterceptedRequest` (`event-handler.ts:57-132`) then calls `processInterceptedRequest()`
(`content/modules/api-connector.ts:34-58`) **directly, in the isolated-world content-script context** —
it does not hop through the background service worker. The background script is only involved for
auth/user-id plumbing (`getUserInfo` via `chrome.runtime.sendMessage`, used inside `apiService.processFeed`
to attach a Bearer token — see Hop 4), not for carrying the feed body.

### Hop 4 — HTTP request to backend

`ApiService.processFeed()` (`BrowserExtension/src/shared/api/api-service.ts:181-258`):
```ts
// api-service.ts:201-209
const requestBody = {
  user_id: userId,
  url: url,
  data: { feed_info: { response: responseData } },
};
```
```ts
// api-service.ts:231-241
const response = await fetch(
  `${config.api.baseUrl}${config.api.endpoints.process}`,   // = http://127.0.0.1:8001/get_feed
  { method: "POST", headers: {"Content-Type":"application/json", "Authorization": authToken ? `Bearer ${authToken}` : ""}, body: JSON.stringify(requestBody) },
);
```
`config.api.endpoints.process = '/get_feed'` and `config.api.baseUrl = 'http://127.0.0.1:8001'`
(`BrowserExtension/src/shared/config.ts:104,109`).

### Hop 5 — Backend route handler

```python
# Backend/app.py:206-208
@app.post('/get_feed')
@handle_api_errors
async def process_feed_route(request_data: ProcessFeedRequest):
```
Platform is derived from the **request URL**, not from anything the client computed:
```python
# app.py:187-193 / 228
def get_platform_from_url(url):
    if 'reddit.com' in url: return 'reddit'
    elif 'twitter.com' in url or 'x.com' in url: return 'twitter'
    else: return None
platform = get_platform_from_url(url)
```
and dispatched via `PLATFORM_PROCESSORS = {'reddit': RedditProcessor, 'twitter': TwitterProcessor}`
(`app.py:177-180`):
```python
# app.py:243-244
processor = processor_class(user_id=user_id, feed_info=feed_info, url=url)
modified_feed = await processor.work_on_feed()
```
The raw in/out bodies are also logged to `Backend/data/requests/<user_id prefix>_<timestamp>/` (`app.py:211-219,232-235,252-254`).

### Hop 6 — Synchronous ("critical path") processing before the HTTP response returns

`RedditProcessor.work_on_feed()` (`Backend/processors/reddit_processor.py:274-299`) parses the HTML with
BeautifulSoup (already done in `__init__`, `reddit_processor.py:269`), finds all `<shreddit-post>`
elements (`line 287`), and processes them concurrently:
```python
# reddit_processor.py:356-361
for post in final_posts:
    task = asyncio.create_task(self.process_post(post))
    tasks.append(task)
completed_posts = await asyncio.gather(*tasks, return_exceptions=True)
```
`self.process_post` is `ContentProcessor.process_post` (`Backend/processors/base_processor.py:90-209`),
inherited from the base class. Per post:

**6a. Text filter matching (1 LLM call).**
```python
# base_processor.py:103
matching_filters = await self.llm_processor.evaluate_content(combined_text, self.filters)
```
→ `LLMProcessor.evaluate_content` (`Backend/llm/processor.py:89-163`) — one OpenAI call
(`gpt-4o-mini` per `content_model` in `config.yaml:2`), with per-intensity confidence thresholds that
differ for `balanced` vs `aggressive` mode (`processor.py:69-84`; `config.yaml:10` sets `default_mode:
"balanced"`).

**6b. Text intervention selection + generation (up to 2 more LLM calls), only if matched.**
```python
# base_processor.py:106-112
max_intensity = max(f.intensity for f in matching_filters)
processed_text = await self.llm_processor.process_content(combined_text, max_intensity, matching_filters, post.metadata)
```
→ `LLMProcessor.process_content` (`llm/processor.py:208-254`). In `balanced` mode, unless
`post_metadata['text_intervention']` forces a choice, it calls `select_text_intervention`
(`processor.py:599-721`, one more OpenAI call scoring "Modify Segments"/"Add Warning"/"Rewrite" on
coherence/fidelity/emotional-impact) and then one of `_process_low_intensity` / `_process_medium_intensity`
/ `_process_high_intensity` (`processor.py:355-507`, one more OpenAI call) to produce the final text
wrapped in `__BLUR_START__/__END__`, `__OVERLAY_START__/__END__`, or `__REWRITE_START__/__END__` markers
inside `[TITLE]`/`[BODY]` tags.
```python
# base_processor.py:113
post.update_processed_content(processed_text)   # Post.update_processed_content, base_processor.py:48-57
```

**6c. Image dispatch (synchronous filter-selection call + async Celery hand-off), only if the post has media.**
```python
# base_processor.py:120-132
if post.media_urls and img_config.enabled:
    for img_url in limited_media_urls:
        image_process_result = await self.image_processor.process_image(
            image_url=img_url, filters=self.filters, user_id=self.user_id,
            post_metadata=post.metadata, post_text=combined_text)
```
→ `ImageProcessor.process_image` (`Backend/ImageProcessor/ImageProcessor.py:32-123`) — see Hop 8 for what
happens inside; this call **awaits** the filter-selection LLM call but returns immediately after
`.delay()`-ing the Celery workflow (does not await the image generation itself). The result dict
(`status: "DEFERRED"`, chosen filter name, top3/next2 candidate intervention names) is stored onto
`post.processed_media_urls` (`base_processor.py:184-187`).

**6d. Writing results back into the HTML / logging.**
```python
# reddit_processor.py:364-371 (back in _process_posts_parallel)
for post in completed_posts:
    ...
    post.update_element()   # RedditPost.update_element, reddit_processor.py:168-191
```
`update_element()` writes `processed_title`/`processed_body` (markers intact — see explicit comment
`"Don't strip markers - they need to be handled by frontend"`, `reddit_processor.py:404,413`, though that
particular helper (`_update_post_content`) isn't the one actually called from `update_element`; the
analogous marker-preserving assignment is `reddit_processor.py:173,178`) back into the `<a slot="title">`
/`<a slot="text-body">` elements, and for images calls `_apply_image_processing`
(`reddit_processor.py:243-261`), which sets `img['src']` to the (still-placeholder, for deferred images)
processed URL and stamps a `diy-mod-image` JSON attribute:
```python
# reddit_processor.py:250-251
if img_data.get('config'):
    img['diy-mod-image'] = json.dumps(img_data['config'])
```
Finally:
```python
# reddit_processor.py:296
return str(self.soup)
```
goes back to `app.py:244`, wrapped as `{'status': 'success', 'feed': {'response': modified_feed}}`
(`app.py:246-249`) and returned as the HTTP response body — **this is the only HTTP response the client
gets for this request; images are not in it yet (just placeholders + config), by design.**

Also note: `ContentProcessor.__init__` (`base_processor.py:62-81`) loads filters from the DB (Hop 10) and
instantiates `LLMProcessor()`/`ImageProcessor()` fresh **per incoming `/get_feed` request** (one
`RedditProcessor`/`TwitterProcessor` instance per request, not a singleton).

### Hop 7 — Celery task dispatch

```python
# Backend/ImageProcessor/ImageProcessor.py:91-92  (the only reachable branch — see Hop 8 note)
from tasks import run_intervention_workflow
run_intervention_workflow.delay(json.dumps(payload))
```
There is a second `.delay()` call at `ImageProcessor.py:114-115` in an `else` branch that is **currently
unreachable** (see Hop 8), and that is the only other producer of the top-level workflow task; no other
`.delay()`/`.apply_async()` call site outside `tasks.py` itself exists in `Backend/`.

### Hop 8 — Celery task bodies, in actual invocation order (`Backend/tasks.py`)

**Before the Celery task even starts:** `FilterUtils.get_best_filter()`
(`Backend/FilterUtils/FilterUtils.py:197-260`) is called synchronously from
`ImageProcessor.process_image` (Hop 6c) — **one GPT-4o vision call**
(`get_image_filter_information`, `FilterUtils.py:53-195`, `model="gpt-4o"` hardcoded at line 165) that
does double duty: it both scores each candidate filter element's presence/coverage/centrality (to pick
the single best-matching filter, weighted `0.4*coverage + 0.6*centrality`, `FilterUtils.py:231`) **and**,
in the same response, recommends and ranks 5 intervention names, split into `top3_interventions`/
`next2_interventions` (`FilterUtils.py:246-257`). This is the step the rough model calls "Pruner," but
it's not a separately-named stage in the code, and it is NOT inside Celery — it runs in the FastAPI
request handler's async context, before `.delay()` is even called.

**`get_intervention_type_for_image` always returns `"edit_to_replace"`** (hardcoded,
`ImageProcessor.py:23-27`), so the `else` / `"stylization"` direct-mode branch in `process_image`
(`ImageProcessor.py:104-122`) is currently dead — every image that reaches this point takes the
`mode: "rank"` path with `candidate_names` set to `top3_interventions` (or a random 3 if the LLM gave
none, `ImageProcessor.py:68-75`).

Inside the worker, for a `mode: "rank"` payload:

1. `run_intervention_workflow` (bind=True, `tasks.py:366-463`) — parses the request, checks the cache
   (`tasks.py:394`, see Hop 9), builds a `job_id`, then:
   ```python
   # tasks.py:433-455
   batch_task = process_image_batch.s(source_url=source_url, intervention_names=candidate_names,
                                       user_context=user_context, model_provider=generation_provider, job_id=job_id)
   callback = run_scoring_and_find_best_batch.s(source_url=source_url, user_context={...}, score_provider=score_provider,
                                                 job_id=job_id, filters=[chosen_filter], scoring_strategy=scoring_strategy)
   return (batch_task | callback).apply_async()
   ```
   `generation_provider` defaults to `"gemini"` and `score_provider` defaults to `"openai"`
   (`tasks.py:431,443`).
2. `process_image_batch` (`tasks.py:90-160`) — downloads the source image once
   (`storage_manager.download_image`, line 101), then runs **every** candidate intervention
   concurrently via a gevent `Pool` (lines 105-150):
   ```python
   # tasks.py:112-117
   processed_image_bytes = intervention.apply(image_bytes=original_image_bytes, filters=user_context, model=model)
   ```
   (`INTERVENTION_REGISTRY[name]`/`MODEL_REGISTRY[model_provider]`, registries defined
   `tasks.py:60-85`). This is the "parallel generation" stage.
3. `run_scoring_and_find_best_batch` (`tasks.py:255-289`) — for each successful candidate builds a
   `score_intervention.s(...)` subtask (line 272) and joins them in a **chord**:
   ```python
   # tasks.py:281-289
   callback = finalize_workflow.s(generated_results=successful_results, source_url=source_url, filters=filters, job_id=job_id)
   return chord(scoring_tasks, callback).apply_async()
   ```
4. `score_intervention` (`tasks.py:312-363`) — one VLM call per candidate via
   `MODEL_REGISTRY[score_provider].score_image(...)`, using `IMAGE_SCORER_SYSTEM_PROMPT`/
   `IMAGE_SCORER_USER_PROMPT_TEMPLATE` from `llm/prompts.py` (imported `tasks.py:31`). This is the
   "Scorer" stage.
5. `finalize_workflow` (`tasks.py:219-252`) — picks `max(successful_scores, key=lambda x: x['score'])`
   (line 231), matches it back to its generated result, and on success writes it to the cache (Hop 9).

### Hop 9 — Redis cache read/write

See **Correction 1** above for the key-construction correction. Concretely:

- **Read (workflow-level, dedup check):**
  ```python
  # tasks.py:394
  cached_result = image_cache.get_processed_value_from_cache(image_url=source_url, filters=[chosen_filter])
  ```
- **Read (client polling):**
  ```python
  # app.py:426
  result = image_cache.get_processed_value_from_cache(image_url=img_url, filters=parsed_filters)
  ```
- **Write (winning intervention):**
  ```python
  # tasks.py:245-249
  image_cache.set_processed_value_to_cache(image_url=source_url, filters=filters,
                                            processed_url=final_result['processed_url'], base64_url=final_result.get('base64_url'))
  ```
- Implementation: `ImageCacheManager` (`ServerCache/CacheManager.py:14-23`) backed by `RedisCache`
  (`ServerCache/RedisCache.py:4-25`, plain `redis.Redis(host='localhost', port=6379)`, TTL 3600s). Real
  Redis key = bare `image_url` (`CacheManager.py:71-72`'s `_get_key` is unused — see Correction 1); the
  per-filter-combination sub-key inside the stored JSON is `_get_filter_string(filters)`
  (`CacheManager.py:25-48`), with an LLM fuzzy-match fallback for near-miss filter strings
  (`CacheManager.py:58-69`). `set_processed_value_to_cache` also publishes to the Redis pub/sub channel
  `image_processing_complete` (`CacheManager.py:164`) — consumed by Hop 11.

### Hop 10 — Database read/write (SQLite via SQLAlchemy)

- **Read:** `ContentProcessor.refresh_filters()` (`base_processor.py:83-88`), called once per request from
  `__init__` (`base_processor.py:80`):
  ```python
  # base_processor.py:85-87
  self.filters = [ContentFilter(**f) for f in get_user_filters(self.user_id)]
  ```
  (`get_user_filters` → `Backend/database/operations.py`, re-exported via `database/__init__.py`, backing
  the `filters` table, `database/models.py:29`.)
- **Write:** `log_processing_async(...)` (`base_processor.py:191-200`), once per processed post, writing
  to the `processing_logs` table (`database/models.py:53`) — content hash, matched filter texts,
  processing time, mode.
- **No filter-table writes happen anywhere in this main-flow trace** — filters are only created/updated
  via the separate `/filters` REST route or the `/chat` flow (see Secondary flow below).

### Hop 11 — Response / polling mechanism back to the client

- **Text:** fully synchronous. The marker-embedded HTML is in the single `/get_feed` HTTP response
  (Hop 6d); `FetchInterceptor`'s pending `Promise<Response>` resolves as soon as the `CustomFeedReady`
  event fires with that body (`fetch-interceptor.ts:108-142`). No polling or WebSocket involved for text.
- **Images:** the `/get_feed` response already contains `<img diy-mod-image='{"type":"edit_to_replace","status":"DEFERRED",...}'>`
  placeholders (Hop 6d). The actual processed image arrives later via **HTTP polling by default**
  (Correction 4): `apiService.waitForImageProcessing()` (`api-service.ts:685-754`) checks
  `config.api.websockets.useWebSockets` (`false` by default, `shared/config.ts:132`) and falls through to
  `pollForImageResult()` (`api-service.ts:759-839`), which repeatedly `GET`s
  `${config.api.pollingBaseUrl}/get_img_result?img_url=...&filters=...` with custom timing (5s for the
  first 2 attempts, then ~2.5s ± jitter, `api-service.ts:800-811`) up to `maxAttempts=20`
  (`shared/config.ts:122`). The server-side handler (`app.py:406-449`) simply reads the cache (Hop 9) and
  returns `{"status":"COMPLETED","processed_value":...,"base64_url":...}` or `{"status":"NOT FOUND"}`.
  - **If WebSockets were enabled** (not the default), the path would instead be: client sends
    `wait_for_image` over `/ws/{user_id}` → `ConnectionManager.register_image_wait`
    (`app.py:619-636`) → when `finalize_workflow` caches the winning result, `CacheManager.publish`s to
    Redis channel `image_processing_complete` → `subscribe_to_image_notifications`
    (`app.py:740-781`, a background `asyncio.create_task` started in the FastAPI `lifespan`, `app.py:86`)
    receives it and calls `ConnectionManager.notify_image_processed` (`app.py:638-730`), which
    `send_json`s an `image_processed` message to the matching user's open `/ws/{user_id}` socket
    (`app.py:783-...`). This path is real and implemented, just not reachable with the shipped default
    config (Correction 4).

### Hop 12 — DOM update / content-script rendering

`DomProcessor` (`BrowserExtension/src/content/interceptor/ui/dom-processor.ts`), running in the same
page-context interceptor bundle, uses a `MutationObserver`
(`setupDomObserver`, `dom-processor.ts:95-204`) plus an initial full-body scan
(`processExistingContent`, `dom-processor.ts:87-90`) to find marker text and marked images:
```ts
// dom-processor.ts:388-407 (nodeHasMarkers)
if (element instanceof HTMLImageElement) return element.hasAttribute(DIY_IMG_ATTR);
...
const text = element.textContent || '';
return hasAnyMarkers(text);
```
- **Text:** `processNode` (`dom-processor.ts:246-323`) replaces matched text nodes with a `<span>` whose
  `innerHTML` is `processMarkedText(text)` (`BrowserExtension/src/utils/markers.ts:90-106`), which runs
  every registered handler — the built-in `blur`/`overlay`/`rewrite` handlers are registered at module
  load:
  ```ts
  // utils/markers.ts:1147-1169
  registerMarkerHandler({ name: 'blur', ..., process: processBlurMarkers });
  registerMarkerHandler({ name: 'overlay', ..., process: processOverlayMarkers });
  registerMarkerHandler({ name: 'rewrite', ..., process: processRewriteMarkers });
  ```
  — turning `__BLUR_START__...__BLUR_END__` etc. into actual styled `<span>` elements
  (e.g. `processBlurMarkers`, `markers.ts:131-142`, wraps content in
  `<span class="diymod-blur">`).
- **Images:** `processMarkedImages` → `processMarkedImage(imgElement)` (`markers.ts:196-249`) parses the
  `diy-mod-image` JSON and dispatches on `configData.type`:
  ```ts
  // markers.ts:228-230
  } else if (configData.type === 'cartoonish' || configData.type === 'edit_to_replace') {
    processCartoonishImageMarker(imgElement, configData);
  ```
  → `processCartoonishImageMarker` (`markers.ts:435-...`), which for `status === "DEFERRED"` shows a
  loading state and calls `startImagePolling` (`markers.ts:453,658-695`), which registers the image and
  calls `waitForImageResult(key)` (`markers.ts:701-...`). That function `window.postMessage`s a
  `diymod_wait_for_image` request (`markers.ts:713-718`) which the isolated-world content script's bridge
  picks up:
  ```ts
  // content/content-script.ts:45-80 (setupExtensionBridge)
  if (event.data.type === 'diymod_wait_for_image') {
    ...
    apiService.waitForImageProcessing(imageUrl, filters, 160000).then(result => {
      window.postMessage({ type: 'diymod_image_processed', requestId, result }, '*');
    })
  ```
  — i.e. the actual network call (WebSocket-or-poll, Hop 11) happens back in the isolated-world
  content-script context (via a dynamic `import('../shared/api/api-service')`), and the result is relayed
  back into the page context by `window.postMessage`, where `markers.ts`'s `waitForImageResult` resolves
  and swaps the final image in (not re-read in full this pass past line ~745; the mechanism up to the
  `postMessage` round-trip is directly confirmed).

**Minor dead-code note:** `registerImageMarkerHandler` calls for `processed_image`/`overlay_image` are
commented out (`markers.ts:1172-1184`), so the `imageMarkerHandlers` registry array is always empty and
`hasAnyImageMarkers()` always returns `false` — unused; `processMarkedImage` doesn't consult that registry
at all, it dispatches via its own if/else chain (see above), so this has no effect on the real flow.

---

## Secondary flow: filter creation (`POST /chat`)

This is a separate flow from the main pipeline above — it never touches `processors/` or `tasks.py`.

1. **Trigger:** `PopupController` in the toolbar popup calls a direct `fetch`:
   ```ts
   // BrowserExtension/src/popup/popup.ts:529
   const response = await fetch(`${config.api.baseUrl}/chat`, { method: 'POST', ... });
   ```
   (`ApiService.sendChatMessage()`, `shared/api/api-service.ts:360-426`, is an equivalent wrapper but
   `popup.ts` calls `fetch` directly for this path.)
2. **Backend route:**
   ```python
   # Backend/app.py:330-331
   @app.post('/chat')
   def chat(chat_request: ChatRequest):
       response = chat_processor.process_chat(chat_request.message, history, chat_request.user_id)
   ```
   `chat_processor` is a module-level `FilterCreationChat()` instance created in the FastAPI `lifespan`
   (`app.py:72`).
3. **`FilterCreationChat.process_chat`** (`Backend/llm/chat.py:233-...`) — reads the user's existing
   filters (`get_user_filters(user_id)`, line 242), runs heuristic vagueness/ambiguity/gibberish checks
   (`_analyze_input_clarity`, called line 259) before ever calling the LLM, and returns a structured
   `{"text":..., "type": "clarify" | "ready_for_config" | ..., "filter_data": {...}}` response. **This
   route never calls `add_filter`** — `grep -n "add_filter" Backend/llm/chat.py` returns no matches; the
   chat endpoint only produces conversational guidance plus a candidate `filter_data` payload.
4. **Client-side state machine:** `useFilterStore.handleResponse()`
   (`BrowserExtension/src/shared/state/filter-store.ts:34-70`) transitions UI state based on the response
   `type` (`'ready_for_config'` → `FilterState.FILTER_CONFIG`, line 55-57). Once the user confirms the
   filter config in that UI state, `PopupController` calls:
   ```ts
   // popup.ts:840
   const response = await apiService.createFilter({ filter_text, content_type, intensity, duration });
   ```
   → `ApiService.createFilter()` (`shared/api/api-service.ts:552-585`) → `POST /filters`.
5. **Persistence:**
   ```python
   # Backend/app.py:270-296 (create_filter_route)
   content_filter = ContentFilter(**filter_data)
   filter_id = add_filter(filter_request.user_id, content_filter.model_dump())
   ```
   `add_filter` (`Backend/database/operations.py:118`) writes the row into the `filters` table
   (`database/models.py:29`). **This is the only point in the whole filter-creation flow where a DB write
   happens** — the `/chat` exchange itself is DB-read-only (aside from the one `get_user_filters` read per
   turn).

(There is also a WebSocket-native `chat` message type handled inline in `websocket_endpoint`
(`app.py:801-804`, same `chat_processor.process_chat` call) for parity, and `/chat/image` →
`VisionFilterCreator.process_image` (`app.py:353-404`) as an image-based variant of step 2-3 — not traced
further here as it's the same shape with a different input modality.)

---

## Endpoint cross-reference table

Grepped every literal `fetch(`/XHR/WebSocket-send call site in `BrowserExtension/src` (excluding the
confirmed-dead `services/interceptor.ts`, `shared/network.ts`, and `utils/logger.ts`'s unused remote-log
path) against every `@app.*` route in `Backend/app.py`.

| Extension call site | Method + path | Matching `app.py` handler | Notes |
|---|---|---|---|
| `shared/api/api-service.ts:231` (`processFeed`) | POST `/get_feed` | `process_feed_route` — `app.py:206-208` | Main flow, Hop 4-5. |
| `shared/api/api-service.ts:280` (`processContent`) | POST `/process_content` | **NOT FOUND IN app.py** | `grep -n "@app\." app.py` lists no `/process_content` route. Only reachable from the dead `content/services/interceptor.ts` adapter path (Correction 5), so currently unreachable from any live caller — but if it were ever called, it would 404. |
| `shared/api/api-service.ts:405` (`sendChatMessage`) / `popup.ts:529` (`sendToLLM`, direct `fetch`) | POST `/chat` | `chat` — `app.py:330-331` | Secondary flow. |
| `shared/api/api-service.ts:494` (`processImage`) / `popup.ts:466` (`sendImageToLLM`, direct `fetch`) | POST `/chat/image` | `chat_with_image` — `app.py:353-355` | |
| `shared/api/api-service.ts:520` (`getUserFilters`) / `popup.ts:301` (direct `fetch`) | GET `/filters?user_id=` | `get_filters_route` — `app.py:258-260` | |
| `shared/api/api-service.ts:561` (`createFilter`) | POST `/filters` | `create_filter_route` — `app.py:270-272` | Secondary flow persistence step. |
| `shared/api/api-service.ts:594` (`deleteFilter`) | DELETE `/filters/{id}?user_id=` | `delete_filter_route` — `app.py:316-318` | |
| `shared/api/api-service.ts:630` (`updateFilter`) | PUT `/filters/{id}` | `update_filter_route` — `app.py:304-306` | |
| `shared/api/api-service.ts:664` (`testConnection`) / `background/index.ts:270` (`checkServerConnection`) / `options.ts:169` | GET `/ping` | `ping` — `app.py:196-197` | |
| `shared/api/api-service.ts:769` (`pollForImageResult`) / `background/index.ts:304` (`pollForImageResult`, legacy bridge) | GET `/get_img_result?img_url=&filters=` | `get_img_result` — `app.py:406-407` | Hop 11 default path. |
| `background/index.ts:120` (`updateUserInfoOnServer`) | POST `/user/update` | `update_user_info_endpoint` — `app.py:505` (per prior backend-map, not re-opened this pass; route existence confirmed via `grep -n "@app\." app.py` showing `/user/update` at line 505) | Only fires if `userStudy.active && userStudy.collectEmail`. |
| `shared/websocket/websocket-client.ts:49` (`connect()`, `new WebSocket(...)`) | WS `/ws/{user_id}` (connects to `ws://127.0.0.1:8010/ws/{id}` by default config — wrong port, see Correction 4) | `websocket_endpoint` — `app.py:783-784` | Disabled by default (Correction 4); and even enabled, default config's port doesn't match the server's actual bind (`0.0.0.0:8001`). |
| `background/index.ts:167` (`fetchGoogleUserInfo`) | GET `https://www.googleapis.com/oauth2/v1/userinfo` | N/A — external Google endpoint | Not a SHIELD backend call. |
| `background/index.ts:199` | GET `https://accounts.google.com/o/oauth2/revoke` | N/A — external Google endpoint | Not a SHIELD backend call. |
| `utils/logger.ts:54` (`Logger.remoteLog`) | POST `${baseUrl}/logging` | **NOT FOUND IN app.py** | `grep` confirms no `/logging` route exists; moot anyway since `config.logging.enableRemoteLogging` defaults `false` and the `Logger` class using it is otherwise unused (per `extension-map.md`, not re-verified line-by-line this pass — marked UNVERIFIED for the "otherwise unused" half, but the missing route is directly confirmed). |
| `shared/network.ts` (`sendServerRequest`/`processFeed`/etc.) | Various (`/get_feed`, `/ping`, `/filters`, ...) | (would match, but see note) | `extension-map.md` flags this whole file as having no importer anywhere in `src/` — not re-verified by a fresh grep this pass, carried over as UNVERIFIED-but-plausible since it's consistent with this pass's `services/interceptor.ts` dead-code finding pattern. |

**Backend routes never called from any live (non-dead) extension code path** (`grep`-checked against
every `fetch`/WS call site found in `BrowserExtension/src`, excluding the confirmed-dead files):

- `GET /get_img_base64` (`app.py:451`) — UNUSED BY EXTENSION. Possibly a leftover/alternate CSP-bypass
  helper; no caller found in extension source.
- `WS /ws/{user_id}` message types `filter_update`, `custom_feed_process`, `custom_feed_auto_filter`
  (handled inside `websocket_endpoint`, `app.py:801-933`, exact line range not re-read this pass) — the
  connection itself is reachable in principle (if WebSockets were enabled) but these specific message
  types have no corresponding `wsClient.send(...)` call site found in `shared/websocket/websocket-client.ts`
  or `shared/api/api-service.ts` (only `ping`/`pong`/`wait_for_image` sends were found via
  `grep -n "\.send(" src`).
- All `/custom-feed/*` routes (`app.py:952-1177` region), `/auth/login-email`, `/auth/user/{user_id}`,
  `/api/feeds/{user_id}`, `/api/feed/{feed_id}/html`, `/upload-feed`, `/human-preferences/*` — UNUSED BY
  EXTENSION. These match the root `CLAUDE.md`'s description of `reddit-clone/`-only research-tooling
  routes (`processors/standalone_custom_processor.py`, `custom_feed_models_pkg/`); not re-verified against
  `reddit-clone/` source in this pass (out of scope per task instructions), but their naming and the
  `CLAUDE.md` description make this the obvious explanation rather than genuinely dead code.

---

## Items marked UNVERIFIED (not independently re-confirmed this pass)

- `app.py:505` as the exact line for `/user/update`'s handler name/signature — relied on a `grep` hit
  rather than reading the function body directly.
- `shared/network.ts` having zero importers — carried over from `extension-map.md` without re-running the
  grep myself in this pass.
- The exact tail behavior of `utils/markers.ts`'s `waitForImageResult` past line ~745 (how the resolved
  result is actually swapped into the `<img src>`) — the `postMessage` round-trip up to that point is
  directly confirmed; the final DOM swap itself was not re-read line-by-line.
- `utils/logger.ts`'s `Logger` class being "otherwise unused" — the missing `/logging` route on the
  backend side is directly confirmed; whether anything in the extension still instantiates/calls
  `Logger.remoteLog()` was not re-grepped this pass.
- WebSocket message types handled inside `websocket_endpoint` (`app.py:801-933`) beyond `chat` — the
  existence of a `data.get("type") == "chat"` branch at `app.py:801-804` is confirmed; the other branches
  (`filter_update`, `wait_for_image`, `ping`, `pong`, `custom_feed_process`, `custom_feed_auto_filter`)
  were not individually re-read this pass (carried over from `backend-map.md`'s summary).
