export function normalizeUrlInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
}

export function canonicalizeUrl(input: string, ignoreQueryParams: boolean): string {
  const normalized = normalizeUrlInput(input);
  if (!normalized) return "";

  try {
    const url = new URL(normalized);
    const scheme = url.protocol.replace(":", "").toLowerCase();
    if (scheme !== "http" && scheme !== "https") return "";

    const host = url.hostname.toLowerCase();
    if (!host) return "";

    const defaultPort = (scheme === "http" && url.port === "80") || (scheme === "https" && url.port === "443");
    const netloc = url.port && !defaultPort ? `${host}:${url.port}` : host;

    let path = url.pathname || "/";
    if (path !== "/" && path.endsWith("/")) path = path.slice(0, -1);

    const query = ignoreQueryParams ? "" : url.search;
    return `${scheme}://${netloc}${path}${query}`;
  } catch {
    return "";
  }
}
