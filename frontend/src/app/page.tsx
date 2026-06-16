"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CrawlForm from "../components/CrawlForm";
import SettingsPanel from "../components/SettingsPanel";
import CrawlStatusCard from "../components/CrawlStatus";
import {
  getResult,
  getStatus,
  startCrawl,
  stopCrawl,
  type CrawlResult,
  type CrawlStatus,
} from "../lib/api";
import { canLoadGraph } from "../lib/crawl";
import { computeDepths, resolveGraphStartUrl } from "../lib/graph";
import { pageRank, type PageRankResult, type ScoreRow } from "../lib/pagerank";
import { canonicalizeUrl } from "../lib/url";

type SavedSnapshot = {
  savedAt: string;
  settings: {
    url: string;
    maxPages: number;
    maxDepth: number;
    damping: number;
    iterations: number;
    tolerance: number;
    topN: 10 | 50 | 0;
    query: string;
    graphMode: "overview" | "focus";
    graphTopK: 50 | 100 | 150;
    edgeDensity: "clean" | "balanced" | "all";
    nodeColorMode: "folder" | "score";
  };
  selectedUrl: string | null;
  graph: CrawlResult | null;
  scores: ScoreRow[] | null;
};

const DEFAULT_START_URL = "https://www.upb.edu";
const IGNORE_QUERY_PARAMS = true;
const SNAPSHOT_STORAGE_KEY = "pagerank-project.snapshot.v2";

function shortPath(u: string): string {
  try {
    const url = new URL(u);
    const p = url.pathname && url.pathname !== "/" ? url.pathname : "/";
    // Make the homepage label clearer (avoid multiple nodes that look like just "/")
    const base = p === "/" ? `/${url.hostname}` : p;
    return base.length > 34 ? base.slice(0, 31) + "…" : base;
  } catch {
    return u;
  }
}

function guessTitle(u: string): string {
  try {
    const url = new URL(u);
    // fallback simple: last path segment or hostname
    const parts = url.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return decodeURIComponent(last);
    return url.hostname;
  } catch {
    return u;
  }
}

// Título legible: prioriza el <title> real extraído por el crawler;
// si no existe (página sin <title> o no visitada), cae a guessTitle(u).
function titleFor(u: string, titles?: Record<string, string> | null): string {
  const real = titles?.[u]?.trim();
  return real ? real : guessTitle(u);
}

