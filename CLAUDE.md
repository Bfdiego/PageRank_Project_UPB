# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Monorepo: Python/FastAPI backend (web crawler) + Next.js/TypeScript frontend (UI + PageRank computation). The crawler is real (BFS via `httpx` + `BeautifulSoup`); PageRank is computed entirely client-side in the browser.

## Commands

### Backend

```bash
cd backend
source .venv/bin/activate          # macOS/Linux
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Setup (first time):
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Quick API tests:
```bash
curl http://localhost:8000/health
curl -X POST http://localhost:8000/api/crawl/start \
  -H "Content-Type: application/json" \
  -d '{"startUrl":"https://example.com","maxPages":50,"maxDepth":3}'
curl "http://localhost:8000/api/crawl/status?jobId=PASTE_ID"
curl "http://localhost:8000/api/crawl/result?jobId=PASTE_ID"
curl -X POST http://localhost:8000/api/crawl/stop \
  -H "Content-Type: application/json" \
  -d '{"jobId":"PASTE_ID"}'
```

### Frontend

```bash
cd frontend
npm install
# Create frontend/.env.local with: NEXT_PUBLIC_API_BASE=http://localhost:8000
npm run dev       # http://localhost:3000
npm run build
npm run lint      # runs tsc --noEmit (TypeScript only, no ESLint)
```

## Architecture

### Backend (`backend/app/main.py`)

Single-file FastAPI app. Key design decisions:

- **In-memory job store**: `JOBS: Dict[str, Job]` — all state is lost on restart.
- **Threading**: each crawl runs in a daemon `threading.Thread`; stopped via `job.stop_flag` (`threading.Event`). All mutations to `Job` fields go through `job.lock`.
- **URL canonicalization**: strips fragments always, strips query params when `ignoreQueryParams=True`, normalizes port/trailing-slash, forces `https` if the start URL is `https` and the crawled URL has the same host on `http`.
- **SSRF protection**: `_is_safe_public_url()` resolves the hostname and rejects private/loopback IPs. Results are cached in `_SAFE_HOST_CACHE`.
- **Same-domain only**: the crawler never follows links outside the start URL's netloc.
- **`renderJs: true`** is not implemented — the backend returns an error state immediately.
- **CORS** is hardcoded to `http://localhost:3000` and `http://127.0.0.1:3000`.

API endpoints:
| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | liveness |
| POST | `/api/crawl/start` | returns `jobId` |
| POST | `/api/crawl/stop` | sets stop flag |
| GET | `/api/crawl/status` | progress/state |
| GET | `/api/crawl/result` | nodes, edges, danglingNodes |

### Frontend (`frontend/src/`)

- **`lib/api.ts`**: typed fetch wrappers for all backend endpoints. `API_BASE` comes from `NEXT_PUBLIC_API_BASE` env var (falls back to `http://localhost:8000`).
- **`app/page.tsx`**: single-page app holding all state. Key responsibilities:
  - Polls `/api/crawl/status` every 600 ms while a job is running.
  - Implements `pageRank()` — iterative random-surfer algorithm (Ian Rogers' formula) using `Float64Array`. Dangling nodes distribute mass uniformly ("Option A").
  - Builds Cytoscape.js graph via `rebuildCytoscape()` (dynamically imported). Two modes: **overview** (top-K by score, BFS layout) and **focus** (1-hop ego graph around selected node).
  - Persists settings + graph + scores to `localStorage` under key `pagerank-project.snapshot.v1`.
- **`components/CrawlForm.tsx`**: URL input + Crawl/Stop buttons.
- **`components/SettingsPanel.tsx`**: maxPages, maxDepth, ignoreQueryParams controls.
- **`components/CrawlStatus.tsx`**: displays live job state/progress.

### Data flow

```
User → CrawlForm → startCrawl() → POST /api/crawl/start
         ↓
       polling getStatus() every 600ms
         ↓
       [crawl done] → handleLoadGraph() → GET /api/crawl/result → setGraph()
         ↓
       handleRunPageRank() → pageRank() (client-side) → setScores()
         ↓
       Cytoscape.js visualization + ranking table
```

### Crawler URL rules (fixed by design)

- Same domain only
- Fragments (`#`) always stripped
- Query params stripped when `ignoreQueryParams=true`
- Relative URLs resolved via `urljoin`
- `https` forced when start URL is `https` and same netloc
- Limits: `maxPages` (1–20000) and `maxDepth` (0–50)
- 30 ms sleep between page fetches (politeness)
