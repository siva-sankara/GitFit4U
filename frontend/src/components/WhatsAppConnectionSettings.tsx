import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleHelp, Link2, PauseCircle, PlusCircle, RefreshCw, Smartphone, Unlink } from "lucide-react";
import { apiRequest, type ApiEnvelope } from "../services/apiClient";
import {
  embeddedSignupOptions,
  parseEmbeddedSignupMessage,
  type WhatsAppConnectionMode,
  type WhatsAppSignup,
} from "../services/whatsappOnboarding";
import { WhatsAppCampaignPanel } from "./WhatsAppCampaignPanel";
import "../styles/whatsapp.css";

type Connection = {
  publicId: string;
  verifiedName?: string;
  displayPhoneNumber?: string;
  status: string;
  connectionMode?: WhatsAppConnectionMode;
  readinessStatus?: string;
  businessVerificationStatus?: string;
  synchronizationStatus?: string;
  coexistenceStatus?: string;
  capabilities?: { businessAppMessaging?: boolean; appMessageEchoes?: boolean; historySharing?: string; limitations?: string[] };
  diagnosticReference?: string;
  outboundPaused: boolean;
  pauseReason?: string;
  qualityRating?: string;
  phoneStatus?: string;
  lastVerifiedAt?: string;
  lastTemplateSyncAt?: string;
  eventPreferences?: { disabledEvents?: string[] };
  limits?: {
    dailyMessages?: number; monthlyMessages?: number; recipientPerDay?: number; campaignMessages?: number;
    concurrentSends?: number; quietHoursStart?: string; quietHoursEnd?: string; timezone?: string;
    estimatedMonthlyBudgetMinor?: number;
  };
};
type ConnectionState = {
  configuration: {
    mode: "disabled" | "dry_run" | "live";
    graphApiVersion: string;
    embeddedSignupReady: boolean;
    coexistenceEnabled: boolean;
    coexistenceReady: boolean;
    embeddedSignupVersion: "v4";
    webhookReady: boolean;
  };
  connection: Connection | null;
};
type OnboardingProgress = {
  status: string;
  connectionMode: WhatsAppConnectionMode;
  diagnosticReference: string;
  candidates?: Array<{ phoneNumberId: string; displayPhoneNumber?: string; verifiedName?: string; phoneStatus?: string }>;
  connection?: Connection | null;
};
const automatedEvents = [
  "invoice.ready", "membership.renewed", "membership.renewal_reminder", "class.booked", "class.cancelled",
  "class.updated", "class.trainer_changed", "class.reminder", "account.registered", "account.verified",
  "membership.created", "membership.activated", "membership.frozen", "membership.reactivated",
  "membership.deactivated", "membership.expiring", "membership.expired", "membership.cancelled",
  "payment.successful", "payment.offline", "payment.refunded", "trainer.assigned", "support.updated",
  "platform.expiring", "gym.activated", "gym.suspended", "gym.archived",
];

