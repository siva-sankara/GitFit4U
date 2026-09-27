import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, type ApiEnvelope } from "../services/apiClient";
import {
  deviceLocation,
  googleMapsPin,
  validCoordinates,
  type Coordinates,
} from "../services/location";
import { LocationMap } from "./LocationMap";
type Route = {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
  legs: Array<{
    steps: Array<{
      name: string;
      maneuver: { instruction?: string; type: string; modifier?: string };
      distance: number;
    }>;
  }>;
};
export function GymLocation({ point }: { point: Coordinates }) {
  const [mode, setMode] = useState("driving");
  const config = useQuery({
    queryKey: ["location-config"],
    queryFn: () =>
      apiRequest<ApiEnvelope<{ configured: boolean }>>(
        "/api/v1/locations/config",
      ),
    staleTime: 60000,
    retry: false,
  });
  const directions = useMutation({
    mutationFn: async () => {
      const start = await deviceLocation();
      return apiRequest<ApiEnvelope<{ routes: Route[] }>>(
        "/api/v1/locations/directions",
        {
          method: "POST",
          body: JSON.stringify({
            origin: `${start.latitude},${start.longitude}`,
            destination: `${point.latitude},${point.longitude}`,
            mode,
          }),
        },
      );
    },
  });
  if (!validCoordinates(point)) return null;
  const route = directions.data?.data.routes[0];
  return (
    <section className="panel form-section location-picker">
      <h2>Gym location</h2>
      {config.data?.data.configured && (
        <LocationMap value={point} route={route?.geometry.coordinates} />
      )}
      <details>
        <summary>Entrance coordinates</summary>
        <p>
          {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}
        </p>
      </details>
      <div className="heading-actions gym-map-actions">
        <select
          className="select"
          aria-label="Travel mode"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            directions.reset();
          }}
        >
          <option value="driving">Driving</option>
          <option value="walking">Walking</option>
        </select>
        <button
          className="btn btn-secondary"
          disabled={!config.data?.data.configured || directions.isPending}
          onClick={() => directions.mutate()}
        >
          {directions.isPending
            ? "Finding route…"
            : "Get route from my location"}
        </button>
        <a
          className="btn btn-secondary"
          href={googleMapsPin(point)}
          target="_blank"
          rel="noreferrer"
        >
          Open Google Maps
        </a>
      </div>
      {config.isError && (
        <p role="alert">
          {config.error.message}{" "}
          <button onClick={() => config.refetch()}>Retry map</button>
        </p>
      )}
      {config.isSuccess && !config.data.data.configured && (
        <p>Open the entrance pin in Google Maps to plan your visit.</p>
      )}
      {directions.isError && <p role="alert">{directions.error.message}</p>}
      {route && (
        <>
          <p>
            <strong>
              {(route.distance / 1000).toFixed(1)} km · about{" "}
              {Math.max(1, Math.round(route.duration / 60))} minutes
            </strong>
          </p>
          <ol>
            {route.legs
              .flatMap((leg) => leg.steps)
              .map((step, index) => (
                <li key={index}>
                  {step.maneuver.instruction ||
                    `${step.maneuver.type.replace(/_/g, " ")} ${step.maneuver.modifier || ""}${step.name ? ` onto ${step.name}` : ""}`}{" "}
                  — {Math.round(step.distance)} m
                </li>
              ))}
          </ol>
        </>
      )}
    </section>
  );
}
