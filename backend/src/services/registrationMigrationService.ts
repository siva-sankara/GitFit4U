import mongoose from "mongoose";
import { GymRegistration } from "../models/GymRegistration.js";
import { Gym } from "../models/Gym.js";
import { PlanQuote, ProviderEvent } from "../models/Commerce.js";
import {
  activatePaidRegistration,
  legacyRegistrationStates,
  registrationPayment,
  validateRegistrationGym,
} from "./registrationService.js";

export async function migratePaymentRegistrations(apply = false) {
  const counts = {
    activePreserved: 0,
    suspendedPreserved: 0,
    paidActivated: 0,
    unpaidNormalized: 0,
    unchanged: 0,
    missingGym: 0,
  };
  for await (const row of GymRegistration.find().select("_id").cursor()) {
    const action = await mongoose.connection.transaction(async (session) => {
      const registration = await GymRegistration.findById(row._id).session(
        session,
      );
      if (!registration) return "unchanged" as const;
      const gym = await Gym.findById(registration.gymId).session(session);
      if (!gym) return "missingGym" as const;
      if (gym.status === "ACTIVE") {
        if (apply && registration.status !== "ACTIVE") {
          registration.status = "ACTIVE";
          registration.currentStep = "COMPLETE";
          await registration.save({ session });
        }
        return "activePreserved" as const;
      }
      if (
        ["SUSPENDED", "ARCHIVED"].includes(gym.status) ||
        registration.status === "SUSPENDED"
      )
        return "suspendedPreserved" as const;
      const paid = await registrationPayment(registration, session);
      const payment = paid?.payment,
        subscription = paid?.subscription;
      const quote =
        payment &&
        ((await PlanQuote.findById(payment.quoteId).session(session)) ||
          payment.metadata?.quoteSnapshot);
      const proof =
        payment &&
        payment.capturedAt &&
        payment.providerPaymentId &&
        payment.providerOrderId &&
        (await ProviderEvent.exists({
          status: "PROCESSED",
          eventType: { $in: ["payment.captured", "order.paid"] },
          "payload.payload.payment.entity.id": payment.providerPaymentId,
          "payload.payload.payment.entity.order_id": payment.providerOrderId,
          "payload.payload.payment.entity.amount": payment.amountMinor,
          "payload.payload.payment.entity.currency": payment.currency,
        }).session(session));
      if (
        proof &&
        quote?.planSnapshot?.registrationId === registration.publicId &&
        String(quote.gymId) === String(gym._id) &&
        String(quote.purchaserId) === String(registration.ownerId) &&
        quote.totalMinor === payment.amountMinor &&
        quote.currency === payment.currency
      ) {
        if (apply)
          await activatePaidRegistration(
            registration,
            payment,
            subscription,
            session,
          );
        return "paidActivated" as const;
      }
      if (
        legacyRegistrationStates.includes(registration.status) ||
        registration.status === "ACTIVE"
      ) {
        if (apply) {
          registration.status = "DRAFT";
          try {
            validateRegistrationGym(gym);
            registration.currentStep = "PLAN";
          } catch {
            registration.currentStep = "GYM";
          }
          await registration.save({ session });
        }
        return "unpaidNormalized" as const;
      }
      return "unchanged" as const;
    });
    counts[action]++;
  }
  return counts;
}
