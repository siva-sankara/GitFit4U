import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, type ApiEnvelope } from "../services/apiClient";
import { LocationMap } from "./LocationMap";
import {
  deviceLocation,
  searchLocations,
  addressLocations,
  reverseLocation,
  googleMapsPin,
  parseCoordinates,
  validCoordinates,
  type LocatedPoint,
  type LocationResult,
} from "../services/location";
export function LocationPicker({
  value,
  onChange,
  addressQuery = "",
  title = "Choose location",
  onBusyChange,
}: {
  value?: LocatedPoint;
  onChange: (point: LocatedPoint) => void;
  addressQuery?: string;
  title?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<LocationResult[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [searched, setSearched] = useState(false),
    [pasted, setPasted] = useState(""),
    [description, setDescription] = useState(""),
    [accuracy, setAccuracy] = useState<number | undefined>();
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  const requestId = useRef(0);
  useEffect(
    () => () => {
      requestId.current++;
    },
    [],
  );
  const config = useQuery({
    queryKey: ["location-config"],
    queryFn: () =>
      apiRequest<ApiEnvelope<{ configured: boolean; provider: string }>>(
        "/api/v1/locations/config",
      ),
    staleTime: 60000,
    retry: false,
  });
  const available = config.data?.data.configured === true;
  async function search(address = false) {
    const text = (address ? addressQuery : query).trim();
    if (text.length < 3) {
      setError("Enter at least three characters of an address.");
      return;
    }
    const id = ++requestId.current;
    setBusy(true);
    setError("");
    setResults([]);
    setSearched(false);
    try {
      const response = await (address
        ? addressLocations(text)
        : searchLocations(text));
      if (id !== requestId.current) return;
      setResults(response.data);
      setSearched(true);
    } catch (e) {
      if (id === requestId.current) setError((e as Error).message);
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }
  async function locate(point: LocatedPoint) {
    const id = ++requestId.current;
    setError("");
    setResults([]);
    setSearched(false);
    setDescription("");
    setAccuracy(point.accuracyMeters);
    onChange(point);
    if (!available) {
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const result = await reverseLocation(point);
      if (id !== requestId.current) return;
      setDescription(result.data.displayName);
      onChange({
        ...point,
        address: result.data.address,
        displayName: result.data.displayName,
      });
    } catch (e) {
      if (id === requestId.current)
        setError(
          (e as Error).message +
            " Your chosen pin is retained; check the address fields.",
        );
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }
  async function current() {
    const id = ++requestId.current;
    setBusy(true);
    setError("");
    try {
      const point = await deviceLocation();
      if (id === requestId.current) await locate(point);
    } catch (e) {
      if (id === requestId.current) {
        setError((e as Error).message);
        setBusy(false);
      }
    }
  }
  return (
    <section className="location-picker" aria-label={title}>
      <h3>{title}</h3>
      <p>
        Find the area first, then adjust the pin to the entrance. Your address
        and coordinates will be filled from your selection.
      </p>
      <div className="location-methods">
        <div className="location-method-card">
          <strong>At the gym right now?</strong>
          <p>Use your device location as a starting point.</p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void current()}
          >
            Use my current location
          </button>
        </div>
        <div className="location-method-card">
          <strong>Find an address</strong>
          <p>Search by street, nearby landmark, city or postal code.</p>
          <div className="location-search">
            <input
              className="input"
              aria-label="Search location address"
              placeholder="Street, landmark, city or postcode"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void search();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!available || busy}
              onClick={() => void search()}
            >
              Search address
            </button>
            {addressQuery.trim() && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!available || busy}
                onClick={() => void search(true)}
              >
                Locate entered address
              </button>
            )}
          </div>
        </div>
      </div>
      {config.isPending && <p role="status">Loading location service…</p>}
      {config.isError && (
        <p role="alert">
          {config.error.message}{" "}
          <button type="button" onClick={() => config.refetch()}>
            Retry
          </button>
        </p>
      )}
      {config.isSuccess && !available && (
        <p role="status">
          Address search is currently unavailable. Use your device location or
          choose a point from Google Maps below.
        </p>
      )}
      {busy && <p role="status">Finding location…</p>}
      {error && <p role="alert">{error}</p>}
      {results.length > 0 && (
        <ul className="location-results" aria-label="Address results">
          {results.map((result, index) => (
            <li key={`${result.placeId}-${index}`}>
              <button
                type="button"
                onClick={() => {
                  requestId.current++;
                  setBusy(false);
                  setResults([]);
                  setSearched(false);
                  setDescription(result.displayName);
                  setAccuracy(undefined);
                  onChange(result);
                }}
              >
                {result.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
      {searched && !results.length && (
        <p>No address found. Try a nearby street or select a pin.</p>
      )}
      {available && (
        <div className="location-map-stage">
          <h4>Fine-tune your pin</h4>
          <p>Click the map or drag the marker to the gym entrance.</p>
          <LocationMap value={value} onChange={(point) => void locate(point)} />
        </div>
      )}
      {validCoordinates(value) && (
        <div className="location-selection">
          <p>
            <strong>Selected coordinates:</strong>{" "}
            <output aria-label="Selected latitude">
              {value.latitude.toFixed(6)}
            </output>
            ,{" "}
            <output aria-label="Selected longitude">
              {value.longitude.toFixed(6)}
            </output>
          </p>
          {description && <p>{description}</p>}
          {accuracy != null && (
            <p>
              Device accuracy: approximately ±{Math.round(accuracy)} metres.
              Adjust the pin if needed.
            </p>
          )}
          <a href={googleMapsPin(value)} target="_blank" rel="noreferrer">
            View this pin in Google Maps
          </a>
        </div>
      )}
      <details>
        <summary>Use a point from Google Maps or enter coordinates</summary>
        <p>
          In Google Maps, select the gym entrance and copy its latitude and
          longitude. Paste them below in that order.
        </p>
        <a
          href={
            validCoordinates(value)
              ? googleMapsPin(value)
              : "https://www.google.com/maps"
          }
          target="_blank"
          rel="noreferrer"
        >
          Open Google Maps
        </a>
        <div className="location-search">
          <input
            className="input"
            aria-label="Paste latitude and longitude"
            placeholder="Latitude, longitude"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const point = parseCoordinates(pasted);
              if (!point) {
                setError(
                  "Enter valid latitude, longitude (for example, 17.385, 78.487).",
                );
                return;
              }
              void locate(point);
            }}
          >
            Use these coordinates
          </button>
        </div>
      </details>
      <small>
        Address search and maps by{" "}
        <a
          href="https://locationiq.com/attribution"
          target="_blank"
          rel="noreferrer"
        >
          LocationIQ
        </a>
        . Device and map locations may be approximate.
      </small>
    </section>
  );
}
