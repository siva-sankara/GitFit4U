import { Gym } from "../models/Gym.js";
import { GymRegistration } from "../models/GymRegistration.js";
import { registrationStatus } from "./registrationService.js";

export type OwnerOnboarding = {
  state: "NOT_STARTED" | "DRAFT" | "PENDING" | "ACTIVE" | "CHANGES_REQUESTED" | "SUSPENDED";
  registrationId?: string;
  gymId?: string;
  currentStep?: string;
};

type OnboardingGym = { _id: unknown; status?: string; deletedAt?: unknown };
type OnboardingRegistration = {
  publicId: string;
  gymId?: unknown;
  status: string;
  currentStep?: string;
};

// Pure projection of stored records: no status updates, role grants or payment effects.
export function deriveOwnerOnboarding(
  gyms: OnboardingGym[],
  registrations: OnboardingRegistration[],
  activeGymId?: string,
): OwnerOnboarding {
  const available = gyms.filter((gym) => !gym.deletedAt);
  const selected = available.find((gym) => String(gym._id) === activeGymId);
  // Established owners without a selected gym resume an existing active workspace.
  const gym = selected || available.find((candidate) => candidate.status === "ACTIVE") ||
    available.find((candidate) => !["SUSPENDED", "ARCHIVED"].includes(candidate.status || "")) || available[0];
  if (!gym) {
    const unavailable = registrations[0];
    if (gyms.length || unavailable) return {
      state: "SUSPENDED",
      ...(unavailable ? { registrationId: unavailable.publicId } : {}),
    };
    return { state: "NOT_STARTED", currentStep: "GYM" };
  }
  const registration = registrations.find((candidate) => String(candidate.gymId) === String(gym._id));
  const base = {
    gymId: String(gym._id),
    ...(registration ? { registrationId: registration.publicId, currentStep: registration.currentStep } : {}),
  };
  if (["SUSPENDED", "ARCHIVED"].includes(gym.status || "") || registration?.status === "SUSPENDED")
    return { ...base, state: "SUSPENDED" };
  if (gym.status === "ACTIVE") return { ...base, state: "ACTIVE", currentStep: "COMPLETE" };
  // An inactive legacy gym without its registration cannot safely be recreated
  // or assigned a fabricated draft. Existing active legacy gyms remain active.
  if (!registration) return { ...base, state: "SUSPENDED" };
  const status = registrationStatus({ ...registration, gymId: gym });
  if (status === "PAYMENT_PENDING") return { ...base, state: "PENDING", currentStep: "PAYMENT" };
  return { ...base, state: "DRAFT" };
}

export async function getOwnerOnboarding(
  user: { _id: unknown; roles?: string[] },
  activeGymId?: string,
): Promise<OwnerOnboarding | undefined> {
  if (!user.roles?.includes("GYM_OWNER")) return undefined;
  const [gyms, registrations] = await Promise.all([
    Gym.find({ ownerId: user._id }).select("_id status deletedAt").sort({ updatedAt: -1 }).lean(),
    GymRegistration.find({ ownerId: user._id }).select("publicId gymId status currentStep").sort({ updatedAt: -1 }).lean(),
  ]);
  return deriveOwnerOnboarding(gyms, registrations, activeGymId);
}
