import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText } from "lucide-react";
import { apiRequest, type ApiEnvelope } from "../services/apiClient";
import "../styles/whatsapp.css";

type BusinessPreference = {
  connectionId: string;
  businessName: string;
  sender: string;
  service: boolean;
  marketing: boolean;
};
type Preferences = { verifiedPhone: string | null; businesses: BusinessPreference[] };

function WhatsAppPreferenceRow({ value }: { value: BusinessPreference }) {
  const client = useQueryClient();
  const [service, setService] = useState(value.service);
  const [marketing, setMarketing] = useState(value.marketing);
  useEffect(() => { setService(value.service); setMarketing(value.marketing); }, [value.service, value.marketing]);
  const save = useMutation({
    mutationFn: () => apiRequest("/api/v1/whatsapp/preferences", {
      method: "PUT",
      body: JSON.stringify({ connectionId: value.connectionId, service, marketing }),
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["whatsapp-preferences"] }),
  });
  return <article className="whatsapp-preference-card">
    <div><strong>{value.businessName}</strong><p className="subtle">Sender: {value.sender}</p></div>
    <label><input type="checkbox" checked={service} onChange={(event) => setService(event.target.checked)} /> Service updates about memberships, bookings, payments and support</label>
    <label><input type="checkbox" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} /> Optional promotions and marketing</label>
    <p className="subtle">You can withdraw either choice at any time. Disabling marketing does not affect your account or purchases.</p>
    <button className="btn btn-secondary" disabled={save.isPending || (service === value.service && marketing === value.marketing)} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save WhatsApp choices"}</button>
    {save.isError && <p role="alert">{save.error.message}</p>}
    {save.isSuccess && <p role="status">WhatsApp choices saved.</p>}
  </article>;
}

export function WhatsAppPreferences() {
  const query = useQuery({
    queryKey: ["whatsapp-preferences"],
    queryFn: () => apiRequest<ApiEnvelope<Preferences>>("/api/v1/whatsapp/preferences"),
  });
  const data = query.data?.data;
  return <section className="panel account-personal page-stack whatsapp-preferences">
    <div className="page-heading"><div><h2>WhatsApp messages</h2><p>Choose which verified businesses may contact your registered WhatsApp number.</p></div><MessageSquareText aria-hidden="true" /></div>
    {query.isPending && <p role="status">Loading WhatsApp choices…</p>}
    {query.isError && <p role="alert">{query.error.message}</p>}
    {data && !data.verifiedPhone && <p className="form-alert">Verify an international phone number on your account before enabling WhatsApp messages.</p>}
    {data?.verifiedPhone && <p>Verified number: <strong>{data.verifiedPhone}</strong></p>}
    {data?.businesses.map((business) => <WhatsAppPreferenceRow key={business.connectionId} value={business} />)}
    {data && !data.businesses.length && <p>No connected GETFIT4U or gym WhatsApp senders are available to your account yet.</p>}
  </section>;
}
