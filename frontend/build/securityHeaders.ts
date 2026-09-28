type PublicConfiguration = {
  VITE_API_URL?: string;
  VITE_MEDIA_ORIGINS?: string;
};
function origin(value: string) {
  if (/[;\s'"<>]/.test(value))
    throw new Error("CSP origin contains unsupported characters.");
  const parsed = new URL(value);
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(
      "CSP origins must be HTTP(S) URLs without credentials, query strings or fragments.",
    );
  return parsed.origin;
}

export function securityHeaders(config: PublicConfiguration = {}) {
  const api = config.VITE_API_URL?.trim()
    ? origin(config.VITE_API_URL.trim())
    : "";
  const socket = api ? api.replace(/^http/, "ws") : "";
  // Exact custom S3/CloudFront origins can replace these provider-scoped defaults.
  // Only public origins are consumed; no AWS/Firebase server credential is read.
  const media = config.VITE_MEDIA_ORIGINS?.trim()
    ? config.VITE_MEDIA_ORIGINS.split(/[\s,]+/)
        .filter(Boolean)
        .map(origin)
    : ["https://*.amazonaws.com", "https://*.cloudfront.net"];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "https://checkout.razorpay.com",
      "https://accounts.google.com/gsi/client",
    ],
    "style-src": [
      "'self'",
      "'unsafe-inline'",
      "https://accounts.google.com/gsi/style",
    ],
    "connect-src": [
      "'self'",
      api,
      socket,
      "https://*.razorpay.com",
      "https://accounts.google.com/gsi/",
      "https://firebaseinstallations.googleapis.com",
      "https://fcmregistrations.googleapis.com",
      "https://fcm.googleapis.com",
    ],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      api,
      ...media,
      "https://*.googleusercontent.com",
      "https://res.cloudinary.com",
      "https://api.cloudinary.com",
      "https://*.razorpay.com",
    ],
    "media-src": [
      "'self'",
      "blob:",
      ...media,
      "https://res.cloudinary.com",
      "https://api.cloudinary.com",
    ],
    "frame-src": ["https://*.razorpay.com", "https://accounts.google.com/gsi/"],
    "font-src": ["'self'", "data:"],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", "https://*.razorpay.com"],
  };
  const policy = Object.entries(directives)
    .map(
      ([name, values]) =>
        `${name} ${[...new Set(values.filter(Boolean))].join(" ")}`,
    )
    .join("; ");
  return `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(self), geolocation=(self), microphone=()\n  X-Frame-Options: DENY\n  Cross-Origin-Opener-Policy: same-origin-allow-popups\n  Content-Security-Policy: ${policy}\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/sw.js\n  Cache-Control: no-cache\n`;
}
