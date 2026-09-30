import type { Request, Response } from "express";
import { WhatsAppConnection, WhatsAppOutbox, WhatsAppWebhookReceipt } from "../models/WhatsApp.js";
import { writeAudit } from "../services/auditService.js";
import {
  cancelWhatsAppOnboarding,
  checkWhatsAppConnection,
  completeWhatsAppOnboarding,
  disconnectWhatsApp,
  getCurrentConnection,
  listWhatsAppPreferences,
  listWhatsAppTemplates,
  publicConnection,
  setWhatsAppOutboundState,
  startWhatsAppOnboarding,
  syncWhatsAppTemplates,
  updateWhatsAppPreference,
  updateWhatsAppConnectionControls,
  type WhatsAppActor,
} from "../services/whatsappConnectionService.js";
import {
  archiveWhatsAppConversation,
  cancelWhatsAppCampaign,
  createWhatsAppCampaign,
  getWhatsAppConversation,
  listWhatsAppConversations,
  listWhatsAppMessages,
  listWhatsAppCampaigns,
  markWhatsAppConversationRead,
  openGymMemberWhatsAppConversation,
  previewWhatsAppCampaign,
  queueWhatsAppConversationMessage,
} from "../services/whatsappDeliveryService.js";
import {
  recordWhatsAppWebhook,
  verifyWhatsAppChallenge,
} from "../services/whatsappWebhookService.js";

const actor = (req: Request) => req.auth! as WhatsAppActor;

export async function webhookChallenge(req: Request, res: Response) {
  res.status(200).type("text/plain").send(verifyWhatsAppChallenge(req.query));
}

export async function webhook(req: Request, res: Response) {
  const result = await recordWhatsAppWebhook(
    req.body as Buffer,
    req.header("x-hub-signature-256") || undefined,
  );
  res.status(200).json(result);
}

export async function connection(req: Request, res: Response) {
  res.json({ success: true, data: await getCurrentConnection(actor(req)) });
}

export async function startOnboarding(req: Request, res: Response) {
  const data = await startWhatsAppOnboarding(actor(req), req.body.connectionMode);
  await writeAudit(req, { action: "WHATSAPP_ONBOARDING_STARTED", entityType: "WhatsAppConnection", entityId: data.onboardingSessionId, after: { connectionMode: data.connectionMode } });
  res.status(201).json({ success: true, data });
}

export async function cancelOnboarding(req: Request, res: Response) {
  const data = await cancelWhatsAppOnboarding(actor(req), String(req.params.id));
  await writeAudit(req, { action: "WHATSAPP_ONBOARDING_CANCELLED", entityType: "WhatsAppConnection", entityId: String(req.params.id) });
  res.json({ success: true, data });
}

export async function completeOnboarding(req: Request, res: Response) {
  const result = await completeWhatsAppOnboarding(actor(req), req.body);
  const { completedNow, ...data } = result;
  if (completedNow && data.connection)
    await writeAudit(req, { action: "WHATSAPP_CONNECTED", entityType: "WhatsAppConnection", entityId: data.connection.publicId, after: { scope: data.connection.scope, gymId: data.connection.gymId, phoneNumberId: data.connection.phoneNumberId, connectionMode: data.connection.connectionMode } });
  res.status(completedNow ? 201 : data.status === "COMPLETED" ? 200 : 202).json({ success: true, data });
}

export async function checkConnection(req: Request, res: Response) {
  const data = (await checkWhatsAppConnection(actor(req)))!;
  await writeAudit(req, { action: "WHATSAPP_CONNECTION_CHECKED", entityType: "WhatsAppConnection", entityId: data.publicId });
  res.json({ success: true, data });
}

export async function updateOutbound(req: Request, res: Response) {
  const data = (await setWhatsAppOutboundState(actor(req), req.body.paused, req.body.reason))!;
  await writeAudit(req, { action: req.body.paused ? "WHATSAPP_OUTBOUND_PAUSED" : "WHATSAPP_OUTBOUND_ENABLED", entityType: "WhatsAppConnection", entityId: data.publicId, after: { paused: req.body.paused, reason: req.body.reason } });
  res.json({ success: true, data });
}

export async function updateControls(req: Request, res: Response) {
  const data = (await updateWhatsAppConnectionControls(actor(req), req.body))!;
  await writeAudit(req, { action: "WHATSAPP_CONTROLS_UPDATED", entityType: "WhatsAppConnection", entityId: data.publicId, after: { disabledEvents: req.body.disabledEvents, limits: data.limits } });
  res.json({ success: true, data });
}

