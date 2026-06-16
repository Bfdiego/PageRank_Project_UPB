import assert from "node:assert/strict";
import test from "node:test";
import { computeDepths, resolveGraphStartUrl } from "./graph.js";

test("uses the backend canonical start URL for depth zero", () => {
  const startUrl = resolveGraphStartUrl({ startUrl: "https://example.com/" }, "https://example.com", true);
  const depths = computeDepths(
    startUrl,
    ["https://example.com/", "https://example.com/about"],
    [{ source: "https://example.com/", target: "https://example.com/about" }]
  );

  assert.equal(depths.get("https://example.com/"), 0);
  assert.equal(depths.get("https://example.com/about"), 1);
});

test("falls back to frontend canonicalization when old results do not include startUrl", () => {
  assert.equal(resolveGraphStartUrl({}, "https://example.com", true), "https://example.com/");
});
