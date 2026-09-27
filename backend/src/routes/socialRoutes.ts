import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/auth.js";
import * as controller from "../controllers/socialController.js";
export const socialRoutes = Router();
socialRoutes.use(requireAuth);
const writeLimit = rateLimit({
  windowMs: 60000,
  limit: 30,
  keyGenerator: (req) => req.auth!.userId,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
socialRoutes.get("/profiles", controller.searchProfiles);
socialRoutes.get("/profiles/:id", controller.profile);
socialRoutes.post("/profiles/:id/follow", writeLimit, controller.follow);
socialRoutes.delete("/profiles/:id/follow", writeLimit, controller.follow);
socialRoutes.get("/profiles/:id/:kind", (req, res, next) => {
  if (["followers", "following"].includes(String(req.params.kind)))
    return controller.relationships(req, res);
  if (["posts", "stories"].includes(String(req.params.kind)))
    return controller.listContent(req, res);
  next();
});
socialRoutes.use("/:kind", (req, _res, next) => {
  if (!["posts", "stories"].includes(String(req.params.kind)))
    return next("router");
  next();
});
socialRoutes.post("/:kind", writeLimit, controller.saveContent);
socialRoutes.patch("/:kind/:contentId", writeLimit, controller.saveContent);
socialRoutes.delete("/:kind/:contentId", writeLimit, controller.deleteContent);
