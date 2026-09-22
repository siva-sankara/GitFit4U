import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";

export type LocationResult = {
  placeId: string;
  displayName: string;
  latitude: number;
  longitude: number;
  address: {
    line1: string;
    locality: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
};
export function normalizeLocation(data: any): LocationResult {
  const latitude = Number(data.lat),
    longitude = Number(data.lon);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    throw new AppError(
      502,
      "LOCATION_INVALID_RESPONSE",
      "LocationIQ returned an invalid location.",
    );
  const a = data.address || {};
  return {
    placeId: String(data.place_id || `${latitude},${longitude}`),
    displayName: String(data.display_name || "Selected location"),
    latitude,
    longitude,
    address: {
      line1: [a.house_number, a.road || a.pedestrian || a.residential || a.name]
        .filter(Boolean)
        .join(" "),
      locality: a.suburb || a.neighbourhood || a.quarter || "",
      city:
        a.city ||
        a.town ||
        a.village ||
        a.municipality ||
        a.city_district ||
        a.county ||
        "",
      state: a.state || "",
      postalCode: a.postcode || "",
      country: String(a.country_code || "").toUpperCase(),
    },
  };
}
export function mapsConfigured() {
  return Boolean(env.LOCATIONIQ_API_KEY?.trim());
}
async function fetchLocationIq(url: URL) {
  if (!mapsConfigured())
    throw new AppError(
      503,
      "LOCATIONIQ_NOT_CONFIGURED",
      "Address search and map tiles are unavailable until LocationIQ is configured. You can still use device coordinates.",
    );
  url.searchParams.set("key", env.LOCATIONIQ_API_KEY!.trim());
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch {
    throw new AppError(
      502,
      "LOCATIONIQ_UNAVAILABLE",
      "LocationIQ could not be reached. Please try again.",
    );
  }
  if (response.status === 429)
    throw new AppError(
      429,
      "LOCATIONIQ_RATE_LIMITED",
      "Location searches are temporarily limited. Please try again shortly.",
    );
  if ([401, 403].includes(response.status))
    throw new AppError(
      503,
      "LOCATIONIQ_ACCESS_DENIED",
      "LocationIQ access is not configured correctly. Contact support.",
    );
  if (!response.ok && response.status !== 404)
    throw new AppError(
      502,
      "LOCATIONIQ_UNAVAILABLE",
      "LocationIQ could not complete this request.",
    );
  return response;
}
async function json(
  path: string,
  params: Record<string, string>,
  autocomplete = false,
) {
  const url = new URL(
    `https://${autocomplete ? "api" : env.LOCATIONIQ_REGION}.locationiq.com/v1/${path}`,
  );
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  const response = await fetchLocationIq(url);
  if (response.status === 404) return null;
  try {
    return await response.json();
  } catch {
    throw new AppError(
      502,
      "LOCATIONIQ_INVALID_RESPONSE",
      "LocationIQ returned an unreadable response.",
    );
  }
}
export const locationIqProvider = {
  async autocomplete(q: string) {
    const results = await json(
      "autocomplete",
      { q, limit: "5", "accept-language": "en", normalizecity: "1" },
      true,
    );
    if (results === null) return [];
    if (!Array.isArray(results))
      throw new AppError(
        502,
        "LOCATIONIQ_INVALID_RESPONSE",
        "Address suggestions are unavailable.",
      );
    return results.map(normalizeLocation);
  },
  async geocode(address: string) {
    const results = await json("search", {
      q: address,
      format: "json",
      addressdetails: "1",
      normalizecity: "1",
      limit: "5",
    });
    if (results === null) return [];
    if (!Array.isArray(results))
      throw new AppError(
        502,
        "LOCATIONIQ_INVALID_RESPONSE",
        "Address search is unavailable.",
      );
    return results.map(normalizeLocation);
  },
  async reverseGeocode(latitude: number, longitude: number) {
    const result = await json("reverse", {
      lat: String(latitude),
      lon: String(longitude),
      format: "json",
      addressdetails: "1",
      normalizecity: "1",
    });
    if (!result)
      throw new AppError(
        404,
        "LOCATION_NOT_FOUND",
        "No street address was found here. The selected coordinates are still available.",
      );
    return normalizeLocation(result);
  },
  async directions(origin: string, destination: string, mode = "driving") {
    if (!["driving", "walking"].includes(mode))
      throw new AppError(
        422,
        "ROUTE_MODE_UNSUPPORTED",
        "Choose driving or walking for LocationIQ directions.",
      );
    async function point(value: string) {
      const pair = value.split(",").map((v) => Number(v.trim()));
      if (
        pair.length === 2 &&
        value.split(",").every((v) => v.trim()) &&
        pair.every(Number.isFinite) &&
        Math.abs(pair[0]) <= 90 &&
        Math.abs(pair[1]) <= 180
      )
        return [pair[1], pair[0]];
      const matches = await locationIqProvider.geocode(value);
      if (!matches[0])
        throw new AppError(
          404,
          "LOCATION_NOT_FOUND",
          "A route address could not be found.",
        );
      return [matches[0].longitude, matches[0].latitude];
    }
    const start = await point(origin),
      end = await point(destination);
    const result = await json(
      `directions/${mode}/${start.join(",")};${end.join(",")}`,
      { geometries: "geojson", overview: "full", steps: "true" },
    );
    if (!result || result.code !== "Ok" || !result.routes?.length)
      throw new AppError(
        404,
        "ROUTE_NOT_FOUND",
        "No route was found between these locations.",
      );
    return { provider: "LOCATIONIQ", ...result };
  },
  async tile(z: number, x: number, y: number) {
    const response = await fetchLocationIq(
      new URL(`https://a-tiles.locationiq.com/v2/obk/r/${z}/${x}/${y}.png`),
    );
    if (response.status === 404)
      throw new AppError(404, "TILE_NOT_FOUND", "Map tile not found.");
    if (!response.headers.get("content-type")?.includes("image/"))
      throw new AppError(
        502,
        "LOCATIONIQ_INVALID_TILE",
        "Map tiles are unavailable.",
      );
    return Buffer.from(await response.arrayBuffer());
  },
};
