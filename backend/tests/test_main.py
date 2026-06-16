from __future__ import annotations

import time
import unittest
from contextlib import ExitStack
from typing import Optional
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import main as m


class FakeResponse:
    def __init__(self, text: str, status_code: int = 200, headers: Optional[dict[str, str]] = None):
        self.text = text
        self.status_code = status_code
        self.headers = headers or {"content-type": "text/html"}


class FakeClient:
    def __init__(self, pages: dict[str, FakeResponse]):
        self.pages = pages

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def get(self, url: str):
        return self.pages[url]


class CanonicalizationTests(unittest.TestCase):
    def test_canonicalizes_root_url_with_trailing_slash(self):
        self.assertEqual(
            m._canonicalize_url("https://example.com", "https://example.com", True),
            "https://example.com/",
        )

    def test_canonicalizes_query_fragments_host_and_default_port(self):
        self.assertEqual(
            m._canonicalize_url("https://example.com", "HTTPS://Example.COM:443/docs/?x=1#frag", True),
            "https://example.com/docs",
        )
        self.assertEqual(
            m._canonicalize_url("https://example.com", "HTTPS://Example.COM:443/docs/?x=1#frag", False),
            "https://example.com/docs?x=1",
        )


class CrawlerTests(unittest.TestCase):
    def test_static_crawler_collects_canonical_same_domain_edges(self):
        job = m.Job(
            job_id="job",
            start_time=time.time(),
            max_pages=10,
            max_depth=1,
            ignore_query_params=True,
            start_url="https://example.com/",
        )
        pages = {
            "https://example.com/": FakeResponse(
                """
                <html>
                  <a href="/a/">A</a>
                  <a href="/b?x=1#frag">B</a>
                  <a href="https://other.example/">External</a>
                </html>
                """
            ),
            "https://example.com/a": FakeResponse('<a href="/">Home</a>'),
            "https://example.com/b": FakeResponse("No links"),
        }

        with ExitStack() as stack:
            stack.enter_context(patch.object(m, "_is_safe_public_url", return_value=True))
            stack.enter_context(patch.object(m.httpx, "Client", return_value=FakeClient(pages)))
            stack.enter_context(patch.object(m.time, "sleep", return_value=None))
            m._crawl_static_html(job)

        self.assertEqual(job.state, "done")
        self.assertIn("https://example.com/", job.visited_urls)
        self.assertIn("https://example.com/a", job.visited_urls)
        self.assertIn("https://example.com/b", job.visited_urls)
        self.assertIn(("https://example.com/", "https://example.com/a"), job.edges)
        self.assertIn(("https://example.com/", "https://example.com/b"), job.edges)
        self.assertNotIn(("https://example.com/", "https://other.example/"), job.edges)


class EndpointTests(unittest.TestCase):
    def setUp(self):
        m.JOBS.clear()

    def test_start_status_and_result_endpoints_return_finished_graph(self):
        def fake_crawl(job: m.Job):
            with job.lock:
                job.visited_urls.update({job.start_url, "https://example.com/a"})
                job.edges.append((job.start_url, "https://example.com/a"))
                job.visited = 2
                job.state = "done"

        client = TestClient(m.app)

        with ExitStack() as stack:
            stack.enter_context(patch.object(m, "_is_safe_public_url", return_value=True))
            stack.enter_context(patch.object(m, "_crawl_static_html", side_effect=fake_crawl))
            start = client.post(
                "/api/crawl/start",
                json={
                    "startUrl": "https://example.com",
                    "maxPages": 10,
                    "maxDepth": 2,
                    "ignoreQueryParams": True,
                },
            )
            self.assertEqual(start.status_code, 200)
            job_id = start.json()["jobId"]

            status = client.get("/api/crawl/status", params={"jobId": job_id})
            for _ in range(20):
                if status.json()["state"] == "done":
                    break
                time.sleep(0.01)
                status = client.get("/api/crawl/status", params={"jobId": job_id})
            self.assertEqual(status.status_code, 200)
            self.assertEqual(status.json()["state"], "done")

            result = client.get("/api/crawl/result", params={"jobId": job_id})
            self.assertEqual(result.status_code, 200)
            payload = result.json()
            self.assertEqual(payload["stats"]["startUrl"], "https://example.com/")
            self.assertIn("https://example.com/", payload["nodes"])
            self.assertIn({"source": "https://example.com/", "target": "https://example.com/a"}, payload["edges"])


if __name__ == "__main__":
    unittest.main()
