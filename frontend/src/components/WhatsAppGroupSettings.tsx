import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../api/hooks";
import { apiRequest, type ApiEnvelope } from "../services/apiClient";
import { navigationSessionScope } from "../services/navigationSession";

type Group = { name: string; inviteLink: string };
const endpoint = "/api/v1/owner/communication/whatsapp-group";

export function WhatsAppGroupSettings({ disabled = false }: { disabled?: boolean }) {
  const me = useCurrentUser();
  const context = me.data?.data.context;
  const scope = navigationSessionScope(context) || `${context?.userId}:${context?.gymId}`;
  const query = useQuery({
    queryKey: ["whatsapp-group", scope],
    queryFn: ({ signal }) => apiRequest<ApiEnvelope<Group>>(endpoint, { signal }),
    enabled: context?.role === "GYM_OWNER" && Boolean(context.gymId),
  });
  return <section className="panel form-section page-stack gym-whatsapp-group-settings">
    <h2>WhatsApp member group</h2>
    <p>Create your group in WhatsApp, then copy its invite link here. Members join using the invitation you send.</p>
    {query.isPending && <p role="status">Loading group settings…</p>}
    {query.isError && <><p role="alert">{query.error.message}</p><button className="btn btn-secondary" onClick={() => void query.refetch()}>Retry group settings</button></>}
    {query.data && <GroupForm key={scope} initial={query.data.data} scope={scope} disabled={disabled} />}
  </section>;
}
function GroupForm({ initial, scope, disabled }: { initial: Group; scope: string; disabled: boolean }) {
  const [group, setGroup] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const client = useQueryClient();
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true); setError(""); setSaved(false);
    try {
      const response = await apiRequest<ApiEnvelope<Group>>(endpoint, { method: "PATCH", body: JSON.stringify(group) });
      setGroup(response.data); setSaved(true);
      delete form.dataset.unsavedChanges;
      client.setQueryData(["whatsapp-group", scope], response);
      void client.invalidateQueries({ queryKey: ["manual-whatsapp-members", scope] });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save group settings."); }
    finally { setSaving(false); }
  }
  return <form className="page-stack" onSubmit={save}>
    <fieldset disabled={disabled || saving} className="profile-fieldset page-stack">
      <label className="field"><span>WhatsApp Group Name</span><input className="input" value={group.name} maxLength={100} onChange={event => { setSaved(false); setGroup({ ...group, name: event.target.value }); }} /></label>
      <label className="field"><span>WhatsApp Group Invite Link</span><input className="input" type="url" placeholder="https://chat.whatsapp.com/…" value={group.inviteLink} maxLength={300} onChange={event => { setSaved(false); setGroup({ ...group, inviteLink: event.target.value }); }} /></label>
      <p>Clear both fields and save to remove the stored group.</p>
      <button type="submit" className="btn btn-primary">{saving ? "Saving…" : "Save WhatsApp group"}</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">WhatsApp group saved.</p>}
  </form>;
}
