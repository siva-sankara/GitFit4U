export function normalizeClientOrigins(value: string): string {
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) throw new Error("CLIENT_ORIGIN must contain at least one frontend origin.");

  const origins = entries.map((entry) => {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error("CLIENT_ORIGIN must contain comma-separated HTTP(S) frontend origins.");
    }
    if (
      !["https:", "http:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash || url.hostname.includes("*")
    ) {
      throw new Error("CLIENT_ORIGIN entries must be HTTP(S) origins without paths, credentials, query strings, fragments, or wildcards.");
    }
    return url.origin;
  });

  return [...new Set(origins)].join(",");
}