export async function disconnect(req: Request, res: Response) {
  const data = (await disconnectWhatsApp(actor(req), req.body.reason))!;
  await writeAudit(req, { action: "WHATSAPP_DISCONNECTED", entityType: "WhatsAppConnection", entityId: data.publicId, after: { reason: req.body.reason } });
  res.json({ success: true, data });
}

export async function templates(req: Request, res: Response) {
  res.json({ success: true, data: await listWhatsAppTemplates(actor(req)) });
}

export async function syncTemplates(req: Request, res: Response) {
  const data = await syncWhatsAppTemplates(actor(req));
  await writeAudit(req, { action: "WHATSAPP_TEMPLATES_SYNCED", entityType: "WhatsAppTemplate", entityId: actor(req).gymId || "PLATFORM", after: { count: data.length } });
  res.json({ success: true, data });
}

export async function preferences(req: Request, res: Response) {
  res.json({ success: true, data: await listWhatsAppPreferences(req.auth!.userId) });
}

export async function updatePreference(req: Request, res: Response) {
  const data = await updateWhatsAppPreference(req.auth!.userId, req.body);
  await writeAudit(req, { action: "WHATSAPP_CONSENT_UPDATED", entityType: "WhatsAppConsent", entityId: req.body.connectionId, after: { service: req.body.service, marketing: req.body.marketing } });
  res.json({ success: true, data });
}

export async function openMemberConversation(req: Request, res: Response) {
  const data = await openGymMemberWhatsAppConversation(actor(req), String(req.params.memberId));
  res.json({ success: true, data });
}

export async function conversations(req: Request, res: Response) {
  const data = await listWhatsAppConversations(actor(req), req.query as any);
  res.json({ success: true, data: data.rows, meta: { page: req.query.page, limit: req.query.limit, total: data.total } });
}

export async function conversationDetails(req: Request, res: Response) {
  res.json({ success: true, data: await getWhatsAppConversation(actor(req), String(req.params.id)) });
}

export async function messages(req: Request, res: Response) {
  res.json({ success: true, data: await listWhatsAppMessages(actor(req), String(req.params.id), req.query as any) });
}

export async function sendMessage(req: Request, res: Response) {
  const data = await queueWhatsAppConversationMessage(actor(req), String(req.params.id), req.body);
  res.status(data.createdAt.getTime() === data.updatedAt.getTime() ? 202 : 200).json({ success: true, data });
}

export async function markRead(req: Request, res: Response) {
  await markWhatsAppConversationRead(actor(req), String(req.params.id));
  res.json({ success: true, data: { read: true } });
}

export async function archive(req: Request, res: Response) {
  await archiveWhatsAppConversation(actor(req), String(req.params.id), req.body.archived);
  res.json({ success: true, data: { archived: req.body.archived } });
}

export async function campaignPreview(req: Request, res: Response) {
  res.json({ success: true, data: await previewWhatsAppCampaign(actor(req), req.body) });
}

export async function campaigns(req: Request, res: Response) {
  res.json({ success: true, data: await listWhatsAppCampaigns(actor(req)) });
}

export async function createCampaign(req: Request, res: Response) {
  const data = await createWhatsAppCampaign(actor(req), req.body);
  await writeAudit(req, { action: "WHATSAPP_CAMPAIGN_SCHEDULED", entityType: "Campaign", entityId: data.publicId, after: { scheduledAt: data.scheduledAt, templateId: data.templateId } });
  res.status(202).json({ success: true, data });
}

export async function cancelCampaign(req: Request, res: Response) {
  const data = await cancelWhatsAppCampaign(actor(req), String(req.params.id));
  await writeAudit(req, { action: "WHATSAPP_CAMPAIGN_CANCELLED", entityType: "Campaign", entityId: data.publicId });
  res.json({ success: true, data });
}

export async function diagnostics(_req: Request, res: Response) {
  const [connections, outbox, webhooks] = await Promise.all([
    WhatsAppConnection.find().sort({ scope: 1, createdAt: -1 }).lean(),
    WhatsAppOutbox.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    WhatsAppWebhookReceipt.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);
  res.json({
    success: true,
    data: {
      connections: connections.map(publicConnection),
      outbox: Object.fromEntries(outbox.map((row) => [row._id, row.count])),
      webhooks: Object.fromEntries(webhooks.map((row) => [row._id, row.count])),
    },
  });
}
