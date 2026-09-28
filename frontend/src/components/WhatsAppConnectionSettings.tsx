import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Link2, PauseCircle, RefreshCw, Unlink } from "lucide-react";
import { apiRequest, type ApiEnvelope } from "../services/apiClient";
import { WhatsAppCampaignPanel } from "./WhatsAppCampaignPanel";
import "../styles/whatsapp.css";

type Connection = {
  publicId: string;
  verifiedName?: string;
  displayPhoneNumber?: string;
  status: string;
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
    webhookReady: boolean;
  };
  connection: Connection | null;
};
type Signup = {
  onboardingSessionId: string;
  state: string;
  appId: string;
  configId: string;
  graphApiVersion: string;
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
  const signup = useRef<Signup | null>(null);
  const result = useRef<{ code?: string; wabaId?: string; phoneNumberId?: string }>({});
  const query = useQuery({
    queryKey: ["whatsapp-connection"],
    queryFn: () => apiRequest<ApiEnvelope<ConnectionState>>("/api/v1/whatsapp/connection"),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["whatsapp-connection"] });

  const complete = useMutation({
    mutationFn: async () => {
      const active = signup.current;
      const value = result.current;
      if (!active || !value.code || !value.wabaId || !value.phoneNumberId) return;
      return apiRequest("/api/v1/whatsapp/onboarding/complete", {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: JSON.stringify({
          onboardingSessionId: active.onboardingSessionId,
          state: active.state,
          code: value.code,
          wabaId: value.wabaId,
          phoneNumberId: value.phoneNumberId,
        }),
      });
    },
    onSuccess: (data) => {
      if (!data) return;
      setNotice("WhatsApp is connected. Sync approved templates before enabling delivery.");
      signup.current = null;
      result.current = {};
      void refresh();
    },
    onError: (failure) => setError(failure.message),
  });
  const tryComplete = () => {
    if (result.current.code && result.current.wabaId && result.current.phoneNumberId && !complete.isPending)
      complete.mutate();
  };
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!["https://www.facebook.com", "https://web.facebook.com"].includes(event.origin)) return;
      let payload: any = event.data;
      try { if (typeof payload === "string") payload = JSON.parse(payload); } catch { return; }
      if (payload?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (payload.event === "FINISH") {
        result.current.wabaId = String(payload.data?.waba_id || "");
        result.current.phoneNumberId = String(payload.data?.phone_number_id || "");
        tryComplete();
      } else if (["CANCEL", "ERROR"].includes(payload.event)) {
        setError(payload.event === "CANCEL" ? "Meta sign-up was cancelled." : "Meta could not complete sign-up.");
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  });

  const begin = useMutation({
    mutationFn: async () => {
      const response = await apiRequest<ApiEnvelope<Signup>>("/api/v1/whatsapp/onboarding/start", { method: "POST", body: "{}" });
      signup.current = response.data;
      result.current = {};
      const fb = await loadFacebookSdk(response.data.appId, response.data.graphApiVersion);
      fb.login((login: any) => {
        const code = login?.authResponse?.code;
        if (!code) {
          setError("Meta did not return an authorization code. Start the connection again.");
          return;
        }
        result.current.code = String(code);
        tryComplete();
      }, {
        config_id: response.data.configId,
        response_type: "code",
        override_default_response_type: true,
        state: response.data.state,
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
      });
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
    <div className="page-heading"><div><h2>WhatsApp Business</h2><p>Connect the sender owned by this business. Credentials stay on the server and are never shown here.</p></div>{connection?.status === "CONNECTED" && <span className="chip"><CheckCircle2 size={16} /> Connected</span>}</div>
    {query.isPending && <p role="status">Loading WhatsApp status…</p>}
    {query.isError && <p role="alert">{query.error.message}</p>}
    {data?.configuration.mode === "disabled" && <p className="form-alert">WhatsApp is disabled for this deployment. Configure the server before connecting Meta.</p>}
    {data && !data.configuration.embeddedSignupReady && data.configuration.mode !== "disabled" && <p className="form-alert">Meta Embedded Signup configuration is incomplete on the server.</p>}
    {connection ? <div className="whatsapp-connection-card">
      <div><strong>{connection.verifiedName || "WhatsApp Business"}</strong><p>{connection.displayPhoneNumber || "Phone number pending"} · {connection.status}</p></div>
      <dl><div><dt>Outbound</dt><dd>{connection.outboundPaused ? "Paused" : "Enabled"}</dd></div><div><dt>Quality</dt><dd>{connection.qualityRating || "Not reported"}</dd></div><div><dt>Templates</dt><dd>{connection.lastTemplateSyncAt ? "Synced" : "Not synced"}</dd></div></dl>
      {connection.pauseReason && <p className="subtle">{connection.pauseReason}</p>}
    </div> : <p>No WhatsApp sender is connected to this business.</p>}
    <div className="heading-actions">
      <button className="btn btn-primary" disabled={busy || !data?.configuration.embeddedSignupReady} onClick={() => { setError(""); setNotice(""); begin.mutate(); }}><Link2 size={17} />{connection ? "Reconnect" : "Connect with Meta"}</button>
      {connection && <><button className="btn btn-secondary" disabled={busy} onClick={() => action.mutate({ path: "/api/v1/whatsapp/connection/check" })}><RefreshCw size={17} />Check connection</button><button className="btn btn-secondary" disabled={busy} onClick={() => action.mutate({ path: "/api/v1/whatsapp/templates/sync" })}>Sync templates</button><button className="btn btn-secondary" disabled={busy || !connection.lastTemplateSyncAt} onClick={() => action.mutate({ path: "/api/v1/whatsapp/connection/outbound", method: "PATCH", body: { paused: !connection.outboundPaused } })}><PauseCircle size={17} />{connection.outboundPaused ? "Enable outbound" : "Pause outbound"}</button><button className="btn btn-ghost" disabled={busy} onClick={() => { if (window.confirm("Disconnect this WhatsApp sender? Queued messages will be cancelled.")) action.mutate({ path: "/api/v1/whatsapp/connection", method: "DELETE", body: { reason: "Disconnected from application settings." } }); }}><Unlink size={17} />Disconnect</button></>}
    </div>
    <small>Mode: {data?.configuration.mode || "unknown"} · Graph API: {data?.configuration.graphApiVersion || "unknown"} · Webhook: {data?.configuration.webhookReady ? "configured" : "not configured"}</small>
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
