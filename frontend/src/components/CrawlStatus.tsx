import type { CrawlStatus } from "../lib/api";

type Props = {
  status: CrawlStatus | null;
  error: string | null;
};

const STATE_LABELS: Record<CrawlStatus["state"], string> = {
  idle: "inactivo",
  running: "en ejecución",
  done: "terminado",
  error: "error",
  stopped: "detenido",
};

export default function CrawlStatusCard({ status, error }: Props) {
  const progressPct = status && status.maxPages > 0
    ? Math.min(100, Math.round((status.visited / status.maxPages) * 100))
    : 0;

  return (
    <div style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
      <h3 style={{ margin: "0 0 8px" }}>Estado</h3>

      {error ? <p style={{ margin: 0, color: "crimson" }}>{error}</p> : null}

      {!status ? (
        <p style={{ margin: 0, opacity: 0.75 }}>Sin job activo.</p>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          <div>
            <strong>jobId:</strong> {status.jobId}
          </div>
          <div>
            <strong>estado:</strong> {STATE_LABELS[status.state]}
          </div>
          <div>
            <strong>progreso:</strong> {status.visited}/{status.maxPages}
          </div>
          <div
            style={{
              width: "100%",
              height: 8,
              borderRadius: 4,
              background: "#eee",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progressPct}%`,
                height: "100%",
                background: status.state === "error" ? "crimson" : "#3b82f6",
                transition: "width 200ms ease",
              }}
            />
          </div>
          {status.state === "running" && status.currentUrl ? (
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <strong>visitando:</strong> {status.currentUrl}
            </div>
          ) : null}
          {status.state === "running" ? (
            <div>
              <strong>en cola:</strong> {status.queueSize ?? 0}
            </div>
          ) : null}
          <div>
            <strong>tiempo:</strong> {status.elapsedSeconds}s
          </div>
          {status.error ? (
            <div style={{ color: "crimson" }}>
              <strong>error:</strong> {status.error}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
