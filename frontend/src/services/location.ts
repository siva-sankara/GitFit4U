import { apiRequest, type ApiEnvelope } from "./apiClient";
export type Coordinates = { latitude: number; longitude: number };
export type LocatedPoint = Coordinates & {
  displayName?: string;
  address?: Record<string, string>;
  accuracyMeters?: number;
};
export type LocationResult = LocatedPoint & {
  placeId: string;
  displayName: string;
};
export function validCoordinates(
  value: Partial<Coordinates> | undefined,
): value is Coordinates {
  return (
    typeof value?.latitude === "number" &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    Math.abs(value.latitude) <= 90 &&
    Math.abs(value.longitude) <= 180
  );
}
export function deviceLocation(): Promise<
  LocatedPoint & { accuracyMeters: number; capturedAt: string }
> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(
        new Error(
          "Location is unavailable in this browser. Search for an address or select a map pin.",
        ),
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString(),
        }),
      (error) =>
        reject(
          new Error(
            error.code === 1
              ? "Location permission was denied. Allow location access or search for an address."
              : error.code === 3
                ? "Getting your location timed out. Try again outdoors or select the gym on the map."
                : "Your device could not determine its location. Search for an address instead.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}
export const searchLocations = (query: string) =>
  apiRequest<ApiEnvelope<LocationResult[]>>(
    `/api/v1/locations/autocomplete?q=${encodeURIComponent(query)}`,
  );
export const addressLocations = (address: string) =>
  apiRequest<ApiEnvelope<LocationResult[]>>("/api/v1/locations/geocode", {
    method: "POST",
    body: JSON.stringify({ address }),
  });
export const reverseLocation = (point: Coordinates) =>
  apiRequest<ApiEnvelope<LocationResult>>("/api/v1/locations/reverse-geocode", {
    method: "POST",
    body: JSON.stringify({
      latitude: point.latitude,
      longitude: point.longitude,
    }),
  });
export function googleMapsPin(point: Coordinates) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.latitude},${point.longitude}`)}`;
}
export function parseCoordinates(text: string): Coordinates | null {
  const match = text
    .trim()
    .match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const point = { latitude: Number(match[1]), longitude: Number(match[2]) };
  return validCoordinates(point) ? point : null;
}
