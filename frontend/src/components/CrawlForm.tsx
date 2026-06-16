type Props = {
  url: string;
  setUrl: (v: string) => void;
  onCrawl: () => void;
  onStop: () => void;
  running: boolean;
};

export default function CrawlForm({
  url,
  setUrl,
  onCrawl,
  onStop,
  running,
}: Props) {
  return (
    <div className="card">
      <h3 style={{ margin: "0 0 8px" }}>Crawl</h3>
      <p className="muted" style={{ margin: "0 0 10px" }}>
        URL inicial desde donde se construirá el grafo de enlaces.
      </p>

      <label style={{ display: "grid", gap: 6 }}>
        <span>URL</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://dominio.com/algo"
          style={{ padding: 8 }}
          disabled={running}
        />
      </label>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn-primary" onClick={onCrawl} disabled={running}>
          Iniciar crawl
        </button>
        <button onClick={onStop} disabled={!running}>
          Detener
        </button>
      </div>
    </div>
  );
}
