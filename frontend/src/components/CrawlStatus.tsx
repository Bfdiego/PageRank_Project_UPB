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
    <div className="card">
      <h3 style={{ margin: "0 0 8px" }}>Estado</h3>

      {error ? <p style={{ margin: 0, color: "var(--danger)" }}>{error}</p> : null}

      {!status ? (
        <p className="muted" style={{ margin: 0 }}>Sin job activo.</p>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          <div>
            <strong>jobId:</strong> {status.jobId}
          </div>
          <div>
            <strong>estado:</strong>{" "}
            <span className={status.state === "error" ? "badge" : "pill"}>
              {STATE_LABELS[status.state]}
            </span>
          </div>
          <div>
            <strong>progreso:</strong> {status.visited}/{status.maxPages}
          </div>
          <div
            style={{
              width: "100%",
              height: 8,
              borderRadius: 4,
              background: "var(--border)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progressPct}%`,
                height: "100%",
                background: status.state === "error" ? "var(--danger)" : "var(--primary)",
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
            <div style={{ color: "var(--danger)" }}>
              <strong>error:</strong> {status.error}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
