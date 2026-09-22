import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireGymContext, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import * as controller from "../controllers/trainerController.js";
import { workoutInput, progressInput } from "./inputSchemas.js";

export const trainerRoutes = Router();
trainerRoutes.use(requireAuth, requireRole("TRAINER"), requireGymContext);
trainerRoutes.get("/dashboard", controller.dashboard);
trainerRoutes.get("/clients", controller.clients);
trainerRoutes.get("/sessions", controller.sessions);
trainerRoutes.get("/workout-plans", controller.workoutPlans);
trainerRoutes.post("/workout-plans", validate(z.object({ body: z.object({ name: z.string().min(2).max(160), description: z.string().max(3000).optional(), goal: z.string().max(200).optional(), status: z.enum(["DRAFT","ACTIVE"]).default("DRAFT"), exercises: z.array(z.object({ name: z.string().min(2), sets: z.number().int().positive().optional(), reps: z.string().optional(), durationSeconds: z.number().int().positive().optional(), restSeconds: z.number().int().nonnegative().optional(), notes: z.string().max(1000).optional() })).min(1) }), params:z.object({}), query:z.object({}) })), controller.createWorkoutPlan);
trainerRoutes.patch("/workout-plans/:id", (req, _res, next) => { req.body = workoutInput.parse(req.body); next(); }, controller.updateWorkoutPlan);
trainerRoutes.post("/clients/:memberId/workout-assignments", validate(z.object({ body: z.object({ workoutPlanId: z.string(), startsAt: z.coerce.date(), endsAt: z.coerce.date().optional(), notes: z.string().max(2000).optional() }), params: z.object({ memberId: z.string() }), query:z.object({}) })), controller.assignWorkout);
trainerRoutes.get("/clients/:memberId/progress", controller.progress);
trainerRoutes.post("/clients/:memberId/progress", (req, _res, next) => { req.body = progressInput.parse(req.body); next(); }, controller.recordProgress);
