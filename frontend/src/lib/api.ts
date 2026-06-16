export type CrawlStartPayload = {
  startUrl: string;
  maxPages: number;
  maxDepth: number;
  ignoreQueryParams: boolean;
  // El backend soporta este flag, pero no todas las fases lo implementan.
  renderJs?: boolean;
};

export type CrawlStatus = {
  jobId: string;
  state: "idle" | "running" | "done" | "error" | "stopped";
  visited: number;
  maxPages: number;
  elapsedSeconds: number;
  currentUrl?: string | null;
  queueSize?: number;
  error?: string | null;
};

export type CrawlEdge = { source: string; target: string };

export type CrawlResult = {
  jobId: string;
  nodes: string[];
  edges: CrawlEdge[];
  danglingNodes: string[];
  titles: Record<string, string>;
  stats: Record<string, any>;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ||
  "http://localhost:8000";

async function buildApiError(res: Response, action: string): Promise<Error> {
  const text = await res.text();
  const detail = text.trim();
  const suffix = detail ? `: ${detail}` : "";
  return new Error(`No se pudo ${action} (HTTP ${res.status})${suffix}`);
}

export async function startCrawl(
  payload: CrawlStartPayload,
): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE}/api/crawl/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await buildApiError(res, "iniciar el crawl");
  }

  return res.json();
}

export async function stopCrawl(jobId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/crawl/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId }),
  });

  if (!res.ok) {
    throw await buildApiError(res, "detener el crawl");
  }
}

export async function getStatus(jobId: string): Promise<CrawlStatus> {
  const url = new URL(`${API_BASE}/api/crawl/status`);
  url.searchParams.set("jobId", jobId);

  const res = await fetch(url.toString(), { method: "GET" });

  if (!res.ok) {
    throw await buildApiError(res, "consultar el estado del crawl");
  }

  return res.json();
}

export async function getResult(jobId: string): Promise<CrawlResult> {
  const url = new URL(`${API_BASE}/api/crawl/result`);
  url.searchParams.set("jobId", jobId);

  const res = await fetch(url.toString(), { method: "GET" });

  if (!res.ok) {
    throw await buildApiError(res, "obtener el grafo del crawl");
  }

  return res.json();
}
