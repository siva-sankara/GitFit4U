import type { Request, Response } from "express";
import mongoose from "mongoose";
import { nanoid } from "nanoid";
import { read, utils, write } from "xlsx";
import { z } from "zod";
import { Gym } from "../models/Gym.js";
import { User } from "../models/User.js";
import { MemberProfile } from "../models/Member.js";
import { MembershipPlan, Payment, Subscription } from "../models/Commerce.js";
import { Trainer } from "../models/Engagement.js";
import { MemberImportJob } from "../models/MemberImport.js";
import { AppError } from "../utils/AppError.js";
import { normalizePhone } from "../services/otpService.js";
import { normalizeEmail } from "../utils/accountIdentity.js";
import { writeAudit } from "../services/auditService.js";
import { ensurePaymentInvoice } from "../services/invoiceService.js";
import { issueMemberInvitation } from "../services/accountInvitationService.js";
import { offlinePlanQuote } from "./memberManagementController.js";
import { withMemberMedia } from "../services/userMediaService.js";
import { emitDomainEvents } from "../services/domainEventService.js";
import { StreakProjection } from "../models/Attendance.js";

const fields = [
  "name", "phone", "email", "plan", "accessType", "startDate",
  "renewalDate", "trainer", "status", "paymentStatus",
] as const;
type ImportField = typeof fields[number];
const fieldLabels: Record<ImportField, string> = {
  name: "Member name", phone: "Phone number", email: "Email", plan: "Membership plan",
  accessType: "Access type", startDate: "Start date", renewalDate: "Renewal date",
  trainer: "Trainer", status: "Status", paymentStatus: "Payment status",
};
const aliases: Record<ImportField, string[]> = {
  name: ["name", "membername", "fullname"],
  phone: ["phone", "phonenumber", "mobile", "mobilenumber"],
  email: ["email", "emailaddress"],
  plan: ["plan", "membershipplan", "planname"],
  accessType: ["accesstype", "access"],
  startDate: ["startdate", "joined", "joindate"],
  renewalDate: ["renewaldate", "expiry", "expirydate", "enddate"],
  trainer: ["trainer", "trainername"],
  status: ["status", "memberstatus"],
  paymentStatus: ["paymentstatus", "payment"],
};
const cleanHeader = (value: unknown) => String(value ?? "").trim().slice(0, 120);
const canonical = (value: unknown) => cleanHeader(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const safeCell = (value: unknown) => String(value ?? "").trim().slice(0, 500);
const csvCell = (value: unknown) => `"${String(value ?? "").replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`;

function sourceFormat(file: Express.Multer.File) {
  const extension = file.originalname.toLowerCase().split(".").pop();
  if (!extension || !["csv", "xls", "xlsx"].includes(extension))
    throw new AppError(422, "IMPORT_FILE_TYPE_INVALID", "Choose a CSV, XLS or XLSX member file.");
  const zip = file.buffer[0] === 0x50 && file.buffer[1] === 0x4b;
  const compound = file.buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
  if ((extension === "xlsx" && !zip) || (extension === "xls" && !compound))
    throw new AppError(422, "IMPORT_FILE_CONTENT_INVALID", "The spreadsheet content does not match its file extension.");
  return extension as "csv" | "xls" | "xlsx";
}

function parseRows(file: Express.Multer.File) {
  const format = sourceFormat(file);
  let workbook;
  try {
    workbook = read(file.buffer, {
      type: "buffer", dense: true, cellFormula: false, cellHTML: false,
      cellNF: false, sheetRows: 1002, WTF: false,
    });
  } catch {
    throw new AppError(422, "IMPORT_FILE_UNREADABLE", "The spreadsheet could not be read. Check the file and try again.");
  }
  const first = workbook.SheetNames[0];
  if (!first) throw new AppError(422, "IMPORT_FILE_EMPTY", "The spreadsheet has no worksheets.");
  const matrix = utils.sheet_to_json<unknown[]>(workbook.Sheets[first], {
    header: 1, raw: false, defval: "", blankrows: false,
  });
  const columns = (matrix.shift() || []).slice(0, 30).map(cleanHeader);
  if (!columns.length || columns.every((column) => !column))
    throw new AppError(422, "IMPORT_HEADERS_REQUIRED", "The first row must contain column headings.");
  const rows = matrix
    .slice(0, 1000)
    .map((row) => columns.map((_, index) => safeCell(row[index])))
    .filter((row) => row.some(Boolean));
  if (!rows.length) throw new AppError(422, "IMPORT_ROWS_REQUIRED", "The spreadsheet has no member rows.");
  return { format, columns, rows, truncated: matrix.length > 1000 };
}

function suggestedMapping(columns: string[]) {
  return Object.fromEntries(fields.map((field) => {
    const column = columns.find((value) => aliases[field].includes(canonical(value)));
    return [field, column || ""];
  }));
}

function jobScope(req: Request) {
  return { publicId: req.params.importId, gymId: req.auth!.gymId, actorId: req.auth!.userId };
}

export async function uploadMemberImport(req: Request, res: Response) {
  if (!req.file) throw new AppError(422, "IMPORT_FILE_REQUIRED", "Choose a CSV, XLS or XLSX member file.");
  const parsed = parseRows(req.file);
  const job = await MemberImportJob.create({
    publicId: nanoid(22), gymId: req.auth!.gymId, actorId: req.auth!.userId,
    sourceFileName: req.file.originalname.slice(0, 180), sourceFormat: parsed.format,
    columns: parsed.columns, rawRows: parsed.rows, summary: { total: parsed.rows.length },
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
  });
  await writeAudit(req, { action: "member.import.uploaded", entityType: "MemberImportJob", entityId: job.publicId, after: { rows: parsed.rows.length, format: parsed.format } });
  res.status(201).json({ success: true, data: {
    importId: job.publicId, fileName: job.sourceFileName, columns: parsed.columns,
    sampleRows: parsed.rows.slice(0, 8), totalRows: parsed.rows.length,
    suggestedMapping: suggestedMapping(parsed.columns), truncated: parsed.truncated,
  } });
}

const mappingInput = z.object(Object.fromEntries(fields.map((field) => [field, z.string().max(120).optional()])) as Record<ImportField, z.ZodOptional<z.ZodString>>).strict();
const validateInput = z.object({ mapping: mappingInput }).strict();

export function parseDate(value: string) {
  if (!value) return undefined;
  let iso = value;
  const india = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (india) iso = `${india[3]}-${india[2].padStart(2, "0")}-${india[1].padStart(2, "0")}`;
  const normalized = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return undefined;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === normalized
    ? date
    : undefined;
}

export async function validateMemberImport(req: Request, res: Response) {
  const input = validateInput.parse(req.body);
  const job: any = await MemberImportJob.findOne(jobScope(req)).select("+rawRows");
  if (!job) throw new AppError(404, "IMPORT_NOT_FOUND", "This import is unavailable or expired.");
  if (["PROCESSING", "COMPLETED"].includes(job.status))
    throw new AppError(409, "IMPORT_ALREADY_STARTED", "This import has already started.");
  for (const required of ["name", "phone"] as ImportField[])
    if (!input.mapping[required] || !job.columns.includes(input.mapping[required]))
      throw new AppError(422, "IMPORT_MAPPING_REQUIRED", `${fieldLabels[required]} must be mapped to a spreadsheet column.`);
  const index = Object.fromEntries(fields.map((field) => [field, job.columns.indexOf(input.mapping[field] || "")])) as Record<ImportField, number>;
  const [plans, trainers] = await Promise.all([
    MembershipPlan.find({ gymId: req.auth!.gymId, status: "ACTIVE" }).select("publicId name durationDays priceMinor discountMinor taxRateBasisPoints currency code version benefits freezeDaysAllowed").lean(),
    Trainer.find({ gymId: req.auth!.gymId, status: "ACTIVE" }).select("_id publicId name").lean(),
  ]);
  const planMap = new Map(plans.flatMap((plan: any) => [[canonical(plan.name), plan], [canonical(plan.publicId), plan]]));
  const trainerMap = new Map(trainers.flatMap((trainer: any) => [[canonical(trainer.name), trainer], [canonical(trainer.publicId), trainer]]));
  const seen = new Set<string>();
  const normalized = job.rawRows.map((row: string[], offset: number) => {
    const value = (field: ImportField) => index[field] >= 0 ? safeCell(row[index[field]]) : "";
    const errors: string[] = [], warnings: string[] = [];
    const name = value("name");
    let phone = value("phone").replace(/[\s()-]/g, "");
    if (/^\d{10}$/.test(phone)) phone = `+91${phone}`;
    try { phone = normalizePhone(phone); } catch { errors.push("Enter a valid international phone number or a 10-digit Indian number."); }
    const emailValue = value("email");
    let email: string | undefined;
    if (emailValue) {
      try { email = normalizeEmail(emailValue); if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error(); }
      catch { errors.push("Email address is invalid."); }
    }
    if (name.length < 2) errors.push("Member name is required.");
    if (phone && seen.has(phone)) errors.push("Phone number is duplicated in this file.");
    if (phone) seen.add(phone);
    const planValue = value("plan"), plan = planMap.get(canonical(planValue));
    const accessType = value("accessType").toUpperCase();
    if (planValue && !plan) warnings.push(`Plan “${planValue}” was not found. Map it, create it during confirmation, skip this row, or import as direct access.`);
    if (!planValue && accessType !== "DIRECT") warnings.push("No plan is mapped; choose direct access or skip this row.");
    const trainerValue = value("trainer"), trainer = trainerMap.get(canonical(trainerValue));
    if (trainerValue && !trainer) warnings.push(`Trainer “${trainerValue}” was not found and will remain unassigned.`);
    const startDateValue = value("startDate"), startDate = parseDate(startDateValue) || new Date();
    if (startDateValue && !parseDate(startDateValue)) errors.push("Start date is invalid; use YYYY-MM-DD or DD/MM/YYYY.");
    const renewalValue = value("renewalDate"), renewalDate = parseDate(renewalValue);
    if (renewalValue && !renewalDate) errors.push("Renewal date is invalid; use YYYY-MM-DD or DD/MM/YYYY.");
    if (renewalDate && renewalDate <= startDate) errors.push("Renewal date must be after the start date.");
    const status = value("status").toUpperCase() || "ACTIVE";
    if (!["ACTIVE", "INACTIVE", "SUSPENDED"].includes(status)) errors.push("Status must be Active, Inactive or Suspended.");
    const paymentStatus = value("paymentStatus").toUpperCase() || "PENDING";
    if (!["CAPTURED", "PENDING", "FAILED", "NONE"].includes(paymentStatus)) errors.push("Payment status must be Captured, Pending, Failed or None.");
    return { rowNumber: offset + 2, data: { name, phone, email, planValue, planId: plan?.publicId, accessType, startDate: startDate.toISOString(), renewalDate: renewalDate?.toISOString(), trainerValue, trainerId: trainer?._id?.toString(), status, paymentStatus }, errors, warnings, state: errors.length ? "INVALID" : "READY", result: "PENDING" };
  });
  const phones = normalized.filter((row: any) => !row.errors.length).map((row: any) => row.data.phone);
  const emails = normalized.filter((row: any) => row.data.email).map((row: any) => row.data.email);
  const userIds = await User.distinct("_id", { $or: [{ phone: { $in: phones } }, { email: { $in: emails } }] });
  const duplicates = await MemberProfile.find({ gymId: req.auth!.gymId, $or: [{ userId: { $in: userIds } }, { "contact.phone": { $in: phones } }, { "contact.email": { $in: emails } }] }).select("publicId userId contact.phone contact.email").lean();
  for (const row of normalized) {
    const duplicate: any = duplicates.find((member: any) => member.contact?.phone === row.data.phone || (row.data.email && member.contact?.email === row.data.email));
    if (duplicate) { row.duplicateMemberId = duplicate.publicId; row.warnings.push("A member with this phone or email already exists. Choose Skip or Update existing during confirmation."); }
  }
  const summary = { total: normalized.length, valid: normalized.filter((row: any) => !row.errors.length).length, warnings: normalized.filter((row: any) => row.warnings.length).length, invalid: normalized.filter((row: any) => row.errors.length).length, imported: 0, updated: 0, skipped: 0, failed: 0 };
  job.mapping = input.mapping; job.validatedRows = normalized; job.status = "VALIDATED"; job.cursor = 0; job.summary = summary;
  await job.save();
  res.json({ success: true, data: { importId: job.publicId, rows: normalized, summary, plans: plans.map((plan: any) => ({ publicId: plan.publicId, name: plan.name })), trainers: trainers.map((trainer: any) => ({ publicId: trainer.publicId, name: trainer.name })) } });
}

const confirmInput = z.object({
  duplicateStrategy: z.enum(["SKIP", "UPDATE"]).default("SKIP"),
  missingPlanStrategy: z.enum(["SKIP", "DIRECT", "CREATE"]).default("SKIP"),
  newPlanDurationDays: z.number().int().min(1).max(3650).default(30),
  newPlanPriceMinor: z.number().int().min(0).max(100_000_000).default(0),
  planMappings: z.record(z.string().max(160), z.string().max(64)).default({}),
  trainerMappings: z.record(z.string().max(160), z.string().max(64)).default({}),
  batchSize: z.number().int().min(1).max(50).default(25),
}).strict();

export async function importRow(req: Request, row: any, input: z.infer<typeof confirmInput>, gym: any) {
  if (row.errors.length) return "skipped";
  if (!row.data.planId && !input.planMappings[row.data.planValue] && input.missingPlanStrategy === "SKIP") return "skipped";
  return mongoose.connection.transaction(async (session) => {
    const mappedPlanId = row.data.planId || input.planMappings[row.data.planValue];
    const mappedTrainerId = row.data.trainerId || input.trainerMappings[row.data.trainerValue];
    let importedPlan: any = mappedPlanId
      ? await MembershipPlan.findOne({ gymId: req.auth!.gymId, publicId: mappedPlanId, status: "ACTIVE" }).session(session)
      : null;
    if (!importedPlan && input.missingPlanStrategy === "CREATE" && row.data.planValue) {
      const planName = String(row.data.planValue).trim().slice(0, 160);
      const exactName = new RegExp(`^${planName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
      importedPlan = await MembershipPlan.findOne({ gymId: req.auth!.gymId, name: exactName, status: "ACTIVE" }).session(session);
      if (!importedPlan) {
        [importedPlan] = await MembershipPlan.create([{
          publicId: nanoid(18), gymId: req.auth!.gymId,
          code: `IMPORT-${nanoid(10).toUpperCase()}`, version: 1,
          name: planName, durationDays: input.newPlanDurationDays,
          priceMinor: input.newPlanPriceMinor, currency: "INR",
          benefits: [], status: "ACTIVE",
        }], { session });
      }
    }
    if (mappedPlanId && !importedPlan) throw new Error("The mapped plan is no longer active.");
    if (!mappedPlanId && input.missingPlanStrategy === "CREATE" && !row.data.planValue)
      throw new Error("A plan name is required to create a missing plan.");
    const trainerIdentity = mappedTrainerId
      ? [{ publicId: mappedTrainerId }, ...(mongoose.isValidObjectId(mappedTrainerId) ? [{ _id: mappedTrainerId }] : [])]
      : [];
    const importedTrainer: any = mappedTrainerId
      ? await Trainer.findOne({ gymId: req.auth!.gymId, $or: trainerIdentity, status: "ACTIVE" }).select("_id").session(session)
      : null;
    const existing = row.duplicateMemberId ? await MemberProfile.findOne({ gymId: req.auth!.gymId, publicId: row.duplicateMemberId }).session(session) : null;
    if (existing) {
      if (input.duplicateStrategy === "SKIP") return "skipped";
      existing.set("contact.name", row.data.name);
      if (row.data.email) existing.set("contact.email", row.data.email);
      existing.set("contact.phone", row.data.phone);
      if (importedTrainer) existing.assignedTrainerId = importedTrainer._id;
      await existing.save({ session });
      return "updated";
    }
    const matching = await User.find({ $or: [{ phone: row.data.phone }, ...(row.data.email ? [{ email: row.data.email }] : [])] }).session(session);
    if (matching.length > 1) throw new Error("Phone and email belong to different accounts.");
    let user = matching[0];
    if (user && ["BLOCKED", "DISABLED"].includes(user.status)) throw new Error("The linked account is unavailable.");
    if (!user) [user] = await User.create([{ publicId: nanoid(18), name: row.data.name, phone: row.data.phone, email: row.data.email, roles: ["USER"], status: "PENDING_VERIFICATION" }], { session });
    const needsInvitation = user.status !== "ACTIVE";
    const [member] = await MemberProfile.create([{ publicId: nanoid(18), gymId: req.auth!.gymId, userId: user._id, memberCode: `GFU-${nanoid(8).toUpperCase()}`, status: needsInvitation ? "INACTIVE" : row.data.status, directAccess: !importedPlan && input.missingPlanStrategy === "DIRECT", assignedTrainerId: importedTrainer?._id, contact: { name: row.data.name, phone: row.data.phone, email: row.data.email }, invitation: needsInvitation && row.data.email ? { status: "PENDING", kind: "ACTIVATE" } : undefined }], { session });
    if (needsInvitation && row.data.email) await issueMemberInvitation(member, user, gym, session);
    if (importedPlan) {
      const plan: any = importedPlan;
      const startsAt = new Date(row.data.startDate), quoted = offlinePlanQuote(plan, startsAt, gym.timezone);
      const endsAt = row.data.renewalDate ? new Date(row.data.renewalDate) : quoted.endsAt;
      const captured = row.data.paymentStatus === "CAPTURED";
      const [subscription] = await Subscription.create([{ publicId: nanoid(24), type: "GYM_MEMBERSHIP", userId: user._id, gymId: req.auth!.gymId, memberProfileId: member._id, status: captured ? "ACTIVE" : "PENDING_PAYMENT", startsAt, endsAt, renewalAt: endsAt, planSnapshot: { planId: plan.publicId, name: plan.name, code: plan.code, version: plan.version, durationDays: plan.durationDays, priceMinor: plan.priceMinor, totalMinor: quoted.totalMinor, discountMinor: plan.discountMinor, taxRateBasisPoints: plan.taxRateBasisPoints, freezeDaysAllowed: plan.freezeDaysAllowed, benefits: plan.benefits } }], { session });
      if (row.data.paymentStatus !== "NONE") {
        const [payment] = await Payment.create([{ publicId: nanoid(24), purpose: "MEMBERSHIP", payerId: user._id, gymId: req.auth!.gymId, subscriptionId: subscription._id, amountMinor: quoted.totalMinor, currency: plan.currency || "INR", provider: "OFFLINE", methodCategory: "OTHER", status: captured ? "CAPTURED" : row.data.paymentStatus === "FAILED" ? "FAILED" : "PENDING", capturedAt: captured ? new Date() : undefined, metadata: { collectorId: req.auth!.userId, notes: `Imported from ${row.rowNumber}` } }], { session });
        subscription.latestPaymentId = payment._id; await subscription.save({ session });
        if (captured) await ensurePaymentInvoice(payment, { session, subscription });
      }
      member.currentSubscriptionId = subscription._id; member.directAccess = false; await member.save({ session });
    }
    return "imported";
  });
}

export async function confirmMemberImport(req: Request, res: Response) {
  const input = confirmInput.parse(req.body);
  const job: any = await MemberImportJob.findOne(jobScope(req)).select("+validatedRows");
  if (!job) throw new AppError(404, "IMPORT_NOT_FOUND", "This import is unavailable or expired.");
  if (!['VALIDATED', 'PROCESSING'].includes(job.status)) throw new AppError(409, "IMPORT_NOT_VALIDATED", "Validate the import before confirming it.");
  const gym = await Gym.findOne({ _id: req.auth!.gymId, status: "ACTIVE" });
  if (!gym) throw new AppError(409, "GYM_NOT_ACTIVE", "Activate this gym before importing members.");
  job.status = "PROCESSING";
  const end = Math.min(job.validatedRows.length, job.cursor + input.batchSize);
  for (let position = job.cursor; position < end; position++) {
    const row = job.validatedRows[position];
    if (row.result !== "PENDING") continue;
    try { const result = await importRow(req, row, input, gym); row.result = result.toUpperCase(); job.summary[result] += 1; }
    catch (error: any) { row.result = "FAILED"; row.errors.push(String(error?.message || "Import failed.").slice(0, 300)); job.summary.failed += 1; }
    job.cursor = position + 1;
  }
  if (job.cursor >= job.validatedRows.length) { job.status = "COMPLETED"; job.completedAt = new Date(); }
  await job.save({ validateBeforeSave: false });
  if (job.status === "COMPLETED") await writeAudit(req, { action: "member.import.completed", entityType: "MemberImportJob", entityId: job.publicId, after: job.summary });
  res.json({ success: true, data: { importId: job.publicId, status: job.status, cursor: job.cursor, total: job.validatedRows.length, summary: job.summary } });
}

export async function memberImportErrors(req: Request, res: Response) {
  const job: any = await MemberImportJob.findOne(jobScope(req)).select("+validatedRows");
  if (!job) throw new AppError(404, "IMPORT_NOT_FOUND", "This import is unavailable or expired.");
  const rows = job.validatedRows.filter((row: any) => row.errors?.length || row.result === "FAILED").map((row: any) => ({ row: row.rowNumber, name: row.data?.name, phone: row.data?.phone, result: row.result, errors: row.errors.join("; "), warnings: row.warnings.join("; ") }));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="getfit4u-member-import-errors-${job.publicId}.csv"`);
  res.send(["Row,Name,Phone,Result,Errors,Warnings", ...rows.map((row: any) => [row.row, row.name, row.phone, row.result, row.errors, row.warnings].map(csvCell).join(","))].join("\r\n"));
}

export async function memberImportTemplate(req: Request, res: Response) {
  const format = req.query.format === "xlsx" ? "xlsx" : "csv";
  const sample = [{ "Member name": "Kiran Kumar", "Phone number": "9876543210", Email: "kiran@example.com", "Membership plan": "Monthly", "Access type": "PLAN", "Start date": "2026-10-06", "Renewal date": "", Trainer: "", Status: "ACTIVE", "Payment status": "PENDING" }];
  if (format === "xlsx") {
    const book = utils.book_new(); utils.book_append_sheet(book, utils.json_to_sheet(sample), "Members");
    const data = write(book, { type: "buffer", bookType: "xlsx", compression: true });
    res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="getfit4u-member-import-template.xlsx"');
    return res.send(data);
  }
  res.type("text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="getfit4u-member-import-template.csv"');
  return res.send([Object.keys(sample[0]).map(csvCell).join(","), Object.values(sample[0]).map(csvCell).join(",")].join("\r\n"));
}

const exportInput = z.object({ memberIds: z.array(z.string().min(3).max(64)).max(5000).default([]), format: z.enum(["csv", "xlsx"]), scope: z.enum(["selected", "filtered"]), filters: z.object({ q: z.string().max(120).optional(), status: z.string().max(40).optional(), trainerId: z.string().max(64).optional() }).default({}) }).strict();

export async function exportMembers(req: Request, res: Response) {
  const input = exportInput.parse(req.body);
  if (input.scope === "selected" && !input.memberIds.length) throw new AppError(422, "MEMBER_SELECTION_REQUIRED", "Select at least one member to export.");
  const filter: any = { gymId: req.auth!.gymId };
  if (input.scope === "selected") filter.publicId = { $in: input.memberIds };
  else {
    if (input.filters.status) filter.status = input.filters.status;
    if (input.filters.trainerId === "none") filter.assignedTrainerId = null;
    else if (input.filters.trainerId && mongoose.isValidObjectId(input.filters.trainerId)) filter.assignedTrainerId = input.filters.trainerId;
    if (input.filters.q) { const regex = new RegExp(input.filters.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); filter.$or = [{ "contact.name": regex }, { "contact.phone": regex }, { "contact.email": regex }, { memberCode: regex }]; }
  }
  const members: any[] = await withMemberMedia(await MemberProfile.find(filter).select("publicId memberCode contact status joinedAt currentSubscriptionId assignedTrainerId").populate({ path: "currentSubscriptionId", select: "planSnapshot.name status renewalAt endsAt latestPaymentId", populate: { path: "latestPaymentId", select: "status amountMinor" } }).populate({ path: "assignedTrainerId", select: "name" }).sort({ joinedAt: -1 }).limit(5000).lean());
  const attendance = members.length
    ? await StreakProjection.find({
        gymId: req.auth!.gymId,
        memberProfileId: { $in: members.map((member: any) => member._id) },
      })
        .select("memberProfileId totalVisits")
        .lean()
    : [];
  const attendanceByMember = new Map(
    attendance.map((entry: any) => [String(entry.memberProfileId), entry.totalVisits || 0]),
  );
  const rows = members.map((member: any) => ({ Name: member.contact?.name || "", Phone: member.contact?.phone || "", Email: member.contact?.email || "", Status: member.status, "Plan / access": member.currentSubscriptionId?.planSnapshot?.name || (member.directAccess ? "Direct access" : ""), Trainer: member.assignedTrainerId?.name || "", "Attendance count": attendanceByMember.get(String(member._id)) || 0, "Join date": member.joinedAt?.toISOString?.().slice(0, 10) || "", "Renewal date": (member.currentSubscriptionId?.renewalAt || member.currentSubscriptionId?.endsAt)?.toISOString?.().slice(0, 10) || "", "Payment summary": member.currentSubscriptionId?.latestPaymentId?.status || "None" }));
  const gym: any = await Gym.findById(req.auth!.gymId).select("name").lean();
  const slug = String(gym?.name || "gym").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
  const file = `getfit4u-members-${slug || "gym"}-${new Date().toISOString().slice(0, 10)}.${input.format}`;
  res.setHeader("Content-Disposition", `attachment; filename="${file}"`);
  if (input.format === "xlsx") { const book = utils.book_new(); utils.book_append_sheet(book, utils.json_to_sheet(rows), "Members"); res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); return res.send(write(book, { type: "buffer", bookType: "xlsx", compression: true })); }
  res.type("text/csv; charset=utf-8");
  const headers = Object.keys(rows[0] || { Name: "", Phone: "", Email: "", Status: "", "Plan / access": "", Trainer: "", "Attendance count": "", "Join date": "", "Renewal date": "", "Payment summary": "" });
  return res.send([headers.map(csvCell).join(","), ...rows.map((row: any) => headers.map((header) => csvCell(row[header])).join(","))].join("\r\n"));
}

const selectedMembersInput = z.object({
  memberIds: z.array(z.string().min(3).max(64)).min(1).max(500),
});

export async function bulkAssignTrainer(req: Request, res: Response) {
  const input = selectedMembersInput.extend({
    trainerId: z.string().regex(/^[a-f\d]{24}$/i).nullable(),
  }).strict().parse(req.body);
  if (input.trainerId && !(await Trainer.exists({ _id: input.trainerId, gymId: req.auth!.gymId, status: "ACTIVE" })))
    throw new AppError(422, "TRAINER_INVALID", "Select an active trainer from this gym.");
  const members = await MemberProfile.find({ gymId: req.auth!.gymId, publicId: { $in: input.memberIds }, status: { $ne: "ARCHIVED" } }).select("_id publicId userId").lean();
  await MemberProfile.updateMany(
    { _id: { $in: members.map((member: any) => member._id) } },
    { $set: { assignedTrainerId: input.trainerId, trainerAssignedAt: input.trainerId ? new Date() : null } },
  );
  if (input.trainerId)
    await emitDomainEvents(members.map((member: any) => ({
      event: "trainer.assigned" as const,
      userId: member.userId,
      gymId: req.auth!.gymId,
      entityId: member.publicId,
      occurrenceId: `${input.trainerId}:${Date.now()}`,
      actionUrl: "/app/subscriptions",
    })));
  await writeAudit(req, { action: "member.bulk.trainer", entityType: "MemberProfile", after: { count: members.length, assigned: Boolean(input.trainerId) } });
  res.json({ success: true, data: { updated: members.length } });
}

export async function bulkNotifyMembers(req: Request, res: Response) {
  const input = selectedMembersInput.extend({
    title: z.string().trim().min(2).max(120),
    message: z.string().trim().min(2).max(1000),
  }).strict().parse(req.body);
  const members = await MemberProfile.find({ gymId: req.auth!.gymId, publicId: { $in: input.memberIds }, status: { $ne: "ARCHIVED" } }).select("publicId userId").lean();
  const occurrenceId = nanoid(18);
  await emitDomainEvents(members.map((member: any) => ({
    event: "gym.announcement" as const,
    userId: member.userId,
    gymId: req.auth!.gymId,
    entityId: member.publicId,
    occurrenceId,
    actionUrl: "/notifications",
    details: { title: input.title, message: input.message },
    source: "Gym management",
  })));
  await writeAudit(req, { action: "member.bulk.notification", entityType: "MemberProfile", after: { count: members.length } });
  res.json({ success: true, data: { notified: members.length } });
}
