import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import { API_URL } from "../services/runtimeConfig";
import { validCoordinates, type Coordinates } from "../services/location";
const apiBase = API_URL;
export function LocationMap({
  value,
  onChange,
  route,
}: {
  value?: Coordinates;
  onChange?: (point: Coordinates) => void;
  route?: [number, number][];
}) {
  const element = useRef<HTMLDivElement>(null),
    map = useRef<Leaflet.Map | null>(null),
    marker = useRef<Leaflet.Marker | null>(null),
    library = useRef<typeof Leaflet | null>(null),
    callback = useRef(onChange),
    point = useRef(value);
  callback.current = onChange;
  point.current = value;
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    void import("leaflet")
      .then((L) => {
        if (cancelled || !element.current) return;
        library.current = L;
        const initial = point.current;
        const instance = L.map(element.current, {
          scrollWheelZoom: false,
          keyboard: true,
        }).setView(
          validCoordinates(initial)
            ? [initial.latitude, initial.longitude]
            : [20.5937, 78.9629],
          validCoordinates(initial) ? 16 : 4,
        );
        map.current = instance;
        L.tileLayer(`${apiBase}/api/v1/locations/tiles/{z}/{x}/{y}`, {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://locationiq.com/attribution" target="_blank" rel="noreferrer">LocationIQ</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
        })
          .on("tileerror", () =>
            setError(
              "Map tiles could not load. You can still use device location, address search or pasted coordinates.",
            ),
          )
          .addTo(instance);
        instance.on("click", (event: Leaflet.LeafletMouseEvent) =>
          callback.current?.({
            latitude: event.latlng.lat,
            longitude: ((((event.latlng.lng + 180) % 360) + 360) % 360) - 180,
          }),
        );
        if (typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(() => instance.invalidateSize());
          observer.observe(element.current);
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "The map could not be loaded. Please reload or use address search.",
          );
      });
    return () => {
      cancelled = true;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);
  useEffect(() => {
    const L = library.current,
      instance = map.current;
    if (!ready || !L || !instance || !validCoordinates(value)) return;
    if (!marker.current) {
      marker.current = L.marker([value.latitude, value.longitude], {
        draggable: Boolean(onChange),
        keyboard: true,
        title: "Selected location. Drag to adjust.",
        icon: L.divIcon({
          className: "location-map-marker",
          html: '<span aria-hidden="true"></span>',
          iconSize: [28, 36],
          iconAnchor: [14, 34],
        }),
      }).addTo(instance);
      marker.current.on("dragend", () => {
        const selected = marker.current!.getLatLng();
        callback.current?.({
          latitude: selected.lat,
          longitude: ((((selected.lng + 180) % 360) + 360) % 360) - 180,
        });
      });
    }
    marker.current.setLatLng([value.latitude, value.longitude]);
    instance.setView(
      [value.latitude, value.longitude],
      Math.max(instance.getZoom(), 16),
    );
  }, [ready, value?.latitude, value?.longitude, Boolean(onChange)]);
  useEffect(() => {
    const L = library.current,
      instance = map.current;
    if (!L || !instance || !ready || !route?.length) return;
    const line = L.polyline(
      route.map(([lng, lat]) => [lat, lng] as [number, number]),
      { color: "#2563eb", weight: 5 },
    ).addTo(instance);
    instance.fitBounds(line.getBounds(), { padding: [24, 24] });
    return () => {
      line.remove();
    };
  }, [ready, route]);
  return (
    <div className="location-map-wrap">
      <div
        ref={element}
        className="location-map"
        aria-label={
          onChange
            ? "Location map. Click to place a pin or drag the marker."
            : "Selected location map"
        }
      />
      {onChange && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!ready}
          onClick={() => {
            const center = map.current!.getCenter();
            onChange({
              latitude: center.lat,
              longitude: ((((center.lng + 180) % 360) + 360) % 360) - 180,
            });
          }}
        >
          Use map centre
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
