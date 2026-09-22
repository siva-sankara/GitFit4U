// Legacy Google Maps implementation retained for reference only. LocationIQ is active.
// import { env } from "../../config/env.js";
// import { AppError } from "../../utils/AppError.js";
// 
// async function call(path: string, params: Record<string, string>) {
//   if (!env.GOOGLE_MAPS_API_KEY) throw new AppError(503, "MAPS_NOT_CONFIGURED", "Maps are not configured.");
//   const query = new URLSearchParams({ ...params, key: env.GOOGLE_MAPS_API_KEY });
//   const response = await fetch(`https://maps.googleapis.com/maps/api/${path}?${query}`);
//   if (!response.ok) throw new AppError(502, "MAPS_PROVIDER_ERROR", "The maps provider is unavailable.");
//   const data = await response.json() as any;
//   if (data.status && !["OK", "ZERO_RESULTS"].includes(data.status)) throw new AppError(502, "MAPS_PROVIDER_ERROR", data.error_message || "The maps request failed.");
//   return data;
// }
// 
// export const googleMapsProvider = {
//   autocomplete: (input: string, sessiontoken?: string) => call("place/autocomplete/json", { input, components: "country:in", ...(sessiontoken ? { sessiontoken } : {}) }),
//   geocode: (address: string) => call("geocode/json", { address }),
//   reverseGeocode: (lat: number, lng: number) => call("geocode/json", { latlng: `${lat},${lng}` }),
//   directions: (origin: string, destination: string, mode = "driving") => call("directions/json", { origin, destination, mode })
// };
// 
export {};
