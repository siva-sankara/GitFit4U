import { apiBaseUrl } from "./apiBaseUrl";

// The browser and build-time headers must agree on the effective API origin.
export const API_URL = import.meta.env.DEV ? "" : apiBaseUrl(
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "",
  true,
);
