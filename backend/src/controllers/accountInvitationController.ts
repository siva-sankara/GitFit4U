import mongoose from "mongoose";
import type { Request, Response } from "express";
import { MemberProfile } from "../models/Member.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { acceptMemberInvitation, issueMemberInvitation } from "../services/accountInvitationService.js";
import { AppError } from "../utils/AppError.js";
import { writeAudit } from "../services/auditService.js";
export async function activateAccount(req: Request, res: Response) {
  const data = await acceptMemberInvitation({ token: req.body.token, password: req.body.password });
  res.json({ success: true, data });
}
export async function acceptInvitation(req: Request, res: Response) {
  const data = await acceptMemberInvitation({ token: req.body.token, userId: req.auth!.userId });
  res.json({ success: true, data });
}
export async function resendMemberInvitation(req: Request, res: Response) {
  const data = await mongoose.connection.transaction(async session => {
    const member = await MemberProfile.findOne({ publicId: req.params.id, gymId: req.auth!.gymId, "invitation.status": "PENDING" }).session(session);
    if (!member) throw new AppError(404, "INVITATION_NOT_FOUND", "Pending member invitation not found.");
    const user = await User.findById(member.userId).session(session);
    const gym = await Gym.findById(member.gymId).session(session);
    if (!user || !gym || ["DISABLED", "BLOCKED"].includes(user.status)) throw new AppError(409, "INVITATION_UNAVAILABLE", "This invitation is unavailable.");
    return issueMemberInvitation(member, user, gym, session);
  });
  await writeAudit(req, { action: "member.invitation.resent", entityType: "MemberProfile", entityId: String(req.params.id) });
  res.status(202).json({ success: true, data });
}
