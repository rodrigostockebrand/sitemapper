// API base for both local dev and deployed environments
// __PORT_5000__ is replaced by deploy_website with the proxy path
export const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export function screenshotUrl(jobId: string, pageId: string, thumb = false): string {
  const base = apiUrl(`/api/crawl/${jobId}/page/${pageId}/screenshot`);
  return thumb ? `${base}?thumb=1` : base;
}
