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
    <div style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
      <h3 style={{ margin: "0 0 8px" }}>Crawl</h3>
      <p style={{ margin: "0 0 10px", fontSize: 12, opacity: 0.7 }}>
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
        <button onClick={onCrawl} disabled={running}>
          Iniciar crawl
        </button>
        <button onClick={onStop} disabled={!running}>
          Detener
        </button>
      </div>
    </div>
  );
}
