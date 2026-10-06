# SHIELD: DIY Content Transformation for Safer Social Media Browsing

## Overview

Social media platforms moderate content with one set of rules for everyone, but what distresses a person is individual. A food photo is harmless to most people and a trigger for someone with an eating disorder. The tools platforms offer in response (muting keywords, blocking accounts) remove whole posts or whole people, so the user has to choose between seeing the distressing content and losing the conversation around it.

SHIELD takes a different approach: it **transforms** content instead of removing it. You describe what you do not want to see in your own words, and SHIELD changes only that part of a post while leaving the rest intact.

**What it does**

- **Filter creation by conversation.** Describe a sensitivity in the extension popup by text or by uploading an example image. An LLM asks clarifying questions when the description is ambiguous, then saves a filter with a content type (text, images, or both), a sensitivity level from 1 to 5, and a duration (permanent, 24 hours, or 1 week).
- **Text transformation.** Matching text in a post is blurred, hidden behind a click-to-reveal warning, or rewritten. The intervention is chosen per post by an LLM.
- **Image transformation.** A vision model picks the matching filter and shortlists interventions (blur, occlusion, warning overlay, inpainting, replacement, shrink, and stylization). The candidates are generated in parallel, scored by a separate model, and the best one replaces the original image in the page.
- **Transparency.** Every modified element is labelled, and hidden text can be revealed by the user.

**How it works**

| Part | Folder | Role |
|---|---|---|
| Browser extension | `BrowserExtension/` | Chrome (Manifest V3) extension. Intercepts the Reddit feed before it renders, sends it to the backend, and renders the transformed result. Provides the popup chat and the options page. |
| Backend | `Backend/` | FastAPI server. Stores filters in SQLite, runs text moderation with OpenAI models during the feed request, and hands image work to Celery workers. |
| Workers and cache | `Backend/` | Celery workers generate and score image transformations in the background. Redis is the task queue and the cache for finished images. |

Text is transformed before the feed is shown. Images take longer, so the page shows a loading state on each affected image and swaps in the transformed version when it is ready.

SHIELD is tested on Reddit. Video is not processed.

More detail is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/backend.md`](docs/backend.md) and [`docs/extension.md`](docs/extension.md).

## Prerequisites

| Requirement | Notes |
|---|---|
| Python 3.10 or newer | 3.11 was used during development. |
| Node.js with npm | A current LTS release, to build the extension. |
| Redis | Must listen on `localhost:6379` (the address is fixed in the code). |
| Google Chrome | With developer mode, to load the unpacked extension. |
| OpenAI API key | Used for filter creation, text moderation and image analysis. |
| Google Gemini API key | Used for image generation and scoring. |
| AWS S3 bucket (optional) | Only if generated images should be stored in S3 instead of on local disk. |

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/nazeeb1432/SPL3.git
cd SPL3
```

### 2. Install the backend

```bash
cd Backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
pip install google-genai        # required, but not listed in requirements.txt
cp .env.template .env
```

Open `Backend/.env` and set real values:

```bash
OPENAI_API_KEY=your-openai-key
GOOGLE_API_KEY=your-gemini-key
USE_S3=false                    # store generated images in Backend/temp/uploads
```

`USE_S3` defaults to `true`. Leave it out only if you also fill in `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_STORAGE_BUCKET_NAME`; otherwise the backend stops at start-up.

### 3. Start the services

Run each command in its own terminal, in this order.

**Terminal 1: Redis**

```bash
redis-server
```

**Terminal 2: Celery worker**

```bash
cd Backend
source venv/bin/activate
celery -A celery_gevent_worker worker --loglevel=info -P gevent -c 1000
```

**Terminal 3: API server**

```bash
cd Backend
source venv/bin/activate
python app.py
```

The server listens on port 8001. Check it with:

```bash
curl http://localhost:8001/ping
```

It should return a JSON message with `"status":"success"`.

### 4. Build and load the extension

```bash
cd BrowserExtension
npm install
npm run build
```

Use `npm run build`, not `vite build` on its own: the build has extra steps the extension needs.

Then load it in Chrome:

1. Open `chrome://extensions`.
2. Switch on **Developer mode** (top right).
3. Click **Load unpacked** and select the `BrowserExtension/dist` folder.

### 5. Check that it works

1. Click the extension icon, then **Options**, then **Test Connection**. The message "Test Passed! You can use DIY-MOD!!" means the extension can reach the backend.
2. Open the popup, describe something you do not want to see, and save the filter.
3. Open Reddit. Posts that match the filter appear transformed.

After changing extension code, run `npm run build` again and click the reload button for the extension in `chrome://extensions`.

### Running the API tests (optional)

With Redis and the API server running:

```bash
cd Backend/tests
pytest . -v                 # add -m "not llm" to skip tests that call OpenAI
```

## Acknowledgement

SHIELD is built on the CHI '26 paper *"What If Moderation Didn't Mean Suppression? A Case for Personalized Content Transformation"* by Rayhan Rashed and Farnaz Jahanbakhsh ([arXiv:2509.22861](https://arxiv.org/abs/2509.22861)). DIY-MOD is Copyright © 2026 The Regents of the University of Michigan and is released under the MIT License; see [`LICENSE`](LICENSE).
