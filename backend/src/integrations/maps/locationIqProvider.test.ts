import { afterEach, beforeEach, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
const config = vi.hoisted(() => ({
  LOCATIONIQ_API_KEY: "test-locationiq-key",
  LOCATIONIQ_REGION: "us1",
  LOG_LEVEL: "silent",
}));
vi.mock("../../config/env.js", () => ({ env: config }));
import { locationRoutes } from "../../routes/locationRoutes.js";
import { errorHandler } from "../../middleware/errorHandler.js";
const app = express();
app.use(express.json());
app.use("/locations", locationRoutes);
app.use(errorHandler);
const example = {
  place_id: "test-place",
  lat: "17.385",
  lon: "78.487",
  display_name: "12 Example Street, Hyderabad",
  address: {
    house_number: "12",
    road: "Example Street",
    suburb: "Test locality",
    city: "Hyderabad",
    state: "Telangana",
    postcode: "500001",
    country_code: "in",
  },
};
const fetchMock = vi.fn();
beforeEach(() => {
  config.LOCATIONIQ_API_KEY = "test-locationiq-key";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
it("returns normalized address suggestions from LocationIQ, keeping the token server-side", async () => {
  fetchMock.mockResolvedValue(Response.json([example]));
  const response = await request(app).get("/locations/autocomplete?q=Example");
  expect(response.status).toBe(200);
  expect(response.body.data[0]).toMatchObject({
    latitude: 17.385,
    longitude: 78.487,
    address: {
      line1: "12 Example Street",
      city: "Hyderabad",
      postalCode: "500001",
      country: "IN",
    },
  });
  const url = fetchMock.mock.calls[0][0] as URL;
  expect(url.hostname).toBe("api.locationiq.com");
  expect(url.searchParams.get("q")).toBe("Example");
  expect(JSON.stringify(response.body)).not.toContain(
    config.LOCATIONIQ_API_KEY,
  );
});
it("handles forward and reverse geocoding with correct lat/lon order", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json([example]))
    .mockResolvedValueOnce(Response.json(example));
  expect(
    (
      await request(app)
        .post("/locations/geocode")
        .send({ address: "Example street" })
    ).status,
  ).toBe(200);
  const reverse = await request(app)
    .post("/locations/reverse-geocode")
    .send({ latitude: 17.4, longitude: 78.5 });
  expect(reverse.status).toBe(200);
  expect((fetchMock.mock.calls[1][0] as URL).searchParams.get("lat")).toBe(
    "17.4",
  );
  expect((fetchMock.mock.calls[1][0] as URL).searchParams.get("lon")).toBe(
    "78.5",
  );
});
it("rejects invalid coordinates and unsupported route modes before provider calls", async () => {
  expect(
    (
      await request(app)
        .post("/locations/reverse-geocode")
        .send({ latitude: 200, longitude: 78 })
    ).status,
  ).toBe(422);
  expect(
    (
      await request(app)
        .post("/locations/directions")
        .send({ origin: "17,78", destination: "18,79", mode: "transit" })
    ).status,
  ).toBe(422);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("does not fabricate matches for an unknown address", async () => {
  fetchMock.mockResolvedValue(new Response("", { status: 404 }));
  const response = await request(app).get(
    "/locations/autocomplete?q=UnknownPlace",
  );
  expect(response.status).toBe(200);
  expect(response.body.data).toEqual([]);
});
it("returns clear provider failures without leaking token or upstream messages", async () => {
  fetchMock.mockResolvedValue(
    new Response("private-provider-error", { status: 403 }),
  );
  const result = await request(app).get("/locations/autocomplete?q=Example");
  expect(result.status).toBe(503);
  expect(result.body.error.code).toBe("LOCATIONIQ_ACCESS_DENIED");
  expect(JSON.stringify(result.body)).not.toContain("private-provider-error");
  config.LOCATIONIQ_API_KEY = "";
  expect(
    (await request(app).get("/locations/config")).body.data.configured,
  ).toBe(false);
  expect(
    (await request(app).get("/locations/autocomplete?q=Example")).body.error
      .code,
  ).toBe("LOCATIONIQ_NOT_CONFIGURED");
});
it("uses longitude,latitude for routing and preserves GeoJSON geometry", async () => {
  fetchMock.mockResolvedValue(
    Response.json({
      code: "Ok",
      routes: [
        {
          distance: 1200,
          duration: 300,
          geometry: {
            type: "LineString",
            coordinates: [
              [78, 17],
              [79, 18],
            ],
          },
          legs: [],
        },
      ],
    }),
  );
  const response = await request(app)
    .post("/locations/directions")
    .send({ origin: "17,78", destination: "18,79", mode: "walking" });
  expect(response.status).toBe(200);
  expect((fetchMock.mock.calls[0][0] as URL).pathname).toBe(
    "/v1/directions/walking/78,17;79,18",
  );
  expect(response.body.data.routes[0].geometry.coordinates[0]).toEqual([
    78, 17,
  ]);
});
it("proxies bounded map tiles without exposing the token", async () => {
  fetchMock.mockResolvedValue(
    new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { "content-type": "image/png" },
    }),
  );
  const tile = await request(app).get("/locations/tiles/3/4/5");
  expect(tile.status).toBe(200);
  expect(tile.headers["content-type"]).toContain("image/png");
  expect(tile.headers["cache-control"]).toContain("max-age=3600");
  expect((await request(app).get("/locations/tiles/3/99/1")).status).toBe(422);
});
