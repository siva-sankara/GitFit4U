import type { Request, Response } from "express";
import { z } from "zod";
import { Notification } from "../models/Engagement.js";
import { AppError } from "../utils/AppError.js";
import { writeAudit } from "../services/auditService.js";
import { withNotificationLinks } from "../services/notificationLinkService.js";

const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "A valid notification identifier is required.");
export async function notificationDetails(req: Request, res: Response) {
  const id = objectId.parse(req.params.id);
  const data = await Notification.findOne({
    _id: id,
    userId: req.auth!.userId,
    archivedAt: null,
  })
    .select("-pushLeaseId -pushLeaseUntil -pushNextAttemptAt")
    .lean();
  if (!data)
    throw new AppError(
      404,
      "NOTIFICATION_NOT_FOUND",
      "Notification not found.",
    );
  res.json({ success: true, data: (await withNotificationLinks([data]))[0] });
}
export async function deleteNotifications(req: Request, res: Response) {
  const body = req.params.id
    ? { ids: [objectId.parse(req.params.id)], all: false }
    : z
        .object({
          ids: z.array(objectId).min(1).max(100).optional(),
          all: z.boolean().optional(),
          confirmed: z.boolean().optional(),
        })
        .strict()
        .refine(
          (value) =>
            value.all === true
              ? value.confirmed === true && !value.ids
              : Boolean(value.ids),
          "Confirm Delete All, or choose up to 100 notifications.",
        )
        .parse(req.body);
  const result = await Notification.updateMany(
    {
      userId: req.auth!.userId,
      archivedAt: null,
      ...(!body.all ? { _id: { $in: body.ids } } : {}),
    },
    {
      $set: { archivedAt: new Date(), pushStatus: "SKIPPED" },
      $unset: { pushLeaseId: 1, pushLeaseUntil: 1 },
    },
  );
  await writeAudit(req, {
    action: body.all ? "notifications.deleted_all" : "notifications.deleted",
    entityType: "Notification",
    entityId: req.auth!.userId,
    after: { count: result.modifiedCount },
  });
  res.json({ success: true, data: { deleted: result.modifiedCount } });
}
