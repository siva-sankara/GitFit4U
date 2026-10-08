export function PaymentPricing({ payment }: { payment: { amountMinor?: number; currency?: string; pricingSnapshot?: Record<string, any> } }) {
  const pricing = payment.pricingSnapshot;
  const money = (amount?: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: payment.currency || "INR" }).format(Number(amount || 0) / 100);
  return <div><strong>{money(payment.amountMinor)}</strong>{pricing && <details className="payment-pricing"><summary>Price breakdown</summary><dl>
    <dt>Original amount</dt><dd>{money(pricing.subtotalMinor)}</dd><dt>Discount</dt><dd>{money(pricing.discountMinor)}</dd><dt>Tax</dt><dd>{money(pricing.taxMinor)}</dd><dt>Total</dt><dd>{money(pricing.totalMinor)}</dd>
  </dl>{pricing.offer && <small>{pricing.offer.name}{pricing.offer.application === "ONE_TIME" ? " · One purchase only" : ""}</small>}</details>}</div>;
}
