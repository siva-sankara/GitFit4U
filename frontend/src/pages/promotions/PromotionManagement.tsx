import { PageHeader } from "../../components/PageHeader";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { Modal } from "../../components/Modal";
import { MediaImageEditor } from "../../components/MediaImageEditor";
import { StatusBadge } from "../../components/StatusBadge";
import { offerLabel } from "../../components/PromotionPlacement";
import "../../styles/promotions.css";
type Row = Record<string, any>;
const localDate = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
export function PromotionManagement({ kind, admin = false }: { kind: "offers" | "ads"; admin?: boolean }) {
  const path = `/api/v1/${admin ? "admin/promotions" : "owner"}/${kind}`;
  const [page, setPage] = useState(1), [editing, setEditing] = useState<Row | null>(null), [gym, setGym] = useState<Row | null>(null), [search, setSearch] = useState("");
  const [discountKind, setDiscountKind] = useState("FIXED"), [ctaTarget, setCtaTarget] = useState("GYM");
  const [photo, setPhoto] = useState<{ id: string | null; url?: string }>(), [uploading, setUploading] = useState(false);
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["api", path, page], queryFn: () => apiRequest<ApiEnvelope<Row[]>>(`${path}?page=${page}&limit=12`) });
  const gyms = useQuery({ queryKey: ["promotion-gyms", search], queryFn: () => apiRequest<ApiEnvelope<Row[]>>(`/api/v1/workspace/records/gyms?limit=30&q=${encodeURIComponent(search)}`), enabled: admin && !!editing });
  const plansPath = admin ? `/api/v1/admin/gyms/${gym?.publicId || ""}/plans` : "/api/v1/owner/plans";
  const plans = useQuery({ queryKey: ["api", plansPath], queryFn: () => apiRequest<ApiEnvelope<Row[]>>(plansPath), enabled: !!editing && (!admin || !!gym?.publicId) });
  const offersPath = admin ? `/api/v1/admin/promotions/offers?gymId=${gym?._id || ""}&limit=100` : "/api/v1/owner/offers?limit=100";
  const offers = useQuery({ queryKey: ["api", offersPath], queryFn: () => apiRequest<ApiEnvelope<Row[]>>(offersPath), enabled: !!editing && kind === "ads" && (!admin || !!gym?._id) });
  const save = useMutation({ mutationFn: (body: object) => apiRequest(path + (editing?.publicId ? `/${editing.publicId}` : ""), { method: editing?.publicId ? "PATCH" : "POST", body: JSON.stringify(body) }), onSuccess: () => { setEditing(null); void client.invalidateQueries({ queryKey: ["api"] }); void client.invalidateQueries({ queryKey: ["promotions"] }); } });
  function open(row: Row) { save.reset(); setPhoto(undefined); setUploading(false); setGym(row.gymId?._id ? row.gymId : null); setDiscountKind(row.discount?.kind || "FIXED"); setCtaTarget(row.ctaTarget || "GYM"); setEditing(row); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (uploading || save.isPending) return;
    const data = new FormData(event.currentTarget), text = (key: string) => String(data.get(key) || "").trim();
    const body: Row = { name: text("name"), description: text("description"), startsAt: new Date(text("startsAt")).toISOString(), endsAt: new Date(text("endsAt")).toISOString(), status: text("status"), ...(admin ? { gymId: gym?._id } : {}) };
    if (kind === "offers") Object.assign(body, {
      code: text("code") || undefined, type: text("type"), terms: text("terms"), minimumPurchaseMinor: Math.round(Number(text("minimum")) * 100),
      perUserLimit: Number(text("perUserLimit") || 1), redemptionLimit: text("redemptionLimit") ? Number(text("redemptionLimit")) : null,
      applicablePlanIds: data.getAll("planIds"), discount: discountKind === "PERCENT" ? { kind: "PERCENT", percentageBasisPoints: Math.round(Number(text("discount")) * 100) } : { kind: "FIXED", amountMinor: Math.round(Number(text("discount")) * 100) },
    });
    else Object.assign(body, { budgetMinor: Math.round(Number(text("budget")) * 100), placements: data.getAll("placements"), audience: { kind: text("audience") }, ctaTarget, ctaLabel: text("ctaLabel"), ...(ctaTarget === "EXTERNAL" ? { ctaUrl: text("ctaUrl") } : {}), offerId: ctaTarget === "OFFER" ? text("offerId") : null, ...(photo ? { creativeAttachmentId: photo.id } : editing?.creativeAttachmentId ? { creativeAttachmentId: editing.creativeAttachmentId } : {}) });
    save.mutate(body);
  }
  const title = kind === "offers" ? "Offers" : "Advertisements";
  return <div className="page-stack"><PageHeader><div><span className="eyebrow">Gym promotions</span><h1>{title}</h1><p>{kind === "offers" ? "Real checkout discounts, with eligibility and usage limits." : "Publish targeted gym promotions with working actions."}</p></div><button className="btn btn-primary" onClick={() => open({})}>Create {kind === "offers" ? "offer" : "advertisement"}</button></PageHeader>
    {query.isPending ? <p role="status">Loading promotions…</p> : query.isError ? <div role="alert"><p>{query.error.message}</p><button className="btn btn-secondary" onClick={() => void query.refetch()}>Retry</button></div> : <>
      <div className="promotion-grid">{query.data?.data.map(row => <article className="panel promotion-card" key={row.publicId}>{row.imageUrl && <img className="promotion-preview" src={row.imageUrl} alt="Advertisement preview" />}<div className="promotion-card-heading"><h2>{row.name}</h2><StatusBadge status={row.effectiveStatus || row.status} /></div><p>{row.description}</p>{admin && <small>{row.gymId?.name}</small>}<small>{new Date(row.startsAt).toLocaleDateString()} – {new Date(row.endsAt).toLocaleDateString()}</small>{kind === "offers" ? <><strong>{offerLabel(row)}</strong><small>Code: {row.code || row.publicId} · Completed uses: {row.redemptionCount || 0}</small></> : <small>{(row.placements || ["GYM_PROFILE"]).join(" · ")} · {row.audience?.kind === "GYM_MEMBERS" ? "Gym members" : "All visitors"}</small>}<button className="btn btn-secondary" onClick={() => open(row)}>Edit / change status</button></article>)}</div>
      {!query.data?.data.length && <div className="panel state-card">No {title.toLowerCase()} yet. Create your first promotion.</div>}
      <nav className="promotion-pagination" aria-label="Promotion pages"><button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {query.data?.meta?.pages || 1}</span><button className="btn btn-secondary" disabled={page >= (query.data?.meta?.pages || 1)} onClick={() => setPage(page + 1)}>Next</button></nav>
    </>}
    <Modal open={!!editing} title={`${editing?.publicId ? "Edit" : "Create"} ${kind === "offers" ? "offer" : "advertisement"}`} onClose={() => { if (!uploading && !save.isPending) setEditing(null); }} wide>
      {editing && <form className="promotion-form" onSubmit={submit}>
        {admin && <fieldset className="promotion-wide"><legend>Gym</legend><label>Search gyms<input value={search} onChange={event => setSearch(event.target.value)} disabled={!!editing.publicId} /></label><select aria-label="Gym" value={gym?._id || ""} required disabled={!!editing.publicId} onChange={event => { setGym(gyms.data?.data.find(row => row._id === event.target.value) || null); setPhoto(undefined); }}><option value="">Select a gym</option>{gym && !gyms.data?.data.some(row => row._id === gym._id) && <option value={gym._id}>{gym.name}</option>}{gyms.data?.data.map(row => <option key={row._id} value={row._id}>{row.name}</option>)}</select>{gyms.isError && <p role="alert">{gyms.error.message}</p>}</fieldset>}
        <label>Title<input name="name" required minLength={2} maxLength={160} defaultValue={editing.name} /></label><label>Status<select name="status" defaultValue={editing.status === "ENDED" ? "EXPIRED" : editing.status || "DRAFT"}>{["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "EXPIRED", "ARCHIVED"].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Starts<input name="startsAt" type="datetime-local" required defaultValue={localDate(editing.startsAt)} /></label><label>Ends<input name="endsAt" type="datetime-local" required defaultValue={localDate(editing.endsAt)} /></label>
        <label className="promotion-wide">Description<textarea name="description" maxLength={3000} defaultValue={editing.description} /></label>
        {kind === "offers" ? <>
          <label>Offer code<input name="code" maxLength={30} pattern="[a-zA-Z0-9_-]+" defaultValue={editing.code} placeholder="Optional custom code" /></label><label>Eligibility<select name="type" defaultValue={editing.type || "DISCOUNT"}>{["DISCOUNT", "NEW_MEMBER", "FESTIVAL", "REFERRAL", "FIRST_MONTH"].map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Discount type<select value={discountKind} onChange={event => setDiscountKind(event.target.value)}><option value="FIXED">Fixed amount (INR)</option><option value="PERCENT">Percentage</option></select></label><label>{discountKind === "PERCENT" ? "Discount (%)" : "Discount (INR)"}<input key={discountKind} name="discount" type="number" step="0.01" min="0.01" max={discountKind === "PERCENT" ? 100 : undefined} required defaultValue={discountKind === "PERCENT" ? Number(editing.discount?.percentageBasisPoints || 0) / 100 : Number(editing.discount?.amountMinor || 0) / 100} /></label>
          <label>Minimum plan price (INR)<input name="minimum" type="number" min="0" step="0.01" defaultValue={Number(editing.minimumPurchaseMinor || 0) / 100} /></label><label>Uses per member<input name="perUserLimit" type="number" min="1" max="100" required defaultValue={editing.perUserLimit || 1} /></label><label>Total usage limit<input name="redemptionLimit" type="number" min="1" defaultValue={editing.redemptionLimit || ""} placeholder="Unlimited" /></label>
          <fieldset className="promotion-wide"><legend>Applicable plans (none selected = all plans)</legend>{plans.isPending ? <p>Loading plans…</p> : plans.isError ? <p role="alert">{plans.error.message}</p> : plans.data?.data.map(plan => <label className="promotion-check" key={`${gym?._id || "owner"}-${plan._id}`}><input type="checkbox" name="planIds" value={plan._id} defaultChecked={editing.applicablePlanIds?.includes(plan._id)} />{plan.name}</label>)}</fieldset>
          <label className="promotion-wide">Terms<textarea name="terms" maxLength={3000} defaultValue={editing.terms} /></label><small className="promotion-wide">One offer per checkout. Offer discounts apply after any plan discount, before tax. Pending payments reserve uses; refunds do not restore uses. Online totals must be at least INR 1.</small>
        </> : <>
          <div className="promotion-wide"><MediaImageEditor purpose="AD" label="Banner image" gymId={admin ? gym?._id : undefined} disabled={save.isPending || (admin && !gym)} previewUrl={photo ? photo.url : editing.imageUrl} onBusyChange={setUploading} onChange={(id, url) => setPhoto({ id, url })} /></div>
          <fieldset className="promotion-wide"><legend>Display locations</legend>{["EXPLORE", "DASHBOARD", "GYM_PROFILE"].map(value => <label className="promotion-check" key={value}><input type="checkbox" name="placements" value={value} defaultChecked={(editing.placements?.length ? editing.placements : ["GYM_PROFILE"]).includes(value)} />{value.replaceAll("_", " ")}</label>)}</fieldset>
          <label>Audience<select name="audience" defaultValue={editing.audience?.kind || "ALL"}><option value="ALL">All visitors</option><option value="GYM_MEMBERS">This gym's members</option></select></label><label>Budget reference (INR)<input name="budget" type="number" min="0" step="0.01" defaultValue={Number(editing.budgetMinor || 0) / 100} /></label>
          <label>Action label<input name="ctaLabel" required maxLength={60} defaultValue={editing.ctaLabel || "View gym"} /></label><label>Action<select value={ctaTarget} onChange={event => setCtaTarget(event.target.value)}><option value="GYM">View gym</option><option value="PLANS">View membership plans</option><option value="OFFER">View gym offer</option><option value="EXTERNAL">External HTTPS link</option></select></label>
          {ctaTarget === "OFFER" && <label className="promotion-wide">Offer<select name="offerId" required defaultValue={editing.offerId || ""}><option value="">Select offer</option>{offers.data?.data.map(offer => <option key={offer._id} value={offer._id}>{offer.name}</option>)}</select>{offers.isError && <span role="alert">{offers.error.message}</span>}</label>}
          {ctaTarget === "EXTERNAL" && <label className="promotion-wide">HTTPS destination<input name="ctaUrl" type="url" required defaultValue={editing.ctaUrl} placeholder="https://" /></label>}
          <small className="promotion-wide">Scheduled promotions become eligible when their start time arrives. Expired and paused promotions stay hidden. Budget is a planning reference, not an automatic charge.</small>
        </>}
        {save.isError && <p className="promotion-wide" role="alert">{save.error.message}</p>}
        <button className="btn btn-primary promotion-wide" disabled={save.isPending || uploading || (admin && !gym) || (kind === "offers" && (plans.isPending || plans.isError))}>{uploading ? "Uploading image…" : save.isPending ? "Saving…" : "Save promotion"}</button>
      </form>}
    </Modal>
  </div>;
}
