from __future__ import annotations

import ipaddress
import socket
import threading
import time
import uuid
from collections import deque
from urllib.parse import urljoin, urlparse, urlunparse
from dataclasses import dataclass, field
from typing import Dict, Optional, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, AnyHttpUrl

import httpx
from bs4 import BeautifulSoup

# -----------------------------
# Models (API)
# -----------------------------


class CrawlStartRequest(BaseModel):
    startUrl: AnyHttpUrl
    maxPages: int = Field(ge=1, le=20000, default=200)
    maxDepth: int = Field(ge=0, le=50, default=4)
    ignoreQueryParams: bool = True
    renderJs: bool = False


class CrawlStartResponse(BaseModel):
    jobId: str


class CrawlStopRequest(BaseModel):
    jobId: str


CrawlState = Literal["idle", "running", "done", "error", "stopped"]


class CrawlStatusResponse(BaseModel):
    jobId: str
    state: CrawlState
    visited: int
    maxPages: int
    elapsedSeconds: int
    currentUrl: Optional[str] = None
    queueSize: int = 0
    error: Optional[str] = None


class CrawlEdge(BaseModel):
    source: str
    target: str


class CrawlResultResponse(BaseModel):
    jobId: str
    nodes: list[str]
    edges: list[CrawlEdge]
    danglingNodes: list[str]
    titles: dict[str, str]
    stats: dict


@dataclass
class Job:
    job_id: str
    start_time: float
    state: CrawlState = "running"
    visited: int = 0
    max_pages: int = 200
    max_depth: int = 4
    ignore_query_params: bool = True
    render_js: bool = False

    start_url: str = ""
    current_url: Optional[str] = None
    queue_size: int = 0

    visited_urls: set[str] = field(default_factory=set)
    edges: list[tuple[str, str]] = field(default_factory=list)
    titles: dict[str, str] = field(default_factory=dict)

    error: Optional[str] = None

    stop_flag: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)


JOBS: Dict[str, Job] = {}

_SKIP_SCHEMES = ("mailto:", "tel:", "javascript:")
_SAFE_HOST_CACHE: dict[str, bool] = {}


def _is_public_ip(ip_raw: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_raw)
    except ValueError:
        return False
    return (
        not ip.is_private
        and not ip.is_loopback
        and not ip.is_link_local
        and not ip.is_multicast
        and not ip.is_reserved
        and not ip.is_unspecified
    )


def _is_safe_hostname(hostname: str) -> bool:
    host = hostname.strip().lower().rstrip(".")
    if not host or host == "localhost" or host.endswith(".local"):
        return False

    cached = _SAFE_HOST_CACHE.get(host)
    if cached is not None:
        return cached

    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        _SAFE_HOST_CACHE[host] = False
        return False

    resolved_ips = {entry[4][0] for entry in infos if entry and entry[4]}
    if not resolved_ips:
        _SAFE_HOST_CACHE[host] = False
        return False

    safe = all(_is_public_ip(ip) for ip in resolved_ips)
    _SAFE_HOST_CACHE[host] = safe
    return safe


def _is_safe_public_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    if not parsed.hostname:
        return False
    return _is_safe_hostname(parsed.hostname)


def _strip_fragment_and_query(url: str, ignore_query: bool) -> str:
    parsed = urlparse(url)
    query = "" if ignore_query else parsed.query
    cleaned = parsed._replace(fragment="", query=query)
    return urlunparse(cleaned)


