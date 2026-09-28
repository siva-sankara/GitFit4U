import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { useCurrentUser } from "../api/hooks";
import { apiRequest, type ApiEnvelope } from "../services/apiClient";

type Template = { name: string; language: string; category: string; status: string; components?: unknown };
type Preview = { totalAudience: number; withVerifiedContact: number; eligibleNow: number; suppressedNow: number; campaignCap: number; billingNotice: string };
type Campaign = { publicId: string; name: string; templateId: string; status: string; scheduledAt?: string; analytics?: Record<string, number> };

export function WhatsAppCampaignPanel() {
  const me = useCurrentUser();
  const allowed = me.data?.data.context?.permissions.some((permission) => ["campaign:write", "admin:platform"].includes(permission));
  const admin = me.data?.data.context?.role === "ADMIN";
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [roles, setRoles] = useState<string[]>(admin ? ["GYM_OWNER"] : ["USER"]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const templates = useQuery({
    queryKey: ["whatsapp-templates"], enabled: Boolean(allowed),
    queryFn: () => apiRequest<ApiEnvelope<Template[]>>("/api/v1/whatsapp/templates"),
  });
  const campaigns = useQuery({
    queryKey: ["whatsapp-campaigns"], enabled: Boolean(allowed),
    queryFn: () => apiRequest<ApiEnvelope<Campaign[]>>("/api/v1/whatsapp/campaigns"),
  });
  const selected = (templates.data?.data || []).find((template) => `${template.name}:${template.language}` === templateKey);
  const payload = () => ({ templateName: selected!.name, language: selected!.language, roles });
  const previewMutation = useMutation({
    mutationFn: () => apiRequest<ApiEnvelope<Preview>>("/api/v1/whatsapp/campaigns/preview", { method: "POST", body: JSON.stringify(payload()) }),
    onSuccess: (response) => setPreview(response.data),
  });
  const create = useMutation({
    mutationFn: () => apiRequest("/api/v1/whatsapp/campaigns", {
      method: "POST", idempotencyKey: crypto.randomUUID(),
      body: JSON.stringify({ ...payload(), name, ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}), idempotencyKey: crypto.randomUUID(), confirmed: true }),
    }),
    onSuccess: () => { setName(""); setTemplateKey(""); setScheduledAt(""); setPreview(null); void client.invalidateQueries({ queryKey: ["whatsapp-campaigns"] }); },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/v1/whatsapp/campaigns/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["whatsapp-campaigns"] }),
  });
  if (!allowed) return null;
  const marketing = (templates.data?.data || []).filter((template) => template.status === "APPROVED" && template.category === "MARKETING" && !JSON.stringify(template.components || []).includes("{{"));
  const toggleRole = (role: string) => { setPreview(null); setRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role]); };
  return <section className="whatsapp-campaign-panel page-stack">
    <div className="page-heading"><div><h3><Megaphone size={18} /> Promotional campaigns</h3><p>Marketing consent, sender caps and template eligibility are checked again for every individual send.</p></div></div>
    <div className="form-grid">
      <label className="field"><span>Campaign name</span><input className="input" value={name} maxLength={120} onChange={(event) => { setName(event.target.value); setPreview(null); }} /></label>
      <label className="field"><span>Approved Marketing template</span><select className="input" value={templateKey} onChange={(event) => { setTemplateKey(event.target.value); setPreview(null); }}><option value="">Choose template</option>{marketing.map((template) => <option key={`${template.name}:${template.language}`} value={`${template.name}:${template.language}`}>{template.name} · {template.language}</option>)}</select></label>
      <label className="field"><span>Schedule (optional)</span><input className="input" type="datetime-local" value={scheduledAt} onChange={(event) => { setScheduledAt(event.target.value); setPreview(null); }} /></label>
    </div>
    {admin && <fieldset><legend>Audience roles</legend>{["USER", "GYM_OWNER", "TRAINER", "GYM_STAFF"].map((role) => <label key={role}><input type="checkbox" checked={roles.includes(role)} onChange={() => toggleRole(role)} /> {role.replaceAll("_", " ").toLowerCase()}</label>)}</fieldset>}
    <div className="heading-actions"><button className="btn btn-secondary" disabled={!name.trim() || !selected || !roles.length || previewMutation.isPending} onClick={() => previewMutation.mutate()}>{previewMutation.isPending ? "Checking…" : "Preview audience"}</button><button className="btn btn-primary" disabled={!preview?.eligibleNow || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Scheduling…" : "Confirm and schedule"}</button></div>
    {preview && <div className="whatsapp-campaign-preview" role="status"><strong>{preview.eligibleNow} eligible now</strong><span>{preview.suppressedNow} suppressed</span><span>{preview.withVerifiedContact} with verified contact</span><span>Campaign cap {preview.campaignCap}</span><small>{preview.billingNotice}</small></div>}
    {(previewMutation.isError || create.isError) && <p role="alert">{previewMutation.error?.message || create.error?.message}</p>}
    <div className="whatsapp-campaign-history"><h4>Campaign history</h4>{campaigns.data?.data.map((campaign) => <article key={campaign.publicId}><div><strong>{campaign.name}</strong><small>{campaign.templateId} · {campaign.status.toLowerCase().replaceAll("_", " ")}</small></div><span>{campaign.analytics?.sent || 0} sent · {campaign.analytics?.delivered || 0} delivered · {campaign.analytics?.read || 0} read · {campaign.analytics?.failed || 0} suppressed/failed</span>{["DRAFT", "SCHEDULED", "QUEUED", "PROCESSING"].includes(campaign.status) && <button className="btn btn-ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(campaign.publicId)}>Cancel</button>}</article>)}</div>
  </section>;
}
