import assert from "node:assert/strict";
import test from "node:test";
import { pageRank } from "./pagerank.js";

function scoreSum(scores: Float64Array): number {
  return Array.from(scores).reduce((acc, value) => acc + value, 0);
}

function assertClose(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

test("keeps PageRank scores normalized and favors linked pages", () => {
  const result = pageRank(
    ["https://example.com/a", "https://example.com/b"],
    [{ source: "https://example.com/a", target: "https://example.com/b" }],
    { d: 0.85, maxIter: 100, tol: 1e-12 }
  );

  assertClose(scoreSum(result.scores), 1, 1e-10);
  assert.ok(result.scores[1] > result.scores[0]);
});

test("matches a published four-node PageRank reference", () => {
  // BYU ACME Lab 1, Figure 1.1 / Problem 2, epsilon = 0.85.
  const result = pageRank(
    ["a", "b", "c", "d"],
    [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
      { source: "a", target: "d" },
      { source: "c", target: "b" },
      { source: "c", target: "d" },
      { source: "d", target: "c" },
    ],
    { d: 0.85, maxIter: 1000, tol: 1e-15 }
  );

  assert.equal(result.converged, true);
  assertClose(result.scores[0], 0.095758635, 1e-9);
  assertClose(result.scores[1], 0.274158285, 1e-9);
  assertClose(result.scores[2], 0.355924792, 1e-9);
  assertClose(result.scores[3], 0.274158285, 1e-9);
  assertClose(scoreSum(result.scores), 1, 1e-12);
});

test("keeps scores normalized when the graph has a dangling node", () => {
  const result = pageRank(
    ["a", "b", "c"],
    [{ source: "a", target: "b" }],
    { d: 0.85, maxIter: 1000, tol: 1e-15 }
  );

  assert.equal(result.converged, true);
  assertClose(scoreSum(result.scores), 1, 1e-12);
});

test("ignores duplicate and self-loop edges", () => {
  const result = pageRank(
    ["a", "b"],
    [
      { source: "a", target: "a" },
      { source: "a", target: "b" },
      { source: "a", target: "b" },
    ],
    { d: 0.85, maxIter: 100, tol: 1e-12 }
  );

  assert.ok(result.scores[1] > result.scores[0]);
});

test("returns iterations, convergence state, and per-step history", () => {
  const result = pageRank(
    ["a", "b", "c"],
    [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "c", target: "a" },
    ],
    { d: 0.85, maxIter: 50, tol: 1e-12 }
  );

  assert.equal(result.converged, true);
  assert.ok(result.iterations > 0);
  assert.equal(result.history.length, result.iterations + 1);
  assert.deepEqual(result.history[0], {
    iteration: 0,
    delta: 0,
    scores: [1 / 3, 1 / 3, 1 / 3],
  });

  const finalEntry = result.history[result.history.length - 1];
  assert.equal(finalEntry.iteration, result.iterations);
  assert.deepEqual(finalEntry.scores, Array.from(result.scores));
  assert.ok(finalEntry.delta < 1e-12);
});

test("reports non-convergence when max iterations are exhausted", () => {
  const result = pageRank(
    ["a", "b", "c"],
    [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "c", target: "a" },
    ],
    { d: 0.85, maxIter: 0, tol: 1e-12 }
  );

  assert.equal(result.converged, false);
  assert.equal(result.iterations, 0);
  assert.equal(result.history.length, 1);
});
