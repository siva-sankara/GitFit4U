import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  inspectToken: vi.fn(),
  inspectWaba: vi.fn(),
  listPhones: vi.fn(),
  subscribe: vi.fn(),
  register: vi.fn(),
  findSession: vi.fn(),
  claimSession: vi.fn(),
  findConnection: vi.fn(),
  findConnectionById: vi.fn(),
  upsertConnection: vi.fn(),
}));

vi.mock("../config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    WHATSAPP_MODE: "live",
    WHATSAPP_APP_ID: "123456789",
    WHATSAPP_APP_SECRET: "app-secret",
    WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: "standard-config",
    WHATSAPP_COEXISTENCE_ENABLED: true,
    WHATSAPP_COEXISTENCE_CONFIG_ID: "coexistence-config",
    WHATSAPP_CREDENTIAL_ENCRYPTION_KEY: "credential-encryption-key-for-tests",
    WHATSAPP_API_VERSION: "v26.0",
    WHATSAPP_DEFAULT_LANGUAGE: "en_US",
  },
}));
vi.mock("../integrations/messaging/whatsappProvider.js", () => ({
  WhatsAppProvider: class {
    exchangeEmbeddedSignupCode = mocks.exchange;
    inspectToken = mocks.inspectToken;
    inspectWaba = mocks.inspectWaba;
    listPhoneNumbers = mocks.listPhones;
    subscribeWaba = mocks.subscribe;
    registerPhone = mocks.register;
  },
}));
vi.mock("../models/WhatsApp.js", () => ({
  WhatsAppConnection: {
    findOne: mocks.findConnection,
    findById: mocks.findConnectionById,
    findOneAndUpdate: mocks.upsertConnection,
  },
  WhatsAppOnboardingSession: {
    findOne: mocks.findSession,
    findOneAndUpdate: mocks.claimSession,
  },
  WhatsAppConsent: {},
  WhatsAppOutbox: {},
  WhatsAppTemplate: {},
}));
vi.mock("../models/Auth.js", () => ({ RoleAssignment: {}, AuthIdentity: {} }));
vi.mock("../models/Gym.js", () => ({ Gym: {} }));
vi.mock("../models/Member.js", () => ({ MemberProfile: {} }));
vi.mock("../models/User.js", () => ({ User: {} }));

import { sha256 } from "../utils/crypto.js";
import { completeWhatsAppOnboarding } from "./whatsappConnectionService.js";

const actor = {
  userId: "507f1f77bcf86cd799439011",
  role: "GYM_OWNER",
  gymId: "507f1f77bcf86cd799439012",
  permissions: ["gym:update"],
};

function session() {
  return {
    _id: "session-object-id",
    publicId: "onboarding-session",
    stateHash: sha256("secure-onboarding-state"),
    userId: actor.userId,
    scope: "GYM",
    gymId: actor.gymId,
    connectionMode: "COEXISTENCE",
    status: "STARTED",
    authorizationStatus: "PENDING",
    candidatePhones: [],
    historySharing: "UNKNOWN",
    diagnosticReference: "diag-ref",
    expiresAt: new Date(Date.now() + 60_000),
    save: vi.fn().mockResolvedValue(undefined),
  } as any;
}

const event = {
  event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
  version: 3,
  data: { waba_id: "123456789012345", history_sharing: false },
};