function truncateLabel(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function folderKey(u: string): string {
  try {
    const url = new URL(u);
    const seg = url.pathname.split("/").filter(Boolean)[0];
    return seg ? `/${seg}` : "/";
  } catch {
    return "/";
  }
}

function hashColorIndex(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return mod === 0 ? 0 : h % mod;
}

const FOLDER_HUES = [0, 25, 45, 70, 95, 120, 160, 190, 220, 250, 280, 320];

function folderColor(cidx: number): string {
  const h = FOLDER_HUES[cidx % FOLDER_HUES.length];
  return `hsl(${h}, 70%, 55%)`;
}

function scoreToVisualSize(
  score: number,
  minScore: number,
  maxScore: number,
  minSize: number,
  maxSize: number,
): number {
  if (!Number.isFinite(score)) return minSize;
  if (
    !Number.isFinite(minScore) ||
    !Number.isFinite(maxScore) ||
    maxScore <= minScore
  ) {
    return (minSize + maxSize) / 2;
  }
  const t = Math.max(
    0,
    Math.min(1, (score - minScore) / (maxScore - minScore)),
  );
  const eased = Math.pow(t, 0.65);
  return minSize + (maxSize - minSize) * eased;
}

// Escala secuencial para colorear nodos por PageRank: score bajo = azul claro,
// score alto = azul oscuro (más oscuro = más autoridad).
function scoreToColor(
  score: number,
  minScore: number,
  maxScore: number,
): string {
  if (
    !Number.isFinite(score) ||
    !Number.isFinite(minScore) ||
    !Number.isFinite(maxScore) ||
    maxScore <= minScore
  ) {
    return "hsl(220, 75%, 60%)";
  }
  const t = Math.max(
    0,
    Math.min(1, (score - minScore) / (maxScore - minScore)),
  );
  const eased = Math.pow(t, 0.65);
  const lightness = 86 - eased * 52; // 86% (bajo) -> 34% (alto)
  return `hsl(220, 82%, ${lightness}%)`;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function makeFileTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  const [url, setUrl] = useState(DEFAULT_START_URL);
  const [maxPages, setMaxPages] = useState(200);
  const [maxDepth, setMaxDepth] = useState(4);

  const [graph, setGraph] = useState<CrawlResult | null>(null);
  const [damping, setDamping] = useState(0.85);
  const [iterations, setIterations] = useState(100);
  const [tolerance, setTolerance] = useState(1e-6);
  const [scores, setScores] = useState<ScoreRow[] | null>(null);
  const [rankResult, setRankResult] = useState<PageRankResult | null>(null);
  const [animationStep, setAnimationStep] = useState(0);
  const [animationPlaying, setAnimationPlaying] = useState(false);
  const [animationSpeed, setAnimationSpeed] = useState(650);

  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [topN, setTopN] = useState<10 | 50 | 0>(10); // 0 = all
  const [query, setQuery] = useState("");

  const [graphMode, setGraphMode] = useState<"overview" | "focus">("overview");
  const [graphTopK, setGraphTopK] = useState<50 | 100 | 150>(100);
  const [edgeDensity, setEdgeDensity] = useState<"clean" | "balanced" | "all">(
    "balanced",
  );
  const [nodeColorMode, setNodeColorMode] = useState<"folder" | "score">(
    "folder",
  );

  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<CrawlStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);

    try {
      const raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as Partial<SavedSnapshot>;
      const settings = parsed.settings;

      if (settings && typeof settings === "object") {
        if (typeof settings.url === "string" && settings.url.trim())
          setUrl(settings.url);
        if (
          typeof settings.maxPages === "number" &&
          Number.isFinite(settings.maxPages)
        )
          setMaxPages(settings.maxPages);
        if (
          typeof settings.maxDepth === "number" &&
          Number.isFinite(settings.maxDepth)
        )
          setMaxDepth(settings.maxDepth);
        if (
          typeof settings.damping === "number" &&
          Number.isFinite(settings.damping)
        )
          setDamping(settings.damping);
        if (
          typeof settings.iterations === "number" &&
          Number.isFinite(settings.iterations)
        )
          setIterations(settings.iterations);
        if (
          typeof settings.tolerance === "number" &&
          Number.isFinite(settings.tolerance)
        )
          setTolerance(settings.tolerance);
        if (settings.topN === 10 || settings.topN === 50 || settings.topN === 0)
          setTopN(settings.topN);
        if (typeof settings.query === "string") setQuery(settings.query);
        if (settings.graphMode === "overview" || settings.graphMode === "focus")
          setGraphMode(settings.graphMode);
        if (
          settings.graphTopK === 50 ||
          settings.graphTopK === 100 ||
          settings.graphTopK === 150
        ) {
          setGraphTopK(settings.graphTopK);
        }
        if (
          settings.edgeDensity === "clean" ||
          settings.edgeDensity === "balanced" ||
          settings.edgeDensity === "all"
        ) {
          setEdgeDensity(settings.edgeDensity);
        }
        if (
          settings.nodeColorMode === "folder" ||
          settings.nodeColorMode === "score"
        ) {
          setNodeColorMode(settings.nodeColorMode);
        }
      }

      if (parsed.selectedUrl === null || typeof parsed.selectedUrl === "string")
        setSelectedUrl(parsed.selectedUrl ?? null);

      if (parsed.graph && typeof parsed.graph === "object") {
        const g = parsed.graph as CrawlResult;
        if (Array.isArray(g.nodes) && Array.isArray(g.edges)) setGraph(g);
      }

      if (Array.isArray(parsed.scores)) {
        const cleanScores: ScoreRow[] = parsed.scores.filter(
          (r): r is ScoreRow =>
            Boolean(r) &&
            typeof (r as ScoreRow).url === "string" &&
            typeof (r as ScoreRow).score === "number" &&
            Number.isFinite((r as ScoreRow).score),
        );
        setScores(cleanScores.length ? cleanScores : null);
      }
    } catch {
      // ignore invalid snapshot
    }
  }, []);

  const running = useMemo(() => status?.state === "running", [status?.state]);
  const loadGraphReady = useMemo(() => canLoadGraph(status), [status]);

  const pollTimer = useRef<number | null>(null);

  const cyContainerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<any>(null);

  const graphNodeIndexMap = useMemo(() => {
    if (!graph) return null;
    const map = new Map<string, number>();
    graph.nodes.forEach((node, index) => map.set(node, index));
    return map;
  }, [graph]);

  const graphComputed = useMemo(() => {
    if (!graph) return null;

    const inbound = new Map<string, string[]>();
    const outbound = new Map<string, string[]>();
    for (const n of graph.nodes) {
      inbound.set(n, []);
      outbound.set(n, []);
    }

    for (const e of graph.edges) {
      if (!outbound.has(e.source)) outbound.set(e.source, []);
      if (!inbound.has(e.target)) inbound.set(e.target, []);
      outbound.get(e.source)!.push(e.target);
      inbound.get(e.target)!.push(e.source);
    }

    // Dedup lists
    for (const [k, arr] of outbound) outbound.set(k, Array.from(new Set(arr)));
    for (const [k, arr] of inbound) inbound.set(k, Array.from(new Set(arr)));

    const graphStartUrl = resolveGraphStartUrl(
      graph.stats,
      url,
      IGNORE_QUERY_PARAMS,
    );
    const depths = computeDepths(graphStartUrl, graph.nodes, graph.edges);

    return { inbound, outbound, depths };
  }, [graph, url]);

  const filteredScores = useMemo(() => {
    if (!scores) return null;
    const q = query.trim().toLowerCase();
    let list = scores;
    if (q) {
      list = list.filter((r) => r.url.toLowerCase().includes(q));
    }
    if (topN === 0) return list;
    return list.slice(0, topN);
  }, [scores, query, topN]);

  const scoreRankMap = useMemo(() => {
    if (!scores) return null;
    const ranks = new Map<string, number>();
    scores.forEach((row, index) => ranks.set(row.url, index + 1));
    return ranks;
  }, [scores]);

  const inDegreeRankMap = useMemo(() => {
    if (!scores || !graphComputed || !scoreRankMap) return null;
    const ranked = [...scores].sort((a, b) => {
      const aIn = graphComputed.inbound.get(a.url)?.length ?? 0;
      const bIn = graphComputed.inbound.get(b.url)?.length ?? 0;
      if (aIn !== bIn) return bIn - aIn;
      return (scoreRankMap.get(a.url) ?? 0) - (scoreRankMap.get(b.url) ?? 0);
    });
    const ranks = new Map<string, number>();
    ranked.forEach((row, index) => ranks.set(row.url, index + 1));
    return ranks;
  }, [scores, graphComputed, scoreRankMap]);

  const vizData = useMemo(() => {
    if (!graph || !scores) return null;

    const scoreMap = new Map<string, number>();
    for (const s of scores) scoreMap.set(s.url, s.score);

    // Overview: top K
    const topList = scores.slice(0, graphTopK).map((s) => s.url);
    const topSet = new Set(topList);

    // Choose a stable root:
    // 1) selectedUrl if valid
    // 2) a homepage-like node (path == "/") if present
    // 3) otherwise the top-scoring node
    let focusCenter: string | null = null;
    if (selectedUrl && graph.nodes.includes(selectedUrl)) {
      focusCenter = selectedUrl;
    } else {
      const rootCandidate = graph.nodes.find((u) => {
        try {
          return new URL(u).pathname === "/";
        } catch {
          return false;
        }
      });
      focusCenter = rootCandidate ?? scores[0]?.url ?? null;
    }

    // Focus: ego 1-hop
    const inbound = focusCenter
      ? (graphComputed?.inbound.get(focusCenter) ?? [])
      : [];
    const outbound = focusCenter
      ? (graphComputed?.outbound.get(focusCenter) ?? [])
      : [];
    const focusNodes = focusCenter
      ? Array.from(new Set([focusCenter, ...inbound, ...outbound]))
      : [];
    const focusSet = new Set(focusNodes);

    const modeSet = graphMode === "overview" ? topSet : focusSet;

    // If the backend returns multiple variants of the homepage (e.g. https://site and https://site/)
    // they can look like duplicates. In overview, keep only the best-scoring one.
    if (graphMode === "overview") {
      const roots = Array.from(modeSet).filter((u) => {
        try {
          const uu = new URL(u);
          return uu.pathname === "/";
        } catch {
          return false;
        }
      });

      if (roots.length > 1) {
        roots.sort((a, b) => (scoreMap.get(b) ?? 0) - (scoreMap.get(a) ?? 0));
        const keep = roots[0];
        for (let i = 1; i < roots.length; i++) modeSet.delete(roots[i]);

        // Ensure the kept root stays
        modeSet.add(keep);
      }
    }

    // --- edges and cleaning isolated nodes ---
    const dedupEdgeSet = new Set<string>();
    let edges = graph.edges.filter((e) => {
      if (!modeSet.has(e.source) || !modeSet.has(e.target)) return false;
      const id = `${e.source}-->${e.target}`;
      if (dedupEdgeSet.has(id)) return false;
      dedupEdgeSet.add(id);
      return true;
    });

    if (graphMode === "overview" && edgeDensity !== "all") {
      const keepRatio = edgeDensity === "balanced" ? 0.55 : 0.35;
      const nodesPre = Array.from(modeSet);
      const keepTop = Math.max(8, Math.ceil(nodesPre.length * keepRatio));
      edges = edges.filter((e) => {
        const sr = scores.findIndex((s) => s.url === e.source);
        const tr = scores.findIndex((s) => s.url === e.target);
        return sr < keepTop || tr < keepTop;
      });
    }

    // In overview, after filtering edges, drop isolated nodes so the view stays clean.
    // (Otherwise you'll see many nodes with no connections.)
    if (graphMode === "overview") {
      const connected = new Set<string>();
      for (const e of edges) {
        connected.add(e.source);
        connected.add(e.target);
      }

      // If we somehow ended with 0 edges, fallback to the top few nodes.
      if (connected.size > 0) {
        // Rebuild nodes from connected set only
        for (const n of Array.from(modeSet)) {
          if (!connected.has(n)) modeSet.delete(n);
        }
      } else {
        // Keep only the top 8 to avoid a blank ring.
        modeSet.clear();
        for (const n of scores
          .slice(0, Math.min(8, scores.length))
          .map((s) => s.url)) {
          modeSet.add(n);
        }
      }
    }

    // Recompute nodes after potential cleanup
    const nodesClean = Array.from(modeSet);
    const nodes = nodesClean;

    const rankedNodes = [...nodes].sort(
      (a, b) => (scoreMap.get(b) ?? 0) - (scoreMap.get(a) ?? 0),
    );
    const rankMap = new Map<string, number>();
    rankedNodes.forEach((n, i) => rankMap.set(n, i));
    const scoreValues = rankedNodes.map((n) => scoreMap.get(n) ?? 0);
    const minScore = scoreValues.length ? Math.min(...scoreValues) : 0;
    const maxScore = scoreValues.length ? Math.max(...scoreValues) : 0;

    const labelSet = new Set<string>();
    if (graphMode === "overview") {
      // Root label always
      if (focusCenter) labelSet.add(focusCenter);

      // Top by score
      const topLabelCount = Math.min(10, rankedNodes.length);
      for (const n of rankedNodes.slice(0, topLabelCount)) labelSet.add(n);

      // Also label shallow nodes (depth 0/1) when available
      const depths = graphComputed?.depths;
      if (depths) {
        for (const n of nodes) {
          const d = depths.get(n);
          if (d !== undefined && d <= 1) labelSet.add(n);
        }
      }
    } else {
      // In focus view, label all nodes (small ego-graph)
      for (const n of nodes) labelSet.add(n);
    }

    const elements: any[] = [];
    const folderCounts = new Map<string, { cidx: number; count: number }>();

    for (const n of nodes) {
      const sc = scoreMap.get(n) ?? 0;
      const cluster = folderKey(n);
      const cidx = hashColorIndex(cluster, 12);
      const rank = rankMap.get(n) ?? nodes.length;
      elements.push({
        data: {
          id: n,
          label: truncateLabel(titleFor(n, graph.titles), 40),
          score: sc,
          cluster,
          cidx,
          rank,
          showLabel: labelSet.has(n),
          minScore,
          maxScore,
        },
      });
      const existing = folderCounts.get(cluster);
      if (existing) existing.count += 1;
      else folderCounts.set(cluster, { cidx, count: 1 });
    }

    const folderLegend = Array.from(folderCounts.entries())
      .map(([cluster, { cidx, count }]) => ({
        cluster,
        color: folderColor(cidx),
        count,
      }))
      .sort((a, b) => b.count - a.count);

    for (const e of edges) {
      elements.push({
        data: {
          id: `${e.source}-->${e.target}`,
          source: e.source,
          target: e.target,
        },
      });
    }

    return {
      elements,
      focusCenter,
      folderLegend,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    };
  }, [
    graph,
    scores,
    graphTopK,
    graphMode,
    selectedUrl,
    graphComputed,
    edgeDensity,
  ]);

  const rebuildCytoscape = useCallback(async () => {
    if (!mounted) return;
    if (!cyContainerRef.current) return;
    if (!vizData) return;

    const cytoscapeMod: any = await import("cytoscape");
    const cytoscape = cytoscapeMod.default ?? cytoscapeMod;

    if (cyRef.current) {
      try {
        cyRef.current.destroy();
      } catch {}
      cyRef.current = null;
    }

    const minSize = 10;
    const maxSize = graphMode === "overview" ? 24 : 30;

    const layout =
      graphMode === "overview"
        ? {
            name: "breadthfirst",
            fit: true,
            animate: false,
            padding: 36,
            directed: true,
            circle: false,
            // more spacing between layers/nodes
            spacingFactor: 2.4,
            avoidOverlap: true,
            nodeDimensionsIncludeLabels: false,
            roots: [vizData.focusCenter ?? ""].filter(Boolean),
          }
        : {
            name: "breadthfirst",
            fit: true,
            animate: false,
            padding: 36,
            spacingFactor: 1.2,
            avoidOverlap: true,
            directed: true,
            roots: vizData.focusCenter ? [vizData.focusCenter] : undefined,
          };

    const cy = cytoscape({
      container: cyContainerRef.current,
      elements: vizData.elements,
      layout,
      style: [
        {
          selector: "node",
          style: {
            label: (ele: any) =>
              ele.data("showLabel") ? ele.data("label") : "",
            "font-size": 9,
            "text-valign": "bottom",
            "text-halign": "center",
            "text-wrap": "wrap",
            "text-max-width": 120,
            width: (ele: any) =>
              scoreToVisualSize(
                Number(ele.data("score")) || 0,
                Number(ele.data("minScore")) || 0,
                Number(ele.data("maxScore")) || 0,
                minSize,
                maxSize,
              ),
            height: (ele: any) =>
              scoreToVisualSize(
                Number(ele.data("score")) || 0,
                Number(ele.data("minScore")) || 0,
                Number(ele.data("maxScore")) || 0,
                minSize,
                maxSize,
              ),
            "background-color": (ele: any) => {
              if (nodeColorMode === "score") {
                return scoreToColor(
                  Number(ele.data("score")) || 0,
                  Number(ele.data("minScore")) || 0,
                  Number(ele.data("maxScore")) || 0,
                );
              }
              return folderColor(Number(ele.data("cidx")) || 0);
            },
            "border-width": 1.5,
            "border-color": "#ffffff",
            color: "#111111",
            "text-background-color": "#ffffff",
            "text-background-opacity": 0.85,
            "text-background-padding": 2,
          },
        },
        {
          selector: "node:hover",
          style: {
            label: "data(label)",
            "font-size": 10,
            "z-index": 9999,
            "text-background-opacity": 0.9,
            "text-wrap": "none",
            "text-max-width": 300,
          },
        },
        {
          selector: "node:selected",
          style: {
            label: "data(label)",
            "font-size": 10,
            "z-index": 9999,
            "text-wrap": "none",
            "text-max-width": 300,
          },
        },
        {
          selector: "node.iteration-leading",
          style: {
            label: "data(label)",
            "border-color": "#1d4ed8",
            "border-width": 4,
            "font-size": 10,
            "overlay-color": "#2563eb",
            "overlay-opacity": 0.18,
            "overlay-padding": 8,
            "z-index": 9996,
          },
        },
        {
          selector: "node.iteration-rising",
          style: {
            "border-color": "#38bdf8",
            "border-width": 2.5,
            "overlay-color": "#38bdf8",
            "overlay-opacity": 0.1,
            "overlay-padding": 5,
          },
        },
        {
          selector: "node.authority-dimmed",
          style: {
            opacity: 0.22,
          },
        },
        {
          selector: "node.authority-target",
          style: {
            label: "data(label)",
            "border-color": "#111111",
            "border-width": 5,
            "font-size": 11,
            "z-index": 9999,
            "text-wrap": "none",
            "text-max-width": 320,
            opacity: 1,
          },
        },
        {
          // Halo (overlay), not border, so it can coexist with authority-source's
          // border on nodes that are both (mutual links) — a node can show the
          // orange "le da autoridad" border and the teal "lo enlaza" halo at once.
          selector: "node.outgoing-target",
          style: {
            "overlay-color": "#0f766e",
            "overlay-opacity": 0.35,
            "overlay-padding": 6,
            opacity: 1,
          },
        },
        {
          selector: "node.authority-source",
          style: {
            label: "data(label)",
            "border-color": "#f59f00",
            "border-width": 4,
            "font-size": 10,
            "z-index": 9998,
            "text-wrap": "none",
            "text-max-width": 300,
            opacity: 1,
          },
        },
        {
          selector: "edge",
          style: {
            width: 1,
            "line-color": "#adb5bd",
            "target-arrow-color": "#adb5bd",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            opacity: 0.45,
          },
        },
        {
          selector: "edge.authority-dimmed",
          style: {
            opacity: 0.08,
          },
        },
        {
          selector: "edge.incoming-authority",
          style: {
            width: 4,
            "line-color": "#f59f00",
            "target-arrow-color": "#f59f00",
            opacity: 0.96,
            "z-index": 9997,
          },
        },
        {
          selector: "edge.outgoing-link",
          style: {
            width: 2,
            "line-color": "#0f766e",
            "target-arrow-color": "#0f766e",
            opacity: 0.85,
          },
        },
        {
          selector: ":selected",
          style: {
            "border-color": "#111111",
            "border-width": 4,
            "line-color": "#111111",
            "target-arrow-color": "#111111",
          },
        },
      ],
      userZoomingEnabled: true,
      userPanningEnabled: true,
      wheelSensitivity: 0.2,
    });

    const highlightedClasses =
      "authority-dimmed authority-source authority-target incoming-authority outgoing-link outgoing-target";

    function highlightAuthorityForNode(id: string | null) {
      cy.elements().removeClass(highlightedClasses);
      cy.nodes().unselect();

      if (!id) return;

      const target = cy.getElementById(id);
      if (!target || target.empty()) return;

      const incomingEdges = target.incomers("edge");
      const incomingSources = incomingEdges.sources();
      const outgoingEdges = target.outgoers("edge");
      const outgoingTargets = outgoingEdges.targets();

      cy.elements().addClass("authority-dimmed");
      target
        .removeClass("authority-dimmed")
        .addClass("authority-target")
        .select();

      incomingSources
        .removeClass("authority-dimmed")
        .addClass("authority-source");
      incomingEdges
        .removeClass("authority-dimmed")
        .addClass("incoming-authority");

      outgoingTargets
        .removeClass("authority-dimmed")
        .addClass("outgoing-target");
      outgoingEdges.removeClass("authority-dimmed").addClass("outgoing-link");
    }

    cy.on("tap", "node", (evt: any) => {
      const id = evt.target.id();
      if (typeof id === "string") {
        highlightAuthorityForNode(id);
        setSelectedUrl(id);
      }
    });

    highlightAuthorityForNode(selectedUrl);

    cyRef.current = cy;
    cy.layout(layout).run();
  }, [mounted, vizData, graphMode, selectedUrl, nodeColorMode, setSelectedUrl]);

  useEffect(() => {
    rebuildCytoscape();
    return () => {
      if (cyRef.current) {
        try {
          cyRef.current.destroy();
        } catch {}
        cyRef.current = null;
      }
    };
  }, [rebuildCytoscape]);

  const animationMaxStep = rankResult
    ? Math.max(0, rankResult.history.length - 1)
    : 0;
  const animationEntry = rankResult
    ? (rankResult.history[Math.min(animationStep, animationMaxStep)] ?? null)
    : null;

  const animationTopRows = useMemo(() => {
    if (!graph || !animationEntry) return [];
    return graph.nodes
      .map((node, index) => ({
        url: node,
        score: animationEntry.scores[index] ?? 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [graph, animationEntry]);

  useEffect(() => {
    if (!rankResult) {
      setAnimationPlaying(false);
      setAnimationStep(0);
      return;
    }

    setAnimationStep((step) =>
      Math.min(step, Math.max(0, rankResult.history.length - 1)),
    );
  }, [rankResult]);

  useEffect(() => {
    if (!animationPlaying || !rankResult) return;

    if (animationStep >= animationMaxStep) {
      setAnimationPlaying(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setAnimationStep((step) => Math.min(step + 1, animationMaxStep));
    }, animationSpeed);

    return () => window.clearTimeout(timer);
  }, [
    animationPlaying,
    animationStep,
    animationMaxStep,
    animationSpeed,
    rankResult,
  ]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !graphNodeIndexMap || !animationEntry) return;

    const visibleNodes = cy.nodes().toArray();
    if (!visibleNodes.length) return;

    const scoredNodes = visibleNodes.map((node: any) => {
      const index = graphNodeIndexMap.get(node.id());
      const score =
        index === undefined ? 0 : (animationEntry.scores[index] ?? 0);
      return { node, score };
    });

    const scoresInView = scoredNodes.map((item: any) => item.score);
    const minScore = Math.min(...scoresInView);
    const maxScore = Math.max(...scoresInView);
    const minSize = 10;
    const maxSize = graphMode === "overview" ? 24 : 30;
    const duration = animationPlaying
      ? Math.min(Math.max(animationSpeed - 80, 160), 700)
      : 220;

    cy.batch(() => {
      cy.nodes().removeClass("iteration-leading iteration-rising");

      scoredNodes
        .sort((a: any, b: any) => b.score - a.score)
        .forEach((item: any, index: number) => {
          if (index === 0) item.node.addClass("iteration-leading");
          else if (index < 4) item.node.addClass("iteration-rising");
        });

      for (const { node, score } of scoredNodes) {
        const size = scoreToVisualSize(
          score,
          minScore,
          maxScore,
          minSize,
          maxSize,
        );
        node.data("score", score);
        node.data("minScore", minScore);
        node.data("maxScore", maxScore);
        node.stop(true, false).animate(
          {
            style: {
              width: size,
              height: size,
            },
          },
          {
            duration,
            easing: "ease-in-out-cubic",
          },
        );
      }
    });
  }, [
    animationEntry,
    animationPlaying,
    animationSpeed,
    graphMode,
    graphNodeIndexMap,
    vizData,
  ]);

  async function handleCrawl() {
    setError(null);

    const startUrl = canonicalizeUrl(url, IGNORE_QUERY_PARAMS);
    if (!startUrl) {
      setError("La URL está vacía.");
      return;
    }

    try {
      const { jobId } = await startCrawl({
        startUrl,
        maxPages,
        maxDepth,
        ignoreQueryParams: IGNORE_QUERY_PARAMS,
      });

      setJobId(jobId);
      setStatus({
        jobId,
        state: "running",
        visited: 0,
        maxPages,
        elapsedSeconds: 0,
        error: null,
      });
      setGraph(null);
      setSelectedUrl(null);
      setScores(null);
      setRankResult(null);
      setAnimationPlaying(false);
      setAnimationStep(0);
    } catch (e: any) {
      setError(e?.message ?? "Error al iniciar crawl.");
    }
  }

  async function handleStop() {
    if (!jobId) return;
    setError(null);

    try {
      await stopCrawl(jobId);
      // el status lo confirmará el polling en breve
    } catch (e: any) {
      setError(e?.message ?? "Error al detener.");
    }
  }

  async function handleLoadGraph() {
    if (!jobId) return;
    if (!loadGraphReady) {
      setError(
        "El crawl todavía no tiene un resultado cargable. Espera a que termine o deténlo después de visitar al menos una página.",
      );
      return;
    }

    setError(null);
    try {
      const g = await getResult(jobId);
      setGraph(g);
      const graphStartUrl = resolveGraphStartUrl(
        g.stats,
        url,
        IGNORE_QUERY_PARAMS,
      );
      setSelectedUrl(
        g.nodes.includes(graphStartUrl) ? graphStartUrl : (g.nodes[0] ?? null),
      );
      setScores(null);
      setRankResult(null);
      setAnimationPlaying(false);
      setAnimationStep(0);
    } catch (e: any) {
      setError(e?.message ?? "Error al obtener grafo.");
    }
  }

  function handleRunPageRank() {
    if (!graph) {
      setError("Primero carga el grafo.");
      return;
    }
    setError(null);

    const pr = pageRank(graph.nodes, graph.edges, {
      d: damping,
      maxIter: iterations,
      tol: tolerance,
    });

    const list = graph.nodes
      .map((url, i) => ({ url, score: pr.scores[i] ?? 0 }))
      .sort((a, b) => b.score - a.score);

    setRankResult(pr);
    setScores(list);
    setAnimationPlaying(false);
    setAnimationStep(0);
  }

  function handleExportRankingCsv() {
    if (!scores) {
      setError("No hay ranking para exportar.");
      return;
    }

    const rows: string[] = [];
    rows.push("rank,url,score,inDegree,outDegree,depth");

    for (let i = 0; i < scores.length; i++) {
      const item = scores[i];
      const inDegree = graphComputed?.inbound.get(item.url)?.length ?? 0;
      const outDegree = graphComputed?.outbound.get(item.url)?.length ?? 0;
      const depth = graphComputed?.depths.get(item.url);
      const depthValue =
        depth === undefined || depth === Infinity ? "" : String(depth);
      rows.push(
        [
          String(i + 1),
          csvEscape(item.url),
          item.score.toFixed(12),
          String(inDegree),
          String(outDegree),
          depthValue,
        ].join(","),
      );
    }

    downloadTextFile(
      `ranking-${makeFileTimestamp()}.csv`,
      rows.join("\n"),
      "text/csv;charset=utf-8",
    );
  }

  function handleExportGraphJson() {
    if (!graph) {
      setError("No hay grafo para exportar.");
      return;
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      settings: {
        url,
        maxPages,
        maxDepth,
        ignoreQueryParams: IGNORE_QUERY_PARAMS,
        damping,
        iterations,
        tolerance,
      },
      graph,
      scores,
      pageRank: rankResult
        ? {
            iterations: rankResult.iterations,
            converged: rankResult.converged,
            history: rankResult.history,
            scores: Array.from(rankResult.scores),
          }
        : null,
    };

    downloadTextFile(
      `graph-${makeFileTimestamp()}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8",
    );
  }

  // Polling de status mientras haya jobId
  useEffect(() => {
    async function tick() {
      if (!jobId) return;
      try {
        const s = await getStatus(jobId);
        setStatus(s);

        // Si terminó, deja de pollear
        if (s.state !== "running") {
          if (pollTimer.current) window.clearInterval(pollTimer.current);
          pollTimer.current = null;
        }
      } catch (e: any) {
        setError(e?.message ?? "Error al obtener status.");
      }
    }

    // limpiar anterior
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }

    if (jobId) {
      // primer tick inmediato
      tick();
      pollTimer.current = window.setInterval(tick, 600);
    }

    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    };
  }, [jobId]);

  useEffect(() => {
    if (graphMode === "focus" && scores && !selectedUrl) {
      setSelectedUrl(scores[0]?.url ?? null);
    }
  }, [graphMode, scores, selectedUrl]);

  useEffect(() => {
    if (!mounted) return;

    const snapshot: SavedSnapshot = {
      savedAt: new Date().toISOString(),
      settings: {
        url,
        maxPages,
        maxDepth,
        damping,
        iterations,
        tolerance,
        topN,
        query,
        graphMode,
        graphTopK,
        edgeDensity,
        nodeColorMode,
      },
      selectedUrl,
      graph,
      scores,
    };

    try {
      window.localStorage.setItem(
        SNAPSHOT_STORAGE_KEY,
        JSON.stringify(snapshot),
      );
    } catch {
      // ignore storage quota errors
    }
  }, [
    mounted,
    url,
    maxPages,
    maxDepth,
    damping,
    iterations,
    tolerance,
    topN,
    query,
    graphMode,
    graphTopK,
    edgeDensity,
    nodeColorMode,
    selectedUrl,
    graph,
    scores,
  ]);

  return (
    <main style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>PageRank Project - Interfaz de crawl</h1>

      {!mounted ? (
        <div style={{ marginTop: 12, opacity: 0.75 }}>Cargando...</div>
      ) : (
        <>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <CrawlForm
              url={url}
              setUrl={setUrl}
              onCrawl={handleCrawl}
              onStop={handleStop}
              running={running}
            />
            <SettingsPanel
              maxPages={maxPages}
              setMaxPages={setMaxPages}
              maxDepth={maxDepth}
              setMaxDepth={setMaxDepth}
              disabled={running}
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <CrawlStatusCard status={status} error={error} />
          </div>

          <div
            style={{
              marginTop: 12,
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: 12,
            }}
          >
            <h3 style={{ margin: "0 0 8px" }}>Grafo & PageRank (Ian Rogers)</h3>
            <div style={{ marginTop: 6, opacity: 0.75 }}>
              Flujo: iniciar crawl, cargar grafo y calcular PageRank.
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={handleLoadGraph}
                disabled={!jobId || !loadGraphReady}
              >
                Cargar grafo
              </button>
              <button onClick={handleRunPageRank} disabled={!graph}>
                Calcular PageRank
              </button>
              <button onClick={handleExportGraphJson} disabled={!graph}>
                Exportar grafo JSON
              </button>
              <button onClick={handleExportRankingCsv} disabled={!scores}>
                Exportar ranking CSV
              </button>
            </div>

            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 10,
                }}
              >
                <label style={{ display: "grid", gap: 6 }}>
                  <span>d (amortiguación)</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={damping}
                    onChange={(e) => setDamping(Number(e.target.value))}
                  />
                  <span style={{ fontSize: 12, opacity: 0.7 }}>
                    Probabilidad de seguir enlaces. 0.85 es el valor clásico.
                  </span>
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span>iteraciones máximas</span>
                  <input
                    type="number"
                    min={1}
                    max={2000}
                    value={iterations}
                    onChange={(e) => setIterations(Number(e.target.value))}
                  />
                  <span style={{ fontSize: 12, opacity: 0.7 }}>
                    Límite de pasos del algoritmo si no converge antes.
                  </span>
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span>tolerancia</span>
                  <input
                    type="number"
                    min={0}
                    step={0.000001}
                    value={tolerance}
                    onChange={(e) => setTolerance(Number(e.target.value))}
                  />
                  <span style={{ fontSize: 12, opacity: 0.7 }}>
                    Delta mínimo para detener el cálculo por convergencia.
                  </span>
                </label>
              </div>

              <div style={{ display: "grid", gap: 6, opacity: 0.9 }}>
                <div>
                  <strong>jobId:</strong> {jobId ?? "-"}
                </div>
                <div>
                  <strong>nodos:</strong> {graph?.nodes.length ?? 0} &nbsp; |
                  &nbsp;
                  <strong>aristas:</strong> {graph?.edges.length ?? 0} &nbsp; |
                  &nbsp;
                  <strong>dangling:</strong> {graph?.danglingNodes.length ?? 0}
                </div>
              </div>
            </div>

            {scores ? (
              <div
                style={{
                  marginTop: 12,
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1fr",
                  gap: 12,
                }}
              >
                {/* Left: ranking list */}
                <div
                  style={{
                    border: "1px solid #eee",
                    borderRadius: 8,
                    padding: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <h4 style={{ margin: 0 }}>Ranking</h4>

                    <label
                      style={{ display: "flex", gap: 6, alignItems: "center" }}
                    >
                      <span style={{ opacity: 0.8 }}>Top</span>
                      <select
                        value={topN}
                        onChange={(e) => setTopN(Number(e.target.value) as any)}
                      >
                        <option value={10}>10</option>
                        <option value={50}>50</option>
                        <option value={0}>Todos</option>
                      </select>
                    </label>

                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Buscar por path (ej. /about)"
                      style={{ padding: 6, flex: "1 1 240px" }}
                    />
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                    Compara la posición por PageRank con la posición por
                    in-degree para ver por qué PageRank no es solo contar
                    enlaces.
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    {(filteredScores ?? scores.slice(0, 10)).map((r, i) => {
                      const active = r.url === selectedUrl;
                      const pageRankPosition =
                        scoreRankMap?.get(r.url) ?? i + 1;
                      const inDegree =
                        graphComputed?.inbound.get(r.url)?.length ?? 0;
                      const inDegreePosition = inDegreeRankMap?.get(r.url);
                      const rankDiff =
                        inDegreePosition === undefined
                          ? null
                          : inDegreePosition - pageRankPosition;
                      return (
                        <button
                          key={r.url}
                          onClick={() => setSelectedUrl(r.url)}
                          style={{
                            textAlign: "left",
                            border: active
                              ? "1px solid #999"
                              : "1px solid #eee",
                            borderRadius: 8,
                            padding: 10,
                            background: active ? "#fafafa" : "white",
                            cursor: "pointer",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                            }}
                          >
                            <div style={{ display: "grid", gap: 2 }}>
                              <div style={{ fontSize: 12, opacity: 0.7 }}>
                                #{pageRankPosition}
                              </div>
                              <div style={{ fontWeight: 600 }}>
                                {truncateLabel(titleFor(r.url, graph?.titles), 70)}
                              </div>
                              <div
                                style={{
                                  fontFamily: "monospace",
                                  fontSize: 12,
                                  opacity: 0.8,
                                }}
                              >
                                {shortPath(r.url)}
                              </div>
                              <div style={{ fontSize: 12, opacity: 0.75 }}>
                                PageRank #{pageRankPosition} vs in-degree{" "}
                                {inDegreePosition === undefined
                                  ? "-"
                                  : `#${inDegreePosition}`}
                                {rankDiff === null || rankDiff === 0
                                  ? ""
                                  : ` (${rankDiff > 0 ? "+" : ""}${rankDiff})`}
                              </div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontFamily: "monospace" }}>
                                {r.score.toFixed(8)}
                              </div>
                              <div style={{ fontSize: 12, opacity: 0.7 }}>
                                score PageRank
                              </div>
                              <div
                                style={{
                                  marginTop: 6,
                                  fontFamily: "monospace",
                                }}
                              >
                                {inDegree}
                              </div>
                              <div style={{ fontSize: 12, opacity: 0.7 }}>
                                in-degree
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Right: details panel */}
                <div
                  style={{
                    border: "1px solid #eee",
                    borderRadius: 8,
                    padding: 10,
                  }}
                >
                  <h4 style={{ margin: 0 }}>Detalle</h4>
                  {!selectedUrl ? (
                    <p style={{ marginTop: 8, opacity: 0.75 }}>
                      Selecciona una página en la lista.
                    </p>
                  ) : (
                    (() => {
                      const inbound =
                        graphComputed?.inbound.get(selectedUrl) ?? [];
                      const outbound =
                        graphComputed?.outbound.get(selectedUrl) ?? [];
                      const indeg = inbound.length;
                      const outdeg = outbound.length;
                      const depth = graphComputed?.depths.get(selectedUrl);
                      const score =
                        scores.find((s) => s.url === selectedUrl)?.score ?? 0;
                      const pageRankPosition = scoreRankMap?.get(selectedUrl);
                      const inDegreePosition =
                        inDegreeRankMap?.get(selectedUrl);

                      return (
                        <div
                          style={{ marginTop: 10, display: "grid", gap: 10 }}
                        >
                          <div>
                            <div style={{ fontWeight: 600 }}>
                              {titleFor(selectedUrl, graph?.titles)}
                            </div>
                            <div
                              style={{
                                fontFamily: "monospace",
                                fontSize: 12,
                                opacity: 0.8,
                                wordBreak: "break-all",
                              }}
                            >
                              {selectedUrl}
                            </div>
                            <div style={{ marginTop: 6, opacity: 0.85 }}>
                              <strong>score:</strong> {score.toFixed(8)}
                            </div>
                            <div style={{ marginTop: 4, opacity: 0.85 }}>
                              <strong>comparación:</strong> PageRank{" "}
                              {pageRankPosition === undefined
                                ? "-"
                                : `#${pageRankPosition}`}{" "}
                              vs in-degree{" "}
                              {inDegreePosition === undefined
                                ? "-"
                                : `#${inDegreePosition}`}
                            </div>
                          </div>

                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr 1fr",
                              gap: 10,
                            }}
                          >
                            <div>
                              <div style={{ fontSize: 12, opacity: 0.7 }}>
                                in-degree
                              </div>
                              <div style={{ fontFamily: "monospace" }}>
                                {indeg}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: 12, opacity: 0.7 }}>
                                out-degree
                              </div>
                              <div style={{ fontFamily: "monospace" }}>
                                {outdeg}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: 12, opacity: 0.7 }}>
                                profundidad
                              </div>
                              <div style={{ fontFamily: "monospace" }}>
                                {depth === undefined || depth === Infinity
                                  ? "-"
                                  : depth}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontWeight: 600 }}>
                              Enlaces entrantes (top 20)
                            </div>
                            {inbound.length === 0 ? (
                              <div style={{ opacity: 0.75 }}>—</div>
                            ) : (
                              <ul style={{ margin: 0, paddingLeft: 18 }}>
                                {inbound.slice(0, 20).map((u) => (
                                  <li
                                    key={u}
                                    style={{
                                      marginBottom: 4,
                                      fontFamily: "monospace",
                                      fontSize: 12,
                                    }}
                                  >
                                    {u}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          <div style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontWeight: 600 }}>
                              Enlaces salientes (top 20)
                            </div>
                            {outbound.length === 0 ? (
                              <div style={{ opacity: 0.75 }}>—</div>
                            ) : (
                              <ul style={{ margin: 0, paddingLeft: 18 }}>
                                {outbound.slice(0, 20).map((u) => (
                                  <li
                                    key={u}
                                    style={{
                                      marginBottom: 4,
                                      fontFamily: "monospace",
                                      fontSize: 12,
                                    }}
                                  >
                                    {u}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      );
                    })()
                  )}
                </div>
              </div>
            ) : null}

            {rankResult ? (
              <div
                style={{
                  marginTop: 12,
                  border: "1px solid #eee",
                  borderRadius: 8,
                  padding: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <h4 style={{ margin: 0 }}>Convergencia</h4>
                  <div style={{ fontFamily: "monospace" }}>
                    iteraciones: {rankResult.iterations}
                  </div>
                  <div style={{ fontFamily: "monospace" }}>
                    estado: {rankResult.converged ? "convergió" : "max iter"}
                  </div>
                  <div style={{ fontFamily: "monospace" }}>
                    delta final:{" "}
                    {(
                      rankResult.history[rankResult.history.length - 1]
                        ?.delta ?? 0
                    ).toExponential(3)}
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 12,
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: 10,
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <h4 style={{ margin: 0 }}>
                        Animación paso a paso
                      </h4>
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 12,
                          opacity: 0.75,
                        }}
                      >
                        Los nodos del grafo se redimensionan con los scores de
                        cada iteración.
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        onClick={() => {
                          setAnimationPlaying(false);
                          setAnimationStep(0);
                        }}
                        disabled={animationStep === 0}
                      >
                        Reiniciar
                      </button>
                      <button
                        onClick={() => {
                          setAnimationPlaying(false);
                          setAnimationStep((step) => Math.max(0, step - 1));
                        }}
                        disabled={animationStep === 0}
                      >
                        Anterior
                      </button>
                      <button
                        onClick={() => {
                          if (animationStep >= animationMaxStep) {
                            setAnimationStep(0);
                            setAnimationPlaying(true);
                          } else {
                            setAnimationPlaying((value) => !value);
                          }
                        }}
                        disabled={animationMaxStep === 0}
                      >
                        {animationPlaying ? "Pausar" : "Reproducir"}
                      </button>
                      <button
                        onClick={() => {
                          setAnimationPlaying(false);
                          setAnimationStep((step) =>
                            Math.min(animationMaxStep, step + 1),
                          );
                        }}
                        disabled={animationStep >= animationMaxStep}
                      >
                        Siguiente
                      </button>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="range"
                      min={0}
                      max={animationMaxStep}
                      value={Math.min(animationStep, animationMaxStep)}
                      onChange={(e) => {
                        setAnimationPlaying(false);
                        setAnimationStep(Number(e.target.value));
                      }}
                      disabled={animationMaxStep === 0}
                      aria-label="Paso de iteración PageRank"
                    />
                    <div style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>
                      paso {Math.min(animationStep, animationMaxStep)} /{" "}
                      {animationMaxStep}
                    </div>
                    <label
                      style={{
                        display: "flex",
                        gap: 6,
                        alignItems: "center",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ opacity: 0.8 }}>Velocidad</span>
                      <select
                        value={animationSpeed}
                        onChange={(e) =>
                          setAnimationSpeed(Number(e.target.value))
                        }
                      >
                        <option value={1000}>Lenta</option>
                        <option value={650}>Media</option>
                        <option value={320}>Rápida</option>
                      </select>
                    </label>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 10,
                    }}
                  >
                    <div style={{ fontFamily: "monospace" }}>
                      delta paso:{" "}
                      {(animationEntry?.delta ?? 0).toExponential(3)}
                    </div>
                    <div style={{ fontFamily: "monospace" }}>
                      líder:{" "}
                      {animationTopRows[0]
                        ? `${shortPath(animationTopRows[0].url)} (${animationTopRows[0].score.toFixed(8)})`
                        : "-"}
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    {animationTopRows.map((row, index) => (
                      <div
                        key={row.url}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "42px 1fr auto",
                          gap: 8,
                          alignItems: "center",
                          fontSize: 12,
                        }}
                      >
                        <div style={{ fontFamily: "monospace" }}>
                          #{index + 1}
                        </div>
                        <div
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {shortPath(row.url)}
                        </div>
                        <div style={{ fontFamily: "monospace" }}>
                          {row.score.toFixed(8)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: 10, overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 13,
                    }}
                  >
                    <thead>
                      <tr>
                        <th
                          style={{
                            textAlign: "left",
                            borderBottom: "1px solid #eee",
                            padding: "6px 4px",
                          }}
                        >
                          paso
                        </th>
                        <th
                          style={{
                            textAlign: "left",
                            borderBottom: "1px solid #eee",
                            padding: "6px 4px",
                          }}
                        >
                          delta L1
                        </th>
                        <th
                          style={{
                            textAlign: "left",
                            borderBottom: "1px solid #eee",
                            padding: "6px 4px",
                          }}
                        >
                          score maximo
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankResult.history.slice(-12).map((entry) => {
                        const topScore = entry.scores.reduce(
                          (max, score) => Math.max(max, score),
                          0,
                        );
                        return (
                          <tr key={entry.iteration}>
                            <td
                              style={{
                                borderBottom: "1px solid #f3f3f3",
                                padding: "6px 4px",
                                fontFamily: "monospace",
                              }}
                            >
                              {entry.iteration}
                            </td>
                            <td
                              style={{
                                borderBottom: "1px solid #f3f3f3",
                                padding: "6px 4px",
                                fontFamily: "monospace",
                              }}
                            >
                              {entry.delta.toExponential(3)}
                            </td>
                            <td
                              style={{
                                borderBottom: "1px solid #f3f3f3",
                                padding: "6px 4px",
                                fontFamily: "monospace",
                              }}
                            >
                              {topScore.toFixed(8)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {scores ? (
              <div
                style={{
                  marginTop: 12,
                  border: "1px solid #eee",
                  borderRadius: 8,
                  padding: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <h4 style={{ margin: 0 }}>Visualización del grafo</h4>

                  <label
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    <span style={{ opacity: 0.8 }}>Vista</span>
                    <select
                      value={graphMode}
                      onChange={(e) => setGraphMode(e.target.value as any)}
                    >
                      <option value="overview">General</option>
                      <option value="focus">Foco (ego 1-hop)</option>
                    </select>
                  </label>

                  <label
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    <span style={{ opacity: 0.8 }}>Top N</span>
                    <select
                      value={graphTopK}
                      onChange={(e) =>
                        setGraphTopK(Number(e.target.value) as any)
                      }
                      disabled={graphMode === "focus"}
                    >
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={150}>150</option>
                    </select>
                  </label>

                  <label
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    <span style={{ opacity: 0.8 }}>Aristas</span>
                    <select
                      value={edgeDensity}
                      onChange={(e) => setEdgeDensity(e.target.value as any)}
                      disabled={graphMode === "focus"}
                    >
                      <option value="clean">Limpio</option>
                      <option value="balanced">Balanceado</option>
                      <option value="all">Todas</option>
                    </select>
                  </label>

                  <label
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    <span style={{ opacity: 0.8 }}>Color</span>
                    <select
                      value={nodeColorMode}
                      onChange={(e) =>
                        setNodeColorMode(e.target.value as any)
                      }
                    >
                      <option value="folder">Carpeta</option>
                      <option value="score">PageRank</option>
                    </select>
                  </label>

                  <div style={{ opacity: 0.75 }}>
                    nodos: {vizData?.nodeCount ?? 0} | aristas:{" "}
                    {vizData?.edgeCount ?? 0}
                    {graphMode === "focus" && selectedUrl
                      ? ` | centro: ${shortPath(selectedUrl)}`
                      : ""}
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 10,
                    display: "grid",
                    gridTemplateColumns: "1fr",
                    gap: 10,
                  }}
                >
                  <div
                    ref={cyContainerRef}
                    style={{
                      height: 520,
                      border: "1px solid #ddd",
                      borderRadius: 8,
                      overflow: "hidden",
                      background: "white",
                    }}
                  />
                  <div
                    style={{
                      display: "grid",
                      gap: 4,
                      opacity: 0.75,
                      fontSize: 12,
                    }}
                  >
                    <div>
                      Tip: rueda = zoom, arrastrar = pan, click en nodo =
                      seleccionar.
                    </div>
                    <div>
                      Lectura PageRank: nodos más grandes y más al centro tienen
                      mayor score; aristas entrantes fuertes elevan autoridad.
                    </div>
                    <div>
                      {nodeColorMode === "score"
                        ? "Relleno = PageRank (azul claro = score bajo, azul oscuro = score alto)."
                        : "Relleno = carpeta (primer segmento del path)."}{" "}
                      En la vista general solo se etiquetan los nodos más
                      relevantes.
                    </div>
                    {nodeColorMode === "folder" &&
                    vizData?.folderLegend.length ? (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "4px 12px",
                        }}
                      >
                        {vizData.folderLegend.map((f) => (
                          <span
                            key={f.cluster}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <span
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: "50%",
                                background: f.color,
                                display: "inline-block",
                                flexShrink: 0,
                              }}
                            />
                            {f.cluster} ({f.count})
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div>
                      Al seleccionar un nodo: borde naranja = le da autoridad
                      (enlace entrante), halo verde = lo enlaza (saliente),
                      borde negro = es el nodo seleccionado. Un nodo con
                      borde y halo a la vez tiene enlace mutuo con él.
                    </div>
                    <div>
                      Flechas: gris tenue = sin relación con el nodo
                      seleccionado, naranja gruesa = entra al seleccionado
                      (autoridad), verde = sale del seleccionado.
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
    </main>
  );
}