function loadFacebookSdk(appId: string, version: string) {
  return new Promise<any>((resolve, reject) => {
    const ready = () => {
      const fb = (window as any).FB;
      if (!fb) return reject(new Error("Meta sign-up could not be loaded."));
      fb.init({ appId, cookie: false, xfbml: false, version });
      resolve(fb);
    };
    if ((window as any).FB) { ready(); return; }
    const existing = document.getElementById("facebook-jssdk") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", ready, { once: true });
      existing.addEventListener("error", () => reject(new Error("Meta sign-up could not be loaded.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.onload = ready;
    script.onerror = () => reject(new Error("Meta sign-up could not be loaded."));
    document.head.appendChild(script);
  });
}

export function WhatsAppConnectionSettings() {
  const client = useQueryClient();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [selectedPhoneNumberId, setSelectedPhoneNumberId] = useState("");
  const signup = useRef<WhatsAppSignup | null>(null);
  const completionQueue = useRef<Promise<unknown>>(Promise.resolve());
  const query = useQuery({
    queryKey: ["whatsapp-connection"],
    queryFn: () => apiRequest<ApiEnvelope<ConnectionState>>("/api/v1/whatsapp/connection"),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["whatsapp-connection"] });

  const complete = useMutation({
    mutationFn: async (partial: Record<string, unknown>) => {
      const active = signup.current;
      if (!active) throw new Error("The onboarding session is unavailable. Start again.");
      return apiRequest<ApiEnvelope<OnboardingProgress>>("/api/v1/whatsapp/onboarding/complete", {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: JSON.stringify({
          onboardingSessionId: active.onboardingSessionId,
          state: active.state,
          ...partial,
        }),
      });
    },
  });
  const submitPartial = (partial: Record<string, unknown>) => {
    completionQueue.current = completionQueue.current
      .then(() => complete.mutateAsync(partial))
      .then((response) => {
        const next = response.data;
        setProgress(next);
        if (next.status === "COMPLETED") {
          setNotice(next.connection?.readinessStatus === "ACTION_REQUIRED"
            ? "Meta authorization is saved, but the number requires action in Meta before messaging can be enabled."
            : "WhatsApp is connected. Sync approved templates before enabling delivery.");
          signup.current = null;
          setSelectedPhoneNumberId("");
          void refresh();
        } else if (next.status === "AWAITING_PHONE_SELECTION") {
          setNotice("Meta returned multiple authorised numbers. Confirm the number you connected.");
        } else if (next.status === "AWAITING_OWNER_CONFIRMATION") {
          setNotice("Complete the confirmation shown by Meta or on your WhatsApp Business phone.");
        } else if (next.status === "AWAITING_AUTHORIZATION") {
          setNotice("Waiting for Meta authorization to finish.");
        }
      })
      .catch((failure) => {
        const reference = signup.current?.diagnosticReference;
        const message = failure instanceof Error ? failure.message : "Meta onboarding could not be completed.";
        setError(reference && !message.includes(reference) ? `${message} Reference ${reference}.` : message);
      });
  };
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const parsed = parseEmbeddedSignupMessage(event);
      if (!parsed) return;
      if (parsed.kind === "FINISH") {
        submitPartial({ sessionEvent: parsed.sessionEvent });
      } else {
        const active = signup.current;
        if (active)
          void apiRequest(`/api/v1/whatsapp/onboarding/${active.onboardingSessionId}/cancel`, {
            method: "POST",
            idempotencyKey: crypto.randomUUID(),
            body: "{}",
          }).catch(() => undefined);
        setError(parsed.kind === "CANCEL" ? "Meta sign-up was cancelled." : "Meta could not complete sign-up. Try again and use the diagnostic reference if support is needed.");
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  });

  const begin = useMutation({
    mutationFn: async (connectionMode: WhatsAppConnectionMode) => {
      const response = await apiRequest<ApiEnvelope<WhatsAppSignup>>("/api/v1/whatsapp/onboarding/start", {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: JSON.stringify({ connectionMode }),
      });
      signup.current = response.data;
      setProgress(null);
      setSelectedPhoneNumberId("");
      const fb = await loadFacebookSdk(response.data.appId, response.data.graphApiVersion);
      setNotice(connectionMode === "COEXISTENCE"
        ? "Meta onboarding opened. Follow the phone confirmation shown for your existing WhatsApp Business number."
        : "Meta onboarding opened for a separate API business number.");
      fb.login((login: any) => {
        const code = login?.authResponse?.code;
        if (!code) {
          setError("Meta did not return an authorization code. Start the connection again.");
          return;
        }
        submitPartial({ code: String(code) });
      }, embeddedSignupOptions(response.data));
    },
    onError: (failure) => setError(failure.message),
  });
  const action = useMutation({
    mutationFn: ({ path, method = "POST", body = {} }: { path: string; method?: string; body?: Record<string, unknown> }) =>
      apiRequest(path, { method, idempotencyKey: crypto.randomUUID(), body: JSON.stringify(body) }),
    onSuccess: () => { setNotice("WhatsApp settings updated."); void refresh(); },
    onError: (failure) => setError(failure.message),
  });
  const data = query.data?.data;
  const connection = data?.connection;
  const busy = begin.isPending || complete.isPending || action.isPending;
  return <section id="gym-whatsapp" className="panel form-section page-stack whatsapp-settings">
    <div className="page-heading"><div><h2>WhatsApp Business</h2><p>Connect a gym-owned sender through Meta. Credentials stay on the server and are never shown here.</p></div>{connection?.status === "CONNECTED" && <span className="chip"><CheckCircle2 size={16} /> {connection.readinessStatus === "CONNECTED_LIMITED" ? "Connected with limitations" : "Connected"}</span>}</div>
    {query.isPending && <p role="status">Loading WhatsApp status…</p>}
    {query.isError && <p role="alert">{query.error.message}</p>}
    {data?.configuration.mode === "disabled" && <p className="form-alert">WhatsApp is disabled for this deployment. Configure the server before connecting Meta.</p>}
    {data && !data.configuration.embeddedSignupReady && data.configuration.mode !== "disabled" && <p className="form-alert">Meta Embedded Signup configuration is incomplete on the server.</p>}
    {connection ? <div className="whatsapp-connection-card">
      <div><strong>{connection.verifiedName || "WhatsApp Business"}</strong><p>{connection.displayPhoneNumber || "Phone number pending"} · {(connection.readinessStatus || connection.status).toLowerCase().replaceAll("_", " ")}</p></div>
      <dl><div><dt>Connection</dt><dd>{connection.connectionMode === "COEXISTENCE" ? "Existing Business app" : "Separate API number"}</dd></div><div><dt>Outbound</dt><dd>{connection.outboundPaused ? "Paused" : "Enabled"}</dd></div><div><dt>Quality</dt><dd>{connection.qualityRating || "Not reported"}</dd></div><div><dt>Templates</dt><dd>{connection.lastTemplateSyncAt ? "Synced" : "Not synced"}</dd></div><div><dt>History</dt><dd>{(connection.synchronizationStatus || "not started").toLowerCase().replaceAll("_", " ")}</dd></div></dl>
      {connection.pauseReason && <p className="subtle">{connection.pauseReason}</p>}
      {connection.capabilities?.limitations?.map((limitation) => <p className="form-alert" key={limitation}>{limitation}</p>)}
      {connection.diagnosticReference && <small>Diagnostic reference: {connection.diagnosticReference}</small>}
    </div> : <p>No WhatsApp sender is connected to this business.</p>}
    <div className="whatsapp-onboarding-options">
      <article className="whatsapp-onboarding-option primary">
        <Smartphone size={24} />
        <div><h3>Connect existing WhatsApp Business</h3><p>Use the WhatsApp Business number your gym already uses. Continue chatting from your phone while GETFIT4U sends automated updates. Meta eligibility requirements apply.</p></div>
        <button className="btn btn-primary" disabled={busy || !data?.configuration.coexistenceReady} onClick={() => { setError(""); setNotice(""); begin.mutate("COEXISTENCE"); }}><Link2 size={17} />Connect existing number</button>
      </article>
      {!data?.configuration.coexistenceEnabled && <p className="subtle">Existing-number onboarding is currently disabled for this deployment. Existing connections are not affected.</p>}
      <article className="whatsapp-onboarding-option">
        <PlusCircle size={24} />
        <div><h3>Set up a separate business number</h3><p>Use Meta’s standard Cloud API onboarding when your gym intentionally wants a dedicated API number.</p></div>
        <button className="btn btn-secondary" disabled={busy || !data?.configuration.embeddedSignupReady} onClick={() => { setError(""); setNotice(""); begin.mutate("STANDARD"); }}>Set up separate number</button>
      </article>
    </div>
    <details className="whatsapp-personal-help"><summary><CircleHelp size={17} /> I currently use personal WhatsApp</summary><div><p>This connection option requires the WhatsApp Business app. If you choose to move, use WhatsApp’s owner-controlled in-app transition and make a current encrypted backup first.</p><p>GETFIT4U never asks for your WhatsApp password, Web session cookies or backup. It does not automatically migrate, delete or recreate your account, and switching apps does not guarantee immediate Meta eligibility.</p><a href="https://faq.whatsapp.com/3059780464322392/" target="_blank" rel="noreferrer">Open official WhatsApp Business guidance</a></div></details>
    {progress?.status === "AWAITING_PHONE_SELECTION" && <form className="whatsapp-phone-selection" onSubmit={(event) => { event.preventDefault(); if (selectedPhoneNumberId) submitPartial({ selectedPhoneNumberId }); }}>
      <label className="field"><span>Confirm the number connected in Meta</span><select className="input" value={selectedPhoneNumberId} onChange={(event) => setSelectedPhoneNumberId(event.target.value)} required><option value="">Select an authorised number</option>{progress.candidates?.map((candidate) => <option value={candidate.phoneNumberId} key={candidate.phoneNumberId}>{candidate.verifiedName || "WhatsApp Business"} · {candidate.displayPhoneNumber || `ending ${candidate.phoneNumberId.slice(-4)}`}</option>)}</select></label>
      <button className="btn btn-primary" disabled={busy || !selectedPhoneNumberId}>Confirm number</button>
    </form>}
    <div className="heading-actions">
      {connection && <><button className="btn btn-secondary" disabled={busy} onClick={() => action.mutate({ path: "/api/v1/whatsapp/connection/check" })}><RefreshCw size={17} />Check connection</button><button className="btn btn-secondary" disabled={busy} onClick={() => action.mutate({ path: "/api/v1/whatsapp/templates/sync" })}>Sync templates</button><button className="btn btn-secondary" disabled={busy || !connection.lastTemplateSyncAt} onClick={() => action.mutate({ path: "/api/v1/whatsapp/connection/outbound", method: "PATCH", body: { paused: !connection.outboundPaused } })}><PauseCircle size={17} />{connection.outboundPaused ? "Enable outbound" : "Pause outbound"}</button><button className="btn btn-ghost" disabled={busy} onClick={() => { if (window.confirm("Disconnect this WhatsApp sender? Queued messages will be cancelled.")) action.mutate({ path: "/api/v1/whatsapp/connection", method: "DELETE", body: { reason: "Disconnected from application settings." } }); }}><Unlink size={17} />Disconnect</button></>}
    </div>
    <small>Mode: {data?.configuration.mode || "unknown"} · Embedded Signup: {data?.configuration.embeddedSignupVersion || "unknown"} · Graph API: {data?.configuration.graphApiVersion || "unknown"} · Webhook: {data?.configuration.webhookReady ? "configured" : "not configured"}</small>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {connection?.status === "CONNECTED" && <details className="whatsapp-controls"><summary>Delivery controls and automated events</summary><form className="page-stack" onSubmit={(event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const enabledEvents = values.getAll("enabledEvents").map(String);
      action.mutate({ path: "/api/v1/whatsapp/connection/controls", method: "PATCH", body: {
        disabledEvents: automatedEvents.filter((name) => !enabledEvents.includes(name)),
        dailyMessages: Number(values.get("dailyMessages")), monthlyMessages: Number(values.get("monthlyMessages")),
        recipientPerDay: Number(values.get("recipientPerDay")), campaignMessages: Number(values.get("campaignMessages")),
        concurrentSends: Number(values.get("concurrentSends")), quietHoursStart: String(values.get("quietHoursStart")),
        quietHoursEnd: String(values.get("quietHoursEnd")), timezone: String(values.get("timezone")),
        estimatedMonthlyBudgetMinor: Math.round(Number(values.get("estimatedMonthlyBudget")) * 100),
      } });
    }}>
      <div className="form-grid">{[
        ["dailyMessages", "Daily message cap", connection.limits?.dailyMessages ?? 500, 1],
        ["monthlyMessages", "Monthly message cap", connection.limits?.monthlyMessages ?? 10000, 1],
        ["recipientPerDay", "Per-recipient daily cap", connection.limits?.recipientPerDay ?? 5, 1],
        ["campaignMessages", "Per-campaign cap", connection.limits?.campaignMessages ?? 250, 1],
        ["concurrentSends", "Concurrent send cap", connection.limits?.concurrentSends ?? 5, 1],
        ["estimatedMonthlyBudget", "Estimated monthly budget (INR warning)", (connection.limits?.estimatedMonthlyBudgetMinor ?? 0) / 100, 0],
      ].map(([name, label, value, min]) => <label className="field" key={String(name)}><span>{label}</span><input className="input" name={String(name)} type="number" min={Number(min)} step={name === "estimatedMonthlyBudget" ? ".01" : "1"} defaultValue={Number(value)} required /></label>)}</div>
      <div className="form-grid"><label className="field"><span>Quiet hours start</span><input className="input" name="quietHoursStart" type="time" defaultValue={connection.limits?.quietHoursStart || "21:00"} required /></label><label className="field"><span>Quiet hours end</span><input className="input" name="quietHoursEnd" type="time" defaultValue={connection.limits?.quietHoursEnd || "08:00"} required /></label><label className="field"><span>IANA timezone</span><input className="input" name="timezone" defaultValue={connection.limits?.timezone || "Asia/Kolkata"} required /></label></div>
      <p className="subtle">Budget is an operator warning only; provider charges are not inferred from queued messages. Caps, quiet hours, consent and template state are rechecked at dispatch.</p>
      <fieldset className="whatsapp-event-grid"><legend>Automated transactional events</legend>{automatedEvents.map((name) => <label key={name}><input type="checkbox" name="enabledEvents" value={name} defaultChecked={!connection.eventPreferences?.disabledEvents?.includes(name)} /> {name.replaceAll(".", " ").replaceAll("_", " ")}</label>)}</fieldset>
      <button className="btn btn-secondary" disabled={busy}>Save delivery controls</button>
    </form></details>}
    {connection?.status === "CONNECTED" && <WhatsAppCampaignPanel />}
  </section>;
}