def _canonicalize_url(base_url: str, href: str, ignore_query: bool) -> Optional[str]:
    if not href:
        return None

    href = href.strip()
    if not href:
        return None

    lower = href.lower()
    if lower.startswith(_SKIP_SCHEMES):
        return None

    if href.startswith("#"):
        return None

    abs_url = urljoin(base_url, href)
    abs_url = _strip_fragment_and_query(abs_url, ignore_query)

    parsed = urlparse(abs_url)
    if parsed.scheme not in ("http", "https"):
        return None

    scheme = parsed.scheme.lower()
    host = (parsed.hostname or "").lower()
    if not host:
        return None
    try:
        port = parsed.port
    except ValueError:
        return None
    if (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
        port = None
    netloc = f"{host}:{port}" if port else host

    path = parsed.path or "/"
    if path != "/" and path.endswith("/"):
        path = path[:-1]

    parsed = parsed._replace(scheme=scheme, netloc=netloc, path=path)
    abs_url = urlunparse(parsed)

    return abs_url


def _extract_title(soup: BeautifulSoup) -> Optional[str]:
    tag = soup.title
    if not tag:
        return None
    text = tag.get_text(separator=" ", strip=True)
    text = " ".join(text.split())
    if not text:
        return None
    return text[:200]


def _same_domain(a: str, b: str) -> bool:
    return urlparse(a).netloc.lower() == urlparse(b).netloc.lower()


def _force_https_if_applicable(start_url: str, candidate_url: str) -> str:
    s = urlparse(start_url)
    c = urlparse(candidate_url)
    if s.scheme == "https" and c.scheme == "http" and s.netloc.lower() == c.netloc.lower():
        c = c._replace(scheme="https")
        return urlunparse(c)
    return candidate_url


def _crawl_static_html(job: Job) -> None:
    try:
        if job.render_js:
            with job.lock:
                job.state = "error"
                job.error = "renderJs=true no está soportado todavía (Phase 2 básica)."
            return

        queue: deque[tuple[str, int]] = deque()
        queue.append((job.start_url, 0))
        queued: set[str] = {job.start_url}

        timeout = httpx.Timeout(10.0, connect=5.0)
        headers = {"User-Agent": "PageRankProjectBot/0.1 (educational)"}

        with httpx.Client(timeout=timeout, follow_redirects=False, headers=headers) as client:
            while queue:
                if job.stop_flag.is_set():
                    with job.lock:
                        job.state = "stopped"
                    return

                url, depth = queue.popleft()

                with job.lock:
                    job.current_url = url
                    job.queue_size = len(queue)

                with job.lock:
                    if job.visited >= job.max_pages:
                        job.state = "done"
                        return

                if not _is_safe_public_url(url):
                    continue

                with job.lock:
                    if url in job.visited_urls:
                        continue

                try:
                    resp = client.get(url)
                except Exception:
                    continue

                if 300 <= resp.status_code < 400:
                    location = resp.headers.get("location")
                    if not location:
                        continue

                    target = _canonicalize_url(url, location, job.ignore_query_params)
                    if not target:
                        continue
                    target = _force_https_if_applicable(job.start_url, target)

                    if not _same_domain(job.start_url, target):
                        continue
                    if not _is_safe_public_url(target):
                        continue

                    with job.lock:
                        job.edges.append((url, target))

                    if depth <= job.max_depth:
                        with job.lock:
                            already_visited = target in job.visited_urls
                        if (not already_visited) and (target not in queued):
                            queued.add(target)
                            queue.append((target, depth))
                    continue

                if resp.status_code < 200 or resp.status_code >= 300:
                    continue

                content_type = resp.headers.get("content-type", "").lower()
                if "text/html" not in content_type:
                    continue

                with job.lock:
                    if url in job.visited_urls:
                        continue
                    job.visited_urls.add(url)
                    job.visited += 1

                html = resp.text

                soup = BeautifulSoup(html, "html.parser")

                title = _extract_title(soup)
                if title:
                    with job.lock:
                        job.titles[url] = title

                anchors = soup.find_all("a", href=True)

                for a in anchors:
                    href = a.get("href")
                    target = _canonicalize_url(url, href, job.ignore_query_params)
                    if not target:
                        continue

                    target = _force_https_if_applicable(job.start_url, target)
                    if not _same_domain(job.start_url, target):
                        continue
                    if not _is_safe_public_url(target):
                        continue

                    with job.lock:
                        job.edges.append((url, target))

                    if depth + 1 <= job.max_depth:
                        with job.lock:
                            already_visited = target in job.visited_urls
                        if (not already_visited) and (target not in queued):
                            queued.add(target)
                            queue.append((target, depth + 1))

                time.sleep(0.03)

        with job.lock:
            job.state = "done"

    except Exception as e:
        with job.lock:
            job.state = "error"
            job.error = str(e)


app = FastAPI(title="PageRank Project Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    # Next.js usa otro puerto cuando el 3000 ya está ocupado. Permitimos
    # cualquier puerto únicamente para los hosts loopback de desarrollo.
    allow_origin_regex=r"^https?://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/api/crawl/start", response_model=CrawlStartResponse)
def start_crawl(payload: CrawlStartRequest):
    start_url = _canonicalize_url(str(payload.startUrl), str(payload.startUrl), payload.ignoreQueryParams)
    if not start_url:
        raise HTTPException(status_code=400, detail="startUrl inválida")
    if not _is_safe_public_url(start_url):
        raise HTTPException(status_code=400, detail="startUrl no permitida por seguridad (host privado/local)")

    job_id = uuid.uuid4().hex[:12]
    job = Job(
        job_id=job_id,
        start_time=time.time(),
        state="running",
        visited=0,
        max_pages=payload.maxPages,
        max_depth=payload.maxDepth,
        ignore_query_params=payload.ignoreQueryParams,
        render_js=payload.renderJs,
        start_url=start_url,
    )
    JOBS[job_id] = job

    t = threading.Thread(target=_crawl_static_html, args=(job,), daemon=True)
    t.start()

    return CrawlStartResponse(jobId=job_id)


@app.post("/api/crawl/stop")
def stop_crawl(payload: CrawlStopRequest):
    job = JOBS.get(payload.jobId)
    if not job:
        raise HTTPException(status_code=404, detail="jobId not found")

    with job.lock:
        if job.state not in ("running",):
            return {"ok": True, "state": job.state}

    job.stop_flag.set()
    return {"ok": True}


@app.get("/api/crawl/status", response_model=CrawlStatusResponse)
def crawl_status(jobId: str):
    job = JOBS.get(jobId)
    if not job:
        raise HTTPException(status_code=404, detail="jobId not found")

    with job.lock:
        elapsed = int(time.time() - job.start_time)
        return CrawlStatusResponse(
            jobId=job.job_id,
            state=job.state,
            visited=job.visited,
            maxPages=job.max_pages,
            elapsedSeconds=elapsed,
            currentUrl=job.current_url,
            queueSize=job.queue_size,
            error=job.error,
        )


@app.get("/api/crawl/result", response_model=CrawlResultResponse)
def crawl_result(jobId: str):
    job = JOBS.get(jobId)
    if not job:
        raise HTTPException(status_code=404, detail="jobId not found")

    with job.lock:
        valid_nodes: set[str] = set(job.visited_urls)
        nodes_set: set[str] = set(valid_nodes)

        edge_set: set[tuple[str, str]] = set()
        for (src, dst) in job.edges:
            if src == dst:
                continue
            if src not in valid_nodes or dst not in valid_nodes:
                continue
            edge_set.add((src, dst))
            nodes_set.add(src)
            nodes_set.add(dst)

        nodes: list[str] = sorted(nodes_set)
        edges: list[CrawlEdge] = [CrawlEdge(source=s, target=t) for (s, t) in sorted(edge_set)]

        outdeg: dict[str, int] = {n: 0 for n in nodes}
        for (s, _t) in edge_set:
            if s in outdeg:
                outdeg[s] += 1

        dangling = sorted([n for n, d in outdeg.items() if d == 0])

        titles = {n: job.titles[n] for n in nodes if n in job.titles}

        stats = {
            "nodeCount": len(nodes),
            "edgeCount": len(edges),
            "visitedCount": len(job.visited_urls),
            "maxPages": job.max_pages,
            "maxDepth": job.max_depth,
            "ignoreQueryParams": job.ignore_query_params,
            "renderJs": job.render_js,
            "startUrl": job.start_url,
            "currentUrl": job.current_url,
            "queueSize": job.queue_size,
            "state": job.state,
        }

    return CrawlResultResponse(
        jobId=job.job_id,
        nodes=nodes,
        edges=edges,
        danglingNodes=dangling,
        titles=titles,
        stats=stats,
    )