describe("Coexistence completion ordering and idempotency", () => {
  let row: any;
  const connection = {
    _id: "connection-object-id",
    publicId: "connection-public-id",
    scope: "GYM",
    gymId: actor.gymId,
    wabaId: "123456789012345",
    phoneNumberId: "123456789012346",
    status: "CONNECTED",
    connectionMode: "COEXISTENCE",
    readinessStatus: "SYNCHRONIZING",
    outboundPaused: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    row = session();
    mocks.findSession.mockImplementation(() => ({ select: () => Promise.resolve(row) }));
    mocks.exchange.mockResolvedValue({ accessToken: "provider-access-token" });
    mocks.inspectToken.mockResolvedValue({
      valid: true,
      appId: "123456789",
      scopes: ["whatsapp_business_messaging", "whatsapp_business_management"],
    });
    mocks.inspectWaba.mockResolvedValue({ id: "123456789012345", name: "Test Gym" });
    mocks.listPhones.mockResolvedValue([{
      id: "123456789012346",
      display_phone_number: "+91 90000 00001",
      verified_name: "Test Gym",
      status: "CONNECTED",
      platform_type: "CLOUD_API",
    }]);
    mocks.findConnection.mockImplementation(() => ({ lean: () => Promise.resolve(null) }));
    mocks.claimSession.mockImplementation(() => Promise.resolve({
      ...row,
      finalizationLeaseUntil: new Date(Date.now() + 60_000),
    }));
    mocks.upsertConnection.mockResolvedValue(connection);
    mocks.findConnectionById.mockImplementation(() => ({ lean: () => Promise.resolve(connection) }));
    mocks.subscribe.mockResolvedValue({ success: true });
  });

  const base = {
    onboardingSessionId: "onboarding-session",
    state: "secure-onboarding-state",
  };

  it("handles the Meta session event before the authorization code", async () => {
    const first = await completeWhatsAppOnboarding(actor, { ...base, sessionEvent: event });
    expect(first.status).toBe("AWAITING_AUTHORIZATION");
    const second = await completeWhatsAppOnboarding(actor, { ...base, code: "authorization-code" });
    expect(second.status).toBe("AWAITING_PHONE_SELECTION");
    expect(second.candidates).toHaveLength(1);
  });

  it("handles authorization before the Meta session event", async () => {
    const first = await completeWhatsAppOnboarding(actor, { ...base, code: "authorization-code" });
    expect(first.status).toBe("AWAITING_OWNER_CONFIRMATION");
    const second = await completeWhatsAppOnboarding(actor, { ...base, sessionEvent: event });
    expect(second.status).toBe("AWAITING_PHONE_SELECTION");
  });

  it("rejects forged phone assets and finalizes an authorised choice without registration", async () => {
    await completeWhatsAppOnboarding(actor, { ...base, sessionEvent: event });
    await completeWhatsAppOnboarding(actor, { ...base, code: "authorization-code" });
    await expect(completeWhatsAppOnboarding(actor, {
      ...base,
      selectedPhoneNumberId: "999999999999999",
    })).rejects.toMatchObject({ code: "WHATSAPP_ASSET_FORBIDDEN" });
    const completed = await completeWhatsAppOnboarding(actor, {
      ...base,
      selectedPhoneNumberId: "123456789012346",
    });
    expect(completed).toMatchObject({
      status: "COMPLETED",
      connection: {
        publicId: connection.publicId,
        connectionMode: "COEXISTENCE",
        phoneNumberId: connection.phoneNumberId,
      },
    });
    expect(mocks.subscribe).toHaveBeenCalledOnce();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("returns the existing connection for duplicate completion callbacks", async () => {
    row.status = "COMPLETED";
    row.connectionId = connection._id;
    const replay = await completeWhatsAppOnboarding(actor, { ...base, sessionEvent: event });
    expect(replay).toMatchObject({
      status: "COMPLETED",
      connection: {
        publicId: connection.publicId,
        connectionMode: "COEXISTENCE",
        phoneNumberId: connection.phoneNumberId,
      },
    });
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.upsertConnection).not.toHaveBeenCalled();
  });

  it("does not repeat provider finalization while another callback owns the lease", async () => {
    await completeWhatsAppOnboarding(actor, { ...base, sessionEvent: event });
    await completeWhatsAppOnboarding(actor, { ...base, code: "authorization-code" });
    mocks.claimSession.mockImplementationOnce(() => {
      row.status = "FINALIZING";
      row.finalizationLeaseUntil = new Date(Date.now() + 60_000);
      return Promise.resolve(null);
    });
    const pending = await completeWhatsAppOnboarding(actor, {
      ...base,
      selectedPhoneNumberId: "123456789012346",
    });
    expect(pending.status).toBe("FINALIZING");
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.upsertConnection).not.toHaveBeenCalled();
  });

  it("binds session lookup to the authenticated owner and selected gym", async () => {
    mocks.findSession.mockImplementationOnce(() => ({ select: () => Promise.resolve(null) }));
    await expect(completeWhatsAppOnboarding({
      ...actor,
      userId: "507f1f77bcf86cd799439099",
      gymId: "507f1f77bcf86cd799439098",
    }, { ...base, sessionEvent: event })).rejects.toMatchObject({
      code: "WHATSAPP_ONBOARDING_STATE_INVALID",
    });
    expect(mocks.findSession).toHaveBeenCalledWith(expect.objectContaining({
      userId: "507f1f77bcf86cd799439099",
      gymId: "507f1f77bcf86cd799439098",
      scope: "GYM",
    }));
  });

  it("records Meta phone restrictions as Action Required and keeps outbound paused", async () => {
    mocks.listPhones.mockResolvedValue([{
      id: "123456789012346",
      display_phone_number: "+91 90000 00001",
      verified_name: "Test Gym",
      status: "PENDING",
      platform_type: "CLOUD_API",
    }]);
    await completeWhatsAppOnboarding(actor, { ...base, sessionEvent: event });
    await completeWhatsAppOnboarding(actor, { ...base, code: "authorization-code" });
    await completeWhatsAppOnboarding(actor, {
      ...base,
      selectedPhoneNumberId: "123456789012346",
    });
    expect(mocks.upsertConnection).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "RESTRICTED",
          readinessStatus: "ACTION_REQUIRED",
          outboundPaused: true,
          lastErrorCode: "WHATSAPP_PHONE_NOT_CONNECTED",
        }),
      }),
      expect.any(Object),
    );
  });
});
