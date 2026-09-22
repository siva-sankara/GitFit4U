import type { Request, Response } from "express";
// import { googleMapsProvider } from "../integrations/maps/googleMapsProvider.js";
import {
  locationIqProvider,
  mapsConfigured,
} from "../integrations/maps/locationIqProvider.js";
export function config(_req: Request, res: Response) {
  res.json({
    success: true,
    data: {
      provider: "LOCATIONIQ",
      configured: mapsConfigured(),
      attribution: "https://locationiq.com/attribution",
    },
  });
}
export async function autocomplete(req: Request, res: Response) {
  res.json({
    success: true,
    data: await locationIqProvider.autocomplete(String(req.query.q)),
  });
}
export async function geocode(req: Request, res: Response) {
  res.json({
    success: true,
    data: await locationIqProvider.geocode(req.body.address),
  });
}
export async function reverse(req: Request, res: Response) {
  res.json({
    success: true,
    data: await locationIqProvider.reverseGeocode(
      req.body.latitude,
      req.body.longitude,
    ),
  });
}
export async function directions(req: Request, res: Response) {
  res.json({
    success: true,
    data: await locationIqProvider.directions(
      req.body.origin,
      req.body.destination,
      req.body.mode,
    ),
  });
}
export async function tile(req: Request, res: Response) {
  const data = await locationIqProvider.tile(
    Number(req.params.z),
    Number(req.params.x),
    Number(req.params.y),
  );
  res.type("png").set("Cache-Control", "public, max-age=3600").send(data);
}
