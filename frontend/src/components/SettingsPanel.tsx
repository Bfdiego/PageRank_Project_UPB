type Props = {
  maxPages: number;
  setMaxPages: (v: number) => void;
  maxDepth: number;
  setMaxDepth: (v: number) => void;
  disabled?: boolean;
};

export default function SettingsPanel({
  maxPages,
  setMaxPages,
  maxDepth,
  setMaxDepth,
  disabled = false,
}: Props) {
  return (
    <div className="card">
      <h3 style={{ margin: "0 0 8px" }}>Parámetros de crawl</h3>

      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>páginas máximas</span>
          <input
            type="number"
            min={1}
            max={20000}
            value={maxPages}
            disabled={disabled}
            onChange={(e) => setMaxPages(Number(e.target.value))}
          />
          <span className="muted">
            Limita cuántas páginas puede visitar el crawler.
          </span>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>profundidad máxima</span>
          <input
            type="number"
            min={0}
            max={50}
            value={maxDepth}
            disabled={disabled}
            onChange={(e) => setMaxDepth(Number(e.target.value))}
          />
          <span className="muted">
            Define cuantos saltos de enlaces se siguen desde la URL inicial.
          </span>
        </label>
      </div>
    </div>
  );
}
