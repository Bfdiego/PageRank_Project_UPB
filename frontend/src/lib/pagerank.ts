export type PageRankOptions = {
  d: number;
  maxIter: number;
  tol: number;
};

export type ScoreRow = { url: string; score: number };
export type PageRankHistoryEntry = {
  iteration: number;
  delta: number;
  scores: number[];
};

export type PageRankResult = {
  scores: Float64Array;
  iterations: number;
  converged: boolean;
  history: PageRankHistoryEntry[];
};

function l1Diff(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s;
}

function normalizeSum1(v: Float64Array): void {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i];
  if (sum === 0) return;
  for (let i = 0; i < v.length; i++) v[i] = v[i] / sum;
}

// PageRank iterativo (random surfer) basado en la ecuacion del paper de Ian Rogers:
// PR(A) = (1-d)/N + d * sum_{T in In(A)} PR(T)/C(T)
// + dangling nodes: danglingSum/N se suma a todos.
export function pageRank(
  nodes: string[],
  edges: Array<{ source: string; target: string }>,
  opts: PageRankOptions
): PageRankResult {
  const N = nodes.length;
  if (N === 0) {
    return {
      scores: new Float64Array(),
      iterations: 0,
      converged: true,
      history: [],
    };
  }

  const idx = new Map<string, number>();
  for (let i = 0; i < N; i++) idx.set(nodes[i], i);

  const edgeSet = new Set<string>();
  const outdeg = new Int32Array(N);
  const inLinks: number[][] = Array.from({ length: N }, () => []);

  for (const e of edges) {
    const si = idx.get(e.source);
    const ti = idx.get(e.target);
    if (si === undefined || ti === undefined) continue;
    if (si === ti) continue;
    const key = `${si}->${ti}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    outdeg[si] += 1;
    inLinks[ti].push(si);
  }

  let pr = new Float64Array(N);
  for (let i = 0; i < N; i++) pr[i] = 1 / N;

  const d = Math.min(1, Math.max(0, opts.d));
  const base = (1 - d) / N;
  const maxIter = Math.max(0, Math.floor(opts.maxIter));
  const tol = Math.max(0, opts.tol);
  let iterations = 0;
  let converged = false;
  const history: PageRankHistoryEntry[] = [
    { iteration: 0, delta: 0, scores: Array.from(pr) },
  ];

  for (let it = 1; it <= maxIter; it++) {
    const next = new Float64Array(N);

    let danglingSum = 0;
    for (let i = 0; i < N; i++) {
      if (outdeg[i] === 0) danglingSum += pr[i];
    }
    const danglingShare = danglingSum / N;

    for (let a = 0; a < N; a++) {
      let incoming = 0;
      const ins = inLinks[a];
      for (let k = 0; k < ins.length; k++) {
        const t = ins[k];
        const c = outdeg[t];
        if (c > 0) incoming += pr[t] / c;
      }
      next[a] = base + d * (incoming + danglingShare);
    }

    normalizeSum1(next);

    const diff = l1Diff(pr, next);
    pr = next;
    iterations = it;
    history.push({ iteration: it, delta: diff, scores: Array.from(pr) });

    if (diff < tol) {
      converged = true;
      break;
    }
  }

  return { scores: pr, iterations, converged, history };
}
