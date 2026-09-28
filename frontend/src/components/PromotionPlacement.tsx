import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { apiRequest, type ApiEnvelope } from "../services/apiClient";
import "../styles/promotions.css";
type Row = Record<string, any>;
const money = (minor: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(minor / 100);
export const offerLabel = (offer: Row) => offer.discount?.kind === "PERCENT" ? `${Number(offer.discount.percentageBasisPoints) / 100}% off` : `${money(Number(offer.discount?.amountMinor || 0))} off`;
export function GymOffers({ gymId, planId }: { gymId: string; planId?: string }) {
  const path = `/api/v1/public/promotions/offers?gymId=${encodeURIComponent(gymId)}${planId ? `&planId=${encodeURIComponent(planId)}` : ""}`;
  const query = useQuery({ queryKey: ["promotions", path], queryFn: () => apiRequest<ApiEnvelope<Row[]>>(path), refetchInterval: 60_000 });
  if (query.isPending) return <p className="promotion-notice" role="status">Checking current offers…</p>;
  if (query.isError) return <p className="promotion-notice" role="alert">Offers could not be loaded. <button className="btn btn-ghost" onClick={() => void query.refetch()}>Retry</button></p>;
  if (!query.data?.data.length) return null;
  return <section id="gym-offers" className="promotion-section" aria-label="Current gym offers"><h2>Current offers</h2><div className="promotion-grid">{query.data.data.map(offer => <article className="panel promotion-card" key={offer.publicId}>
    <span className="eyebrow">{offerLabel(offer)}</span><h3>{offer.name}</h3><p>{offer.description}</p>
    <p>Use code <strong className="promotion-code">{offer.code}</strong> at checkout.</p>
    <small>Valid until {new Date(offer.endsAt).toLocaleDateString()}. {offer.minimumPurchaseMinor > 0 && `Minimum plan price ${money(offer.minimumPurchaseMinor)}.`}</small>
    {offer.type === "NEW_MEMBER" || offer.type === "FIRST_MONTH" ? <small>First membership at this gym only.{offer.type === "FIRST_MONTH" && " Plans up to 31 days only."}</small> : offer.type === "REFERRAL" ? <small>A qualified referral is required.</small> : null}
    {!!offer.applicablePlanIds?.length && <small>Selected plans only.</small>}<small>Eligibility and remaining uses are confirmed at checkout.</small>
    {offer.terms && <details><summary>Offer terms</summary><p>{offer.terms}</p></details>}
  </article>)}</div></section>;
}
export function PromotionPlacement({ placement, gymId }: { placement: "EXPLORE" | "DASHBOARD" | "GYM_PROFILE"; gymId?: string }) {
  const track = useRef<HTMLDivElement>(null), trackId = useId();
  const [active, setActive] = useState(0);
  const path = `/api/v1/public/promotions/ads?placement=${placement}${gymId ? `&gymId=${encodeURIComponent(gymId)}` : ""}`;
  const query = useQuery({ queryKey: ["promotions", path], queryFn: () => apiRequest<ApiEnvelope<Row[]>>(path), refetchInterval: 60_000, retry: false });
  // Promotions never block the primary page. An optional campaign outage is explicit and retryable.
  if (query.isError) return <aside className="promotion-notice">Promotions are unavailable. <button className="btn btn-ghost" onClick={() => void query.refetch()}>Retry promotions</button></aside>;
  if (!query.data?.data.length) return null;
  const ads = query.data.data;
  const selected = Math.min(active, ads.length - 1);
  function move(index: number) {
    const bounded = Math.max(0, Math.min(index, ads.length - 1));
    setActive(bounded);
    const element = track.current;
    if (element) element.scrollTo({ left: bounded * element.clientWidth, behavior: "instant" });
  }
  return <section className="promotion-carousel" aria-label="Gym promotions" aria-roledescription={ads.length > 1 ? "carousel" : undefined}>
    {ads.length > 1 && <div className="promotion-carousel-controls"><span aria-live="polite">Promotion {selected + 1} of {ads.length}</span>
      <button type="button" className="icon-btn" aria-label="Previous promotion" aria-controls={trackId} disabled={selected === 0} onClick={() => move(selected - 1)}><ChevronLeft size={19} /></button>
      <button type="button" className="icon-btn" aria-label="Next promotion" aria-controls={trackId} disabled={selected === ads.length - 1} onClick={() => move(selected + 1)}><ChevronRight size={19} /></button>
    </div>}
    <div className="promotion-carousel-track" id={trackId} ref={track} onScroll={event => { const element = event.currentTarget; if (element.clientWidth) setActive(Math.round(element.scrollLeft / element.clientWidth)); }}>
    {ads.map((ad, index) => <article className="panel promotion-banner" key={ad.publicId} aria-label={`Promotion ${index + 1} of ${ads.length}`}>
    {ad.imageUrl && <img src={ad.imageUrl} alt="" loading="lazy" decoding="async" />}
    <div className="promotion-banner-copy"><div className="promotion-identity-row"><span className="eyebrow">Sponsored · {ad.gymName}</span>
      {ad.external ? <a className="btn btn-secondary" href={ad.href} target="_blank" rel="noopener noreferrer" aria-label={`${ad.ctaLabel}: ${ad.gymName}`}>{ad.ctaLabel}</a> : <Link className="btn btn-secondary" to={ad.href} aria-label={`${ad.ctaLabel}: ${ad.gymName}`}>{ad.ctaLabel}</Link>}
    </div><h3>{ad.name}</h3><p>{ad.description}</p>
    </div>
  </article>)}</div></section>;
}
