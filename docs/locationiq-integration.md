# LocationIQ integration

LocationIQ provides address search, geocoding, map tiles and routes. Leaflet renders the interactive map. The legacy Google Maps provider and maps key entries remain commented out. Google Maps is available as an optional external pin link and coordinate-copy workflow; it is not the active map SDK. Google sign-in is unaffected.

## Setup

Set these variables in `backend/.env` and restart the backend:

```dotenv
LOCATIONIQ_API_KEY=your_locationiq_server_token
LOCATIONIQ_REGION=us1
```

Use a LocationIQ token with access to the required search, tiles and routing services. Check the account's quotas and restrict the server token appropriately. `LOCATIONIQ_REGION` supports `us1` and `eu1`. No frontend LocationIQ key is needed. `VITE_API_URL` must point to the backend origin, or be empty when using the same-origin API proxy.

The public `/api/v1/locations/config` endpoint reports configuration presence only, without returning the key. Admin health also reports this status. Neither proves provider connectivity or account permissions. Without a configured token, device location and pasted coordinates remain usable; provider-dependent actions explain their unavailability.

## Application flow

- Gym registration and gym settings share a location picker. Address results fill coordinates and address fields. Device location requests high accuracy and displays the browser's accuracy estimate. Clicking or dragging the map pin selects the entrance; reverse geocoding fills nearby address details while preserving the selected coordinates.
- Nearby gym search accepts device location, an address result, a map point or pasted coordinates. It queries registered gyms in MongoDB using the selected point.
- Gym details display the saved location and can request a driving or walking route from the current device location. Google Maps can optionally open the selected pin.
- Attendance uses measured device coordinates and their accuracy for the existing server geofence checks. Geocoding never replaces attendance coordinates with an address centre.

Location measurements and geocoding are approximate. Verify the entrance pin and editable address before saving. Browser location requires permission and a secure context (HTTPS or localhost). No fallback location is silently saved: the map's initial India overview is only a viewing position.

## API contracts

All endpoints have the prefix `/api/v1/locations`.

| Endpoint | Input | Output |
| --- | --- | --- |
| `GET /config` | None | Provider and configuration flag |
| `GET /autocomplete` | Query `q` | Up to five normalized address results |
| `POST /geocode` | `{ address }` | Normalized address results |
| `POST /reverse-geocode` | `{ latitude, longitude }` | One normalized address result |
| `POST /directions` | `{ origin, destination, mode }` | LocationIQ route data with GeoJSON geometry; mode is `driving` or `walking` |
| `GET /tiles/:z/:x/:y` | Valid tile indices, zoom 0–19 | Raster map image |

Address results contain `placeId`, `displayName`, numeric `latitude`/`longitude`, and `address` with `line1`, `locality`, `city`, `state`, `postalCode`, and uppercase country code. Directions accept `latitude,longitude` strings or addresses; the server converts them to LocationIQ's longitude-first format. MongoDB coordinates and GeoJSON route coordinates are `[longitude, latitude]`.

The backend enforces coordinate ranges, input lengths, request timeouts and separate search/tile rate limits. Provider authentication, quota and connectivity failures produce sanitized errors. Tiles are proxied through the backend so the token is not included in browser URLs.

## Verification

Run `npm run build` and `npm test -- --maxWorkers=1` in both `backend` and `frontend`. Provider contract tests simulate LocationIQ responses, including errors, routing coordinate order and binary tiles. Frontend tests cover form persistence, reverse-geocoding failures, device accuracy, map selection and pasted coordinates. These tests do not certify a real token, live map rendering or browser location permission.

Official references: [autocomplete](https://docs.locationiq.com/docs/autocomplete), [forward geocoding](https://docs.locationiq.com/docs/search-forward-geocoding), [reverse geocoding](https://docs.locationiq.com/docs/reverse-geocoding), [routing](https://docs.locationiq.com/docs/routing-api), and [LocationIQ's Leaflet integration](https://github.com/location-iq/leaflet-geocoder).
