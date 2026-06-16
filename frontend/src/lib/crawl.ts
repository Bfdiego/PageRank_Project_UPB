import type { CrawlStatus } from "./api";

export function canLoadGraph(status: CrawlStatus | null): boolean {
  if (!status) return false;
  if (status.state === "done") return true;
  return status.state === "stopped" && status.visited > 0;
}
