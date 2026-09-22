import { Router } from "express";
import * as controller from "../controllers/publicController.js";

export const publicRoutes = Router();
publicRoutes.get("/gyms", controller.listGyms);
publicRoutes.get("/gyms/nearby", controller.nearbyGyms);
publicRoutes.get("/gyms/:slug", controller.gymDetails);
