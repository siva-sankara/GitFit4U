// VITE_API_URL is the existing GETFIT4U name. VITE_API_BASE_URL remains a
// supported deployment alias so an older Vercel setting cannot be ignored.
export const API_URL = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  ""
).replace(/\/$/, "");

