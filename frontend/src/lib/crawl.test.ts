import assert from "node:assert/strict";
import test from "node:test";
import { canLoadGraph } from "./crawl.js";
import type { CrawlStatus } from "./api.js";

function status(state: CrawlStatus["state"], visited = 0): CrawlStatus {
  return {
    jobId: "job",
    state,
    visited,
    maxPages: 10,
    elapsedSeconds: 0,
    error: null,
  };
}

test("enables Load Graph when the crawl is done or stopped with partial data", () => {
  assert.equal(canLoadGraph(null), false);
  assert.equal(canLoadGraph(status("running")), false);
  assert.equal(canLoadGraph(status("stopped")), false);
  assert.equal(canLoadGraph(status("stopped", 3)), true);
  assert.equal(canLoadGraph(status("error")), false);
  assert.equal(canLoadGraph(status("done")), true);
});
