const LOCAL_HOST = /^(localhost|127\.0\.0\.1|10\.(\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

/** Alamat Worker saat IP laptop berubah antara build dan waktu demo. */
export function resolveApiBaseUrl(configuredUrl: string | undefined, browserOrigin?: string): string {
  let configuredHost = "";
  if (configuredUrl) {
    try { configuredHost = new URL(configuredUrl).hostname; } catch { /* Gunakan alamat saat ini. */ }
  }

  if (browserOrigin) {
    const current = new URL(browserOrigin);
    if (LOCAL_HOST.test(current.hostname) && (!configuredUrl || LOCAL_HOST.test(configuredHost))) {
      return `${current.protocol}//${current.hostname}:8787`;
    }
    if (!configuredUrl) return `${current.protocol}//${current.hostname}:8787`;
  }

  if (LOCAL_HOST.test(configuredHost)) return "http://127.0.0.1:8787";
  return configuredUrl ?? "http://127.0.0.1:8787";
}
