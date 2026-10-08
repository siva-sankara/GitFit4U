import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, type ApiEnvelope } from "../services/apiClient";
import { offerLabel } from "./PromotionPlacement";

export function PlatformCheckoutOffers({ purchase, disabled, onApply }: {
  purchase: { planId?: string; registrationId?: string; expectedGymId?: string };
  disabled: boolean; onApply: (code: string) => void;
}) {
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ planId: purchase.planId || "", page: String(page), limit: "5" });
  if (purchase.registrationId) params.set("registrationId", purchase.registrationId);
  if (purchase.expectedGymId) params.set("expectedGymId", purchase.expectedGymId);
  const path = `/api/v1/checkout/platform/offers?${params}`;
  const query = useQuery({ queryKey: ["api", path], queryFn: () => apiRequest<ApiEnvelope<Record<string, any>[]>>(path), enabled: Boolean(purchase.planId), retry: false });
  if (query.isPending) return <p role="status">Checking platform offers…</p>;
  if (query.isError) return <p className="subtle">Platform offers could not be loaded. <button type="button" className="btn btn-ghost" onClick={() => void query.refetch()}>Retry offers</button></p>;
  if (!query.data?.data.length && page === 1 && !query.data?.meta?.hasMore) return null;
  return <section className="platform-checkout-offers" aria-label="Eligible platform offers"><h3>Offers for this platform plan</h3>
    <p className="subtle">One discount for this purchase. Future renewals use the configured plan price.</p>
    {query.data?.data.map(offer => <article key={offer.publicId}><strong>{offer.name} · {offerLabel(offer)}</strong><p>{offer.description}</p>{offer.terms && <details><summary>Offer terms</summary><p>{offer.terms}</p></details>}<small>Valid until {new Date(offer.endsAt).toLocaleDateString()}</small><button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => onApply(offer.code)}>Apply {offer.code}</button></article>)}
    {(page > 1 || query.data?.meta?.hasMore) && <nav aria-label="Platform offer pages"><button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous offers</button><button type="button" disabled={!query.data?.meta?.hasMore} onClick={() => setPage(page + 1)}>More offers</button></nav>}
  </section>;
}
