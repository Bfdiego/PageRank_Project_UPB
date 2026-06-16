import { canonicalizeUrl } from "./url";

export type GraphEdge = { source: string; target: string };

export function computeDepths(startUrl: string, nodes: string[], edges: GraphEdge[]): Map<string, number> {
  const depth = new Map<string, number>();
  for (const n of nodes) depth.set(n, Infinity);
  if (!depth.has(startUrl)) depth.set(startUrl, 0);

  const out = new Map<string, string[]>();
  for (const n of nodes) out.set(n, []);
  for (const e of edges) {
    if (!out.has(e.source)) out.set(e.source, []);
    out.get(e.source)!.push(e.target);
  }

  const q: string[] = [];
  depth.set(startUrl, 0);
  q.push(startUrl);

  while (q.length) {
    const cur = q.shift()!;
    const d = depth.get(cur) ?? Infinity;
    const nbrs = out.get(cur) ?? [];
    for (const nxt of nbrs) {
      const prev = depth.get(nxt);
      if (prev === undefined || prev > d + 1) {
        depth.set(nxt, d + 1);
        q.push(nxt);
      }
    }
  }

  return depth;
}

export function resolveGraphStartUrl(
  stats: Record<string, unknown> | undefined,
  fallbackUrl: string,
  ignoreQueryParams: boolean
): string {
  return typeof stats?.startUrl === "string" && stats.startUrl
    ? stats.startUrl
    : canonicalizeUrl(fallbackUrl, ignoreQueryParams);
}
