import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../api/hooks";
import { apiRequest, type ApiEnvelope } from "../services/apiClient";
import { navigationSessionScope } from "../services/navigationSession";
import { detectedWhatsAppLinks, parseWhatsAppInvite } from "../services/whatsappInvite";
import { Modal } from "./Modal";
import "../styles/whatsapp-updates.css";

type Settings = { enabled: boolean; type: "group" | "channel"; displayName: string; inviteUrl: string; description: string; version?: number; qrId?: string | null; qrUrl?: string };
type Qr = { qrId: string; qrUrl: string; inviteUrl: string; type: Settings["type"] };
export function WhatsAppUpdatesSettings({ disabled = false, platform = false }: { disabled?: boolean; platform?: boolean }) {
  const context = useCurrentUser().data?.data.context;
  const scope = navigationSessionScope(context) || `${context?.userId}:${context?.gymId}`;
  const endpoint = platform ? "/api/v1/admin/settings/owners-whatsapp" : "/api/v1/owner/communication/whatsapp-updates";
  const query = useQuery({ queryKey: ["whatsapp-updates-settings", scope, endpoint], queryFn: ({ signal }) => apiRequest<ApiEnvelope<Settings>>(endpoint, { signal }),
    enabled: platform ? context?.role === "ADMIN" : context?.role === "GYM_OWNER" && Boolean(context.gymId), gcTime: 0 });
  return <section className="panel form-section page-stack gym-whatsapp-group-settings">
    <h2>{platform ? "GETFIT4U Gym Owners invitation" : "WhatsApp Group / Channel"}</h2>
    <p>{platform ? "Invite owners with a paid platform subscription. Gym members never receive this invitation." : "Offer paid members your gym’s invitation. This is separate from attendance QR and WhatsApp API settings."}</p>
    {query.isPending && <p role="status">Loading invitation settings…</p>}
    {query.isError && <><p role="alert">Could not load invitation settings.</p><button className="btn btn-secondary" onClick={() => void query.refetch()}>Retry</button></>}
    {query.data && <UpdatesForm key={`${scope}:${endpoint}`} initial={query.data.data} scope={scope} endpoint={endpoint} disabled={disabled} />}
  </section>;
}
function UpdatesForm({ initial, scope, endpoint, disabled }: { initial: Settings; scope: string; endpoint: string; disabled: boolean }) {
  const [settings, setSettings] = useState(initial), [saving, setSaving] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const [pendingQr, setPendingQr] = useState<Qr>();
  const [qrPreview, setQrPreview] = useState<string>();
  const client = useQueryClient();
  const parsed = parseWhatsAppInvite(settings.inviteUrl, settings.type);
  const candidates = detectedWhatsAppLinks(settings.inviteUrl);
  function update(patch: Partial<Settings>) {
    setQrPreview(undefined);
    setSettings(old => ({ ...old, ...patch, ...((patch.inviteUrl !== undefined && parseWhatsAppInvite(patch.inviteUrl).url !== parseWhatsAppInvite(old.inviteUrl).url) || (patch.type && patch.type !== old.type) ? { qrId: null, qrUrl: undefined } : {}) }));
    setNotice(""); setError("");
  }
  async function save(value: Settings, form?: HTMLFormElement) {
    if (saving || disabled) return;
    const link = parseWhatsAppInvite(value.inviteUrl, value.type);
    if ((value.enabled || value.inviteUrl) && link.error) { setError(link.error); return; }
    if (value.enabled && !value.displayName.trim()) { setError("Enter a display name."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const { enabled, type, displayName, description, qrId } = value;
      const response = await apiRequest<ApiEnvelope<Settings>>(endpoint, { method: "PATCH", body: JSON.stringify({ enabled, type, displayName, inviteUrl: link.url || "", description, ...(qrId !== undefined ? { qrId } : {}) }) });
      setSettings(response.data); setPendingQr(undefined);
      client.setQueryData(["whatsapp-updates-settings", scope, endpoint], response);
      void client.invalidateQueries({ queryKey: ["manual-whatsapp-members"] });
      if (form) delete form.dataset.unsavedChanges;
      setNotice(response.data.enabled ? "WhatsApp invitation saved." : "WhatsApp invitation disabled.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save invitation settings."); }
    finally { setSaving(false); }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 5_000_000 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setError("Choose a PNG, JPG or WebP image up to 5 MB."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const body = new FormData(); body.append("qr", file);
      const result = await apiRequest<ApiEnvelope<Qr>>(`${endpoint}/qr`, { method: "POST", body });
      const current = parseWhatsAppInvite(settings.inviteUrl, settings.type);
      if (!settings.inviteUrl.trim()) setPendingQr(result.data);
      else if (current.url !== result.data.inviteUrl) setError("The uploaded QR differs from the edited URL. Save the intended URL first, then upload its QR.");
      else { update({ qrId: result.data.qrId, qrUrl: result.data.qrUrl }); setNotice("QR decoded and matched. Save invitation to publish it."); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not validate QR."); }
    finally { setSaving(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void save(settings, event.currentTarget); }
  return <form className="page-stack" onSubmit={submit}>
    <fieldset className="profile-fieldset page-stack" disabled={disabled || saving}>
      <label><input type="checkbox" checked={settings.enabled} onChange={event => update({ enabled: event.target.checked })} /> Enable WhatsApp updates link</label>
      <div className="invitation-settings-grid">
        <label className="field"><span>Type</span><select className="select" value={settings.type} onChange={event => update({ type: event.target.value as Settings["type"] })}><option value="group">Group</option><option value="channel">Channel</option></select></label>
        <label className="field"><span>Display name</span><input className="input" maxLength={100} value={settings.displayName} onChange={event => update({ displayName: event.target.value })} /></label>
      </div>
      <label className="field"><span>Invitation / share URL</span><input className="input" type="text" maxLength={2000} value={settings.inviteUrl} placeholder={settings.type === "group" ? "https://chat.whatsapp.com/…" : "https://whatsapp.com/channel/…"} onChange={event => update({ inviteUrl: event.target.value })} /></label>
      {parsed.error && candidates.length > 0 && <div className="page-stack"><p>{candidates.length > 1 ? "Multiple links detected. Choose the invitation you intend to publish." : "Confirm the detected link from your share text."}</p>{candidates.map(url => <button className="btn btn-secondary invitation-detected" type="button" key={url} onClick={() => { const result = parseWhatsAppInvite(url); if (result.error) setError(result.error); else update({ inviteUrl: result.url, type: result.type }); }}>Use {url}</button>)}</div>}
      <label className="field"><span>Short introduction (optional)</span><textarea className="textarea" rows={2} maxLength={400} value={settings.description} onChange={event => update({ description: event.target.value })} /></label>
      <label className="field"><span>{settings.qrId ? "Replace invitation QR" : "Upload invitation QR"}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} /></label>
      <p className="subtle">One clear QR, PNG/JPG/WebP up to 5 MB. Save a changed URL before replacing its QR. The server checks its destination; it never opens the link.</p>
      {settings.qrUrl && <div><img className="invitation-qr" src={settings.qrUrl} alt="Matched invitation QR preview" referrerPolicy="no-referrer" /><div className="heading-actions"><button type="button" className="btn btn-secondary" onClick={() => setQrPreview(settings.qrUrl)}>Enlarge QR</button><button type="button" className="btn btn-secondary" onClick={() => update({ qrId: null, qrUrl: undefined })}>Remove uploaded QR</button></div></div>}
      {pendingQr && <div className="page-stack"><img className="invitation-qr" src={pendingQr.qrUrl} alt="Detected QR preview" referrerPolicy="no-referrer" /><button type="button" className="btn btn-secondary" onClick={() => setQrPreview(pendingQr.qrUrl)}>Enlarge QR</button><p>Detected invitation: {pendingQr.inviteUrl}</p><button type="button" className="btn btn-secondary" onClick={() => { update({ inviteUrl: pendingQr.inviteUrl, type: pendingQr.type }); setSettings(old => ({ ...old, qrId: pendingQr.qrId, qrUrl: pendingQr.qrUrl })); setPendingQr(undefined); }}>Use this detected invitation</button></div>}
      <div className="heading-actions"><button className="btn btn-primary" type="submit">{saving ? "Saving…" : "Save invitation"}</button><button className="btn btn-secondary" type="button" onClick={event => void save({ ...settings, enabled: false }, event.currentTarget.form || undefined)}>Disable</button><button className="btn btn-secondary" type="button" onClick={event => void save({ ...settings, enabled: false, inviteUrl: "", displayName: "", description: "", qrId: null }, event.currentTarget.form || undefined)}>Remove</button></div>
    </fieldset>
    <Modal open={Boolean(qrPreview)} title="WhatsApp invitation QR" onClose={() => setQrPreview(undefined)}>{qrPreview && <><img className="invitation-qr invitation-qr-large" src={qrPreview} alt="Enlarged invitation QR" referrerPolicy="no-referrer" /><a className="btn btn-secondary" href={qrPreview} target="_blank" rel="noopener noreferrer" download="whatsapp-invitation.png">Open image to download</a><p>This is a WhatsApp invitation, not an attendance QR.</p></>}</Modal>
    {parsed.url && <a className="btn btn-secondary" href={parsed.url} target="_blank" rel="noopener noreferrer">Open link to test</a>}
    <p className="subtle">Format checked only. GETFIT4U cannot verify joining or remove WhatsApp participants. Group members may see each other’s phone numbers. Disabling or replacing here cannot revoke forwarded links or QR images; reset the invitation in WhatsApp.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </form>;
}
