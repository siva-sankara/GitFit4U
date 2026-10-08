import { PlatformCheckoutOffers } from "../../components/PlatformCheckoutOffers";
import { PageHeader } from "../../components/PageHeader";
import { CompactFilters } from "../../components/CompactFilters";
import { RoutineIllustration } from "../../components/RoutineIllustration";
import { ArrowRight, Building2, Heart } from "lucide-react";
import { authPath, canRegisterGym } from "../../services/authRedirect";
import { useSession } from "../../services/session";
import { LocationPicker } from "../../components/LocationPicker";
import { GymDetailsView } from "../public/GymDetailsView";
import { deviceLocation, validCoordinates } from "../../services/location";
import { useState, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../context/AppContext";
import {
  apiRequest,
  getAccessToken,
  type ApiEnvelope,
} from "../../services/apiClient";
import { QueryState, useData, money, EditForm, type Row } from "./LiveData";
import { Modal } from "../../components/Modal";
import { ReviewEditor } from "../../components/ReviewEditor";
import { GymIdentity } from "../../components/GymIdentity";
import { GymOffers, PromotionPlacement } from "../../components/PromotionPlacement";
import { Pagination } from "../../components/DataListControls";
export function DatabaseGymCard({ gym }: { gym: Row }) {
  const { favorites, toggleFavorite } = useApp();
  const navigate = useNavigate();
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => setCoverFailed(false), [gym.coverImageUrl]);
  const saved = favorites.includes(gym.publicId);
  const hasCover = Boolean(gym.coverImageUrl) && !coverFailed;
  return (
    <article className="gym-card">
      <div className="gym-card-media">
        <img
          src={hasCover ? gym.coverImageUrl : "/assets/strength-card.webp"}
          alt={hasCover ? gym.name : "Fitness training, default gym cover"}
          loading="lazy"
          onError={() => {
            if (hasCover) setCoverFailed(true);
          }}
        />
        <button
          className={saved ? "favorite-button is-active" : "favorite-button"}
          type="button"
          title={saved ? "Remove from saved gyms" : "Save gym"}
          aria-label={
            saved ? `Remove ${gym.name} from saved gyms` : `Save ${gym.name}`
          }
          aria-pressed={saved}
          onClick={() =>
            getAccessToken()
              ? toggleFavorite(gym.publicId)
              : navigate(authPath("/auth/login", `/gyms/${gym.slug}`))
          }
        >
          <Heart
            size={21}
            fill={saved ? "currentColor" : "none"}
            aria-hidden="true"
          />
        </button>
      </div>
      <div className="gym-card-content">
        <h3>
          <GymIdentity name={gym.name} logoUrl={gym.logoUrl} />
        </h3>
        <p>
          {[gym.address?.locality, gym.address?.city]
            .filter(Boolean)
            .join(", ")}
          {gym.distanceMeters != null
            ? ` · ${(gym.distanceMeters / 1000).toFixed(1)} km`
            : ""}
        </p>
        <p>
          {gym.rating?.count
            ? `${gym.rating.average.toFixed(1)} / 5 · ${gym.rating.count} reviews`
            : "No reviews yet"}
        </p>
        <div className="facility-row">
          {gym.facilities?.slice(0, 3).map((v: string) => (
            <span className="chip" key={v}>
              {v}
            </span>
          ))}
        </div>
        <div className="gym-card-footer">
          <span>
            {gym.startingPriceMinor != null
              ? `From ${money(gym.startingPriceMinor)}`
              : "View membership options"}
          </span>
          <Link className="btn btn-primary" to={`/gyms/${gym.slug}`}>
            View gym
          </Link>
        </div>
      </div>
    </article>
  );
}
export const LANDING_GYM_LIMIT = 8;
export function LiveLanding() {
  const me = useSession({ publicPage: true });
  const showOwnerLink = !getAccessToken() || Boolean(me.data && canRegisterGym(me.data.data));
  const query = useData<Row[]>(`/api/v1/public/gyms?limit=${LANDING_GYM_LIMIT}`),
    navigate = useNavigate();
  const [search, setSearch] = useState("");
  const visibleGyms = (query.data?.data ?? []).slice(0, LANDING_GYM_LIMIT);
  return (
    <>
      <section className="hero-section">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">Your city. Your pace.</span>
            <h1>
              Find your gym.
              <br />
              Own your journey.
            </h1>
            <p>
              Explore gyms, compare memberships and track your training in one
              place.
            </p>
            <form
              className="hero-search"
              onSubmit={(e) => {
                e.preventDefault();
                navigate(`/explore?q=${encodeURIComponent(search)}`);
              }}
            >
              <input
                aria-label="Search gyms"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Gym name or locality"
              />
              <button className="btn btn-primary">Explore gyms</button>
            </form>
            <div className="hero-account-action">
              <p>Ready to start your fitness journey?</p>
              <Link className="btn btn-secondary" to="/auth/signup">
                Create your account <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <img
            className="hero-image"
            src="/assets/gym-community-hero.webp"
            alt="Fitness training"
          />
        </div>
      </section>
      <section className="container section-space landing-section">
        <div className="landing-section-heading"><h2>Explore registered gyms</h2><Link className="btn btn-secondary" to="/explore">See all gyms <ArrowRight size={18} aria-hidden="true" /></Link></div>
        <QueryState query={query}>
          <div className="live-card-grid">
            {visibleGyms.map((gym) => (
              <DatabaseGymCard key={gym._id} gym={gym} />
            ))}
          </div>
          {query.isSuccess && !visibleGyms.length && (
            <p>No gyms are currently published. Check back soon.</p>
          )}
        </QueryState>
      </section>
      <section
        className="container section-space landing-section"
        id="how-it-works"
      >
        <h2>Build your routine</h2>
        <div className="routine-section">
          <RoutineIllustration />
          <ol className="routine-steps">{[
            [
              "Find a gym",
              "Compare locations, facilities and available plans.",
            ],
            [
              "Join a membership",
              "Review the price and complete secure checkout.",
            ],
            [
              "Keep showing up",
              "Scan your gym QR and follow your attendance history.",
            ],
          ].map(([title, text]) => (
            <li key={title}>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}</ol>
        </div>
      </section>
      <section className="container section-space landing-section">
        {showOwnerLink && <div className="landing-owner-cta">
          <div className="landing-owner-icon">
            <Building2 size={32} aria-hidden="true" />
          </div>
          <div>
            <span className="eyebrow">FOR GYM OWNERS</span>
            <h2>Bring your gym to GETFIT4U</h2>
            <p>
              Showcase your space, publish membership plans, and welcome new
              members.
            </p>
          </div>
          <Link className="btn btn-primary" to="/register-gym">
            Register your gym <ArrowRight size={20} aria-hidden="true" />
          </Link>
        </div>}
      </section>
    </>
  );
}
export function LiveExplore() {
  const [params, setParams] = useSearchParams(),
    [q, setQ] = useState(params.get("q") || ""),
    [geoError, setGeoError] = useState("");
  const [maximumPrice, setMaximumPrice] = useState(params.get("maxPrice") ? String(Number(params.get("maxPrice")) / 100) : "");
  const [priceError, setPriceError] = useState("");
  useEffect(() => { setMaximumPrice(params.get("maxPrice") ? String(Number(params.get("maxPrice")) / 100) : ""); setPriceError(""); }, [params]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const value = q.trim();
      setParams((current) => {
        if ((current.get("q") || "") === value) return current;
        const next = new URLSearchParams(current);
        if (value) next.set("q", value); else next.delete("q");
        next.set("page", "1");
        return next;
      }, { replace: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [q, setParams]);
  const nearby = params.has("lat");
  const query = useData<Row[]>(
    `/api/v1/public/gyms${nearby ? "/nearby" : ""}?${params}`,
  );
  const page = Number(params.get("page") || 1);
  const limit = [10, 25, 50].includes(Number(params.get("limit"))) ? Number(params.get("limit")) : 10;
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    next.set("page", "1");
    setParams(next);
  }
  return (
    <div className="container section-space page-stack">
      <PageHeader>
        <div>
          <span className="eyebrow">Gym discovery</span>
          <h1>Find your next gym</h1>
        </div>
      </PageHeader>
      <form
        className="table-toolbar explore-filter-toolbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (priceError) return;
          filter("q", q);
        }}
      >
        <div className="explore-search">
          <input
            className="input"
            aria-label="Search gyms"
            placeholder="Gym, locality or city"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn btn-primary">Search</button>
        </div>
        <CompactFilters activeCount={["rating", "maxPrice", "facility"].filter(key => params.get(key)).length} onReset={() => {
          const next = new URLSearchParams(params);
          ["rating", "maxPrice", "facility"].forEach(key => next.delete(key));
          next.set("page", "1"); setParams(next); setMaximumPrice(""); setPriceError("");
        }} onApply={() => !priceError}>
        <label className="field">
          <span>Minimum rating</span>
          <select
            className="select"
            value={params.get("rating") || ""}
            onChange={(e) => filter("rating", e.target.value)}
          >
            <option value="">Any</option>
            <option value="4">4+</option>
            <option value="4.5">4.5+</option>
          </select>
        </label>
        <label className="field">
          <span>Maximum price (INR)</span>
          <input
            className="input"
            type="text"
            inputMode="decimal"
            aria-invalid={!!priceError}
            aria-describedby={priceError ? "maximum-price-error" : undefined}
            value={maximumPrice}
            onChange={(e) => {
              const value = e.target.value; setMaximumPrice(value);
              const minor = Math.round(Number(value) * 100);
              if (value && (!/^\d+(\.\d{1,2})?$/.test(value) || !Number.isSafeInteger(minor) || minor < 0)) { setPriceError("Enter a non-negative price with up to 2 decimal places."); return; }
              setPriceError(""); filter("maxPrice", value ? String(minor) : "");
            }}
          />
          {priceError && <small id="maximum-price-error" className="filter-error" role="alert">{priceError}</small>}
        </label>
        <label className="field">
          <span>Facility</span>
          <input
            className="input"
            value={params.get("facility") || ""}
            onChange={(e) => filter("facility", e.target.value)}
          />
        </label>
        </CompactFilters>
      </form>
      <div className="heading-actions">
        <button
          className="btn btn-secondary"
          onClick={async () => {
            setGeoError("");
            try {
              const point = await deviceLocation();
              setParams((current) => {
                const next = new URLSearchParams(current);
                next.set("lat", String(point.latitude));
                next.set("lng", String(point.longitude));
                next.set("page", "1");
                return next;
              });
            } catch (error) {
              setGeoError((error as Error).message);
            }
          }}
        >
          Use my location
        </button>
        {nearby && (
          <label>
            Radius{" "}
            <select
              className="select"
              value={params.get("distanceKm") || "10"}
              onChange={(e) => filter("distanceKm", e.target.value)}
            >
              {[2, 5, 10, 25, 50].map((n) => (
                <option key={n} value={n}>
                  {n} km
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="btn btn-ghost"
          onClick={() => {
            setParams({});
            setQ("");
          }}
        >
          Clear search and location
        </button>
      </div>
      <PromotionPlacement placement="EXPLORE" />
      {geoError && <p role="alert">{geoError}</p>}
      <details className="panel form-section">
        <summary>Search near an address or choose a map pin</summary>
        <LocationPicker
          title="Search area"
          value={
            params.has("lat") &&
            params.has("lng") &&
            validCoordinates({
              latitude: Number(params.get("lat")),
              longitude: Number(params.get("lng")),
            })
              ? {
                  latitude: Number(params.get("lat")),
                  longitude: Number(params.get("lng")),
                }
              : undefined
          }
          onChange={(point) =>
            setParams((current) => {
              const next = new URLSearchParams(current);
              next.set("lat", String(point.latitude));
              next.set("lng", String(point.longitude));
              next.set("page", "1");
              return next;
            })
          }
        />
      </details>
      <QueryState query={query}>
        <p>
          {query.data?.meta?.total ?? query.data?.data.length ?? 0} gyms found
        </p>
        <div className="live-card-grid">
          {query.data?.data.map((gym) => (
            <DatabaseGymCard key={gym._id} gym={gym} />
          ))}
        </div>
        {!query.data?.data.length && (
          <section className="state-card panel">
            <h2>No gyms match your search</h2>
            <p>Try a wider area or fewer filters.</p>
          </section>
        )}
        <Pagination page={page} limit={limit} total={query.data?.meta?.total || 0} loading={query.isFetching} onPageChange={(value) => { const next = new URLSearchParams(params); next.set("page", String(value)); next.set("limit", String(limit)); setParams(next); }} onLimitChange={(value) => { const next = new URLSearchParams(params); next.set("page", "1"); next.set("limit", String(value)); setParams(next); }} />
      </QueryState>
    </div>
  );
}
let checkoutScript: Promise<void> | null = null;
function loadCheckout() {
  if ((window as any).Razorpay) return Promise.resolve();
  if (!checkoutScript)
    checkoutScript = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      const fail = () => {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        checkoutScript = null;
        script.remove();
        reject(
          new Error(
            "Razorpay checkout could not load. Check your connection and try again.",
          ),
        );
      };
      const timer = window.setTimeout(fail, 15000);
      script.onload = () => {
        if (!(window as any).Razorpay) return fail();
        clearTimeout(timer);
        script.onload = script.onerror = null;
        resolve();
      };
      script.onerror = fail;
      document.head.appendChild(script);
    });
  return checkoutScript;
}
export function PaymentCheckout({
  quotePath,
  quoteBody,
  onComplete,
  onBusyChange,
  onGatewayOpenChange,
}: {
  quotePath: string;
  quoteBody: Row;
  onComplete?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onGatewayOpenChange?: (open: boolean) => void;
}) {
  const [paymentId, setPaymentId] = useState(""),
    [message, setMessage] = useState(""),
    [gatewayOpen, setGatewayOpen] = useState(false),
    [verifying, setVerifying] = useState(false);
  const [couponInput, setCouponInput] = useState(""), [couponCode, setCouponCode] = useState("");
  const membershipCheckout = !quotePath.includes("platform");
  const gatewayCallback = useRef(onGatewayOpenChange);
  gatewayCallback.current = onGatewayOpenChange;
  const gatewayCleanup = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      gatewayCleanup.current?.();
      gatewayCallback.current?.(false);
    };
  }, []);
  const client = useQueryClient();
  const quote = useQuery({
    queryKey: ["quote", quotePath, quoteBody, couponCode],
    queryFn: () =>
      apiRequest<ApiEnvelope<Row>>(quotePath, {
        method: "POST",
        body: JSON.stringify({ ...quoteBody, ...(couponCode ? { couponCode } : {}) }),
      }),
    retry: false,
    staleTime: 15 * 60 * 1000,
    gcTime: 0,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const payment = useQuery({
    queryKey: ["payment", paymentId],
    enabled: !!paymentId,
    queryFn: () =>
      apiRequest<ApiEnvelope<Row>>(`/api/v1/checkout/payments/${paymentId}`),
    refetchInterval: (q) =>
      ["CAPTURED", "FAILED", "CANCELLED"].includes(
        (q.state.data as ApiEnvelope<Row> | undefined)?.data.status || "",
      )
        ? false
        : 3000,
  });
  const pay = useMutation({
    mutationFn: async () => {
      setMessage("");
      if (
        quote.data?.data.expiresAt &&
        new Date(quote.data.data.expiresAt).getTime() <= Date.now()
      ) {
        const refreshed = await quote.refetch();
        if (refreshed.error) throw refreshed.error;
        setMessage(
          "The previous price quote expired. Review the refreshed price, then choose Pay with Razorpay again.",
        );
        return;
      }
      await loadCheckout();
      const order = await apiRequest<ApiEnvelope<Row>>(
        quotePath.includes("platform")
          ? "/api/v1/checkout/platform/orders"
          : "/api/v1/checkout/orders",
        {
          method: "POST",
          idempotencyKey: crypto.randomUUID(),
          body: JSON.stringify({ quoteId: quote.data!.data.publicId }),
        },
      );
      if (!order.data.razorpayKeyId)
        throw new Error("Online payment is not configured.");
      if (!mounted.current) return;
      setPaymentId(order.data.paymentId);
      if (quotePath.includes("platform"))
        void client.invalidateQueries({
          queryKey: ["api", "/api/v1/workspace/registrations"],
        });
      await new Promise<void>((resolve, reject) => {
        let received = false;
        const releaseGateway = () => {
          gatewayCleanup.current = null;
          if (mounted.current) {
            setGatewayOpen(false);
            gatewayCallback.current?.(false);
          }
        };
        const widget = new (window as any).Razorpay({
          key: order.data.razorpayKeyId,
          order_id: order.data.providerOrderId,
          amount: order.data.amountMinor,
          currency: order.data.currency,
          name: "GETFIT4U",
          description: quote.data!.data.planSnapshot?.name,
          prefill: order.data.prefill,
          handler: async (result: Row) => {
            received = true;
            setVerifying(true);
            releaseGateway();
            try {
              const verified = await apiRequest<ApiEnvelope<Row>>(
                "/api/v1/checkout/verify",
                {
                  method: "POST",
                  body: JSON.stringify({
                    paymentId: order.data.paymentId,
                    providerOrderId: result.razorpay_order_id,
                    providerPaymentId: result.razorpay_payment_id,
                    signature: result.razorpay_signature,
                  }),
                },
              );
              client.setQueryData(["payment", order.data.paymentId], verified);
              setMessage(
                verified.data.status === "CAPTURED"
                  ? "Payment verified. Your membership is ready."
                  : "Payment submitted. Waiting for verified capture.",
              );
              await client.invalidateQueries({
                queryKey: ["payment", order.data.paymentId],
              });
              resolve();
            } catch (e) {
              reject(e);
            } finally {
              if (mounted.current) setVerifying(false);
            }
          },
          modal: {
            ondismiss: async () => {
              releaseGateway();
              if (received) return;
              try {
                await apiRequest(
                  `/api/v1/checkout/payments/${order.data.paymentId}/cancel`,
                  { method: "POST", body: "{}" },
                );
                setMessage(
                  "Checkout closed. You can retry the same order if payment was not completed.",
                );
                await client.invalidateQueries({
                  queryKey: ["payment", order.data.paymentId],
                });
                if (quotePath.includes("platform"))
                  void client.invalidateQueries({
                    queryKey: ["api", "/api/v1/workspace/registrations"],
                  });
                resolve();
              } catch (error) {
                reject(error);
              }
            },
          },
        });
        widget.on("payment.failed", (r: Row) =>
          reject(new Error(r.error?.description || "Payment failed.")),
        );
        gatewayCleanup.current = () => {
          received = true;
          widget.close?.();
          resolve();
        };
        try {
          // Commit before open(): the gateway can focus its body-mounted iframe synchronously.
          flushSync(() => {
            setGatewayOpen(true);
            gatewayCallback.current?.(true);
          });
          widget.open();
        } catch (error) {
          reject(error);
          gatewayCleanup.current?.();
          releaseGateway();
        }
      });
    },
  });
  const completed = useRef("");
  useEffect(() => {
    onBusyChange?.(pay.isPending || verifying);
    return () => onBusyChange?.(false);
  }, [pay.isPending, verifying, onBusyChange]);
  useEffect(() => {
    if (
      payment.data?.data.status === "CAPTURED" &&
      completed.current !== paymentId
    ) {
      completed.current = paymentId;
      void client.invalidateQueries({ queryKey: ["api"] });
      void client.invalidateQueries({ queryKey: ["notifications"] });
      onComplete?.();
    }
  }, [payment.data?.data.status, paymentId, onComplete, quotePath]);
  const checkoutMoney = (amount: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: quote.data?.data.currency || "INR",
    }).format((amount || 0) / 100);
  const pricingCommitted = Boolean(paymentId || quote.data?.data.paymentCommitted);
  return (
    <>
    {!membershipCheckout && !pricingCommitted && <PlatformCheckoutOffers key={`${quoteBody.planId}-${quoteBody.registrationId || quoteBody.expectedGymId || "renewal"}`} purchase={quoteBody} disabled={pay.isPending || quote.isFetching} onApply={code => { setCouponInput(code); setCouponCode(code); setMessage(""); }} />}
    {!pricingCommitted ? <form className="checkout-coupon" onSubmit={event => { event.preventDefault(); if (!pay.isPending) { setMessage(""); setCouponCode(couponInput.trim().toUpperCase()); } }}>
      <label className="field"><span>Offer / coupon code</span><input className="input" value={couponInput} maxLength={30} autoComplete="off" disabled={pay.isPending} onChange={event => setCouponInput(event.target.value)} /></label>
      <div className="heading-actions"><button type="submit" className="btn btn-secondary" disabled={pay.isPending || !couponInput.trim() || quote.isFetching}>Apply code</button>
        {couponCode && <button type="button" className="btn btn-ghost" disabled={pay.isPending} onClick={() => { setCouponCode(""); setCouponInput(""); }}>Remove code</button>}</div>
    </form> : <p className="subtle">Pricing is locked to the existing payment order. Resume it at the recorded price; another offer cannot change this order.</p>}
    <QueryState query={quote}>
      {quote.data && (
        <>
          <p>Plan: {quote.data.data.planSnapshot?.name}</p>
          {quote.data.data.planSnapshot?.durationDays && (
            <p>
              Access for {quote.data.data.planSnapshot.durationDays} days from
              activation.
            </p>
          )}
          <p>
            One-time payment through Razorpay. This checkout does not enable
            automatic recurring charges.
          </p>
          <div className="checkout-lines">
            <div>
              <span>Subtotal</span>
              <strong>{checkoutMoney(quote.data.data.subtotalMinor)}</strong>
            </div>
            <div>
              <span>Discount</span>
              <strong>{checkoutMoney(quote.data.data.discountMinor)}</strong>
            </div>
            <div>
              <span>Tax</span>
              <strong>{checkoutMoney(quote.data.data.taxMinor)}</strong>
            </div>
            <div>
              <span>Total</span>
              <strong>{checkoutMoney(quote.data.data.totalMinor)}</strong>
            </div>
          </div>
          {quote.data.data.pricingSnapshot?.offer && <section className="form-section"><strong>Applied: {quote.data.data.pricingSnapshot.offer.name}</strong><p>Offer saving: {checkoutMoney(quote.data.data.pricingSnapshot.offerDiscountMinor)}</p>{quote.data.data.pricingSnapshot.offer.terms && <p className="subtle">{quote.data.data.pricingSnapshot.offer.terms}</p>}</section>}
          {payment.data?.data.status === "CAPTURED" ? (
            <>
              <h3>Payment captured</h3>
              <p>Your purchase is recorded.</p>
              <button
                className="btn btn-primary"
                onClick={() => {
                  client.invalidateQueries();
                  if (completed.current !== paymentId) {
                    completed.current = paymentId;
                    onComplete?.();
                  }
                }}
              >
                Continue
              </button>
            </>
          ) : (
            <button
              className="btn btn-primary"
              disabled={
                pay.isPending ||
                quote.isFetching ||
                gatewayOpen ||
                verifying ||
                (["PENDING", "AUTHORIZED"].includes(
                  payment.data?.data.status,
                ) &&
                  !!message &&
                  message.startsWith("Payment submitted"))
              }
              onClick={() => pay.mutate()}
            >
              {pay.isPending || verifying ? "Checkout in progress…" : "Pay with Razorpay"}
            </button>
          )}
          {pay.isError && (
            <p role="alert" className="form-alert">
              {pay.error.message}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          {payment.isError && (
            <p role="alert">
              Unable to confirm payment status: {payment.error.message} Refresh
              status before trying another payment.
            </p>
          )}
          {paymentId && (
            <p>
              Payment: {payment.data?.data.status || "Checking…"}{" "}
              <button
                className="btn btn-ghost"
                onClick={() => payment.refetch()}
              >
                Refresh status
              </button>
            </p>
          )}
          {payment.isError && <p role="alert">{payment.error.message}</p>}
        </>
      )}
    </QueryState>
    </>
  );
}
export function LiveGymDetails() {
  const { slug } = useParams(),
    location = useLocation(),
    query = useQuery<ApiEnvelope<Row>>({
      queryKey: [
        "api",
        `/api/v1/public/gyms/${encodeURIComponent(slug || "")}`,
      ],
      queryFn: () =>
        apiRequest(`/api/v1/public/gyms/${encodeURIComponent(slug || "")}`),
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      refetchInterval: 30000,
    });
  const [plan, setPlan] = useState<Row | null>(null),
    [checkoutBusy, setCheckoutBusy] = useState(false),
    [gatewayOpen, setGatewayOpen] = useState(false),
    [review, setReview] = useState(false),
    [reviewBusy, setReviewBusy] = useState(false),
    navigate = useNavigate(),
    { favorites, toggleFavorite } = useApp();
  const [params, setParams] = useSearchParams();
  const fromSettings =
    params.get("from") === "settings" ||
    (location.state as { from?: string } | null)?.from === "gym-profile-settings";
  const data = query.data?.data,
    gym = data?.gym;
  const [reviewPage, setReviewPage] = useState(1);
  const [classPage, setClassPage] = useState(1), [classLimit, setClassLimit] = useState(10);
  const [mediaPage, setMediaPage] = useState(1), [mediaEnabled, setMediaEnabled] = useState(false);
  const [planPage, setPlanPage] = useState(1), [planLimit, setPlanLimit] = useState(10);
  const reviewsQuery = useData<Row[]>(
    `/api/v1/public/gyms/${encodeURIComponent(slug || "")}/reviews?page=${reviewPage}&limit=10`,
    !!gym,
  );
  const classesQuery = useData<Row[]>(
    `/api/v1/public/gyms/${encodeURIComponent(slug || "")}/classes?page=${classPage}&limit=${classLimit}`,
    !!gym,
  );
  const mediaQuery = useData<Row[]>(
    `/api/v1/public/gyms/${encodeURIComponent(slug || "")}/media?page=${mediaPage}&limit=12`,
    !!gym && mediaEnabled,
  );
  const plansQuery = useData<Row[]>(
    `/api/v1/public/gyms/${encodeURIComponent(slug || "")}/plans?page=${planPage}&limit=${planLimit}`,
    !!gym,
  );
  const ownReview = useData<Row | null>(
    `/api/v1/users/me/reviews?gymId=${encodeURIComponent(gym?.publicId || "")}`,
    !!gym && !!getAccessToken(),
  );
  const client = useQueryClient();
  const join = useMutation({
    mutationFn: () =>
      apiRequest("/api/v1/users/me/gym-join-requests", {
        method: "POST",
        body: JSON.stringify({ gymId: gym.publicId }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["api"] }),
  });
  const requestedPlan = params.get("plan");
  const [planNotice, setPlanNotice] = useState("");
  useEffect(() => {
    setPlan(null);
    setReview(false);
    setPlanNotice("");
    setReviewPage(1);
    setClassPage(1);
    setMediaPage(1);
    setMediaEnabled(false);
    setPlanPage(1);
    join.reset();
  }, [slug]);
  useEffect(() => {
    if (!data || !requestedPlan || !getAccessToken()) return;
    const selected = data.plans?.find(
      (p: Row) => p._id === requestedPlan || p.publicId === requestedPlan,
    );
    if (selected) setPlan(selected);
    else
      setPlanNotice(
        "That membership is no longer available. Please choose one of the current plans.",
      );
    const next = new URLSearchParams(params);
    next.delete("plan");
    setParams(next, { replace: true });
  }, [data, requestedPlan, params, setParams]);
  return (
    <div className="gd-page-shell">
      <QueryState query={query}>
        {gym && (
          <>
            {(planNotice || ownReview.isError) && (
              <p className="container form-alert" role="status">
                {planNotice ||
                  "Your review could not be loaded. Refresh this page before submitting a new review."}
                {ownReview.isError && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => ownReview.refetch()}
                  >
                    Retry loading your review
                  </button>
                )}
              </p>
            )}
            <GymDetailsView
              key={gym.publicId}
              data={{
                ...data,
                gym: { ...data.gym, media: mediaQuery.data?.data || data.gym?.media },
                plans: plansQuery.data?.data || data?.plans,
                classes: classesQuery.data?.data || data?.classes,
                reviews: reviewsQuery.data?.data || data?.reviews,
                ownReview: ownReview.data?.data,
                reviewDistribution: (reviewsQuery.data?.meta as any)
                  ?.distribution,
              }}
              saved={favorites.includes(gym.publicId)}
              backTo={fromSettings ? "/owner/gym-profile" : "/explore"}
              backLabel={fromSettings ? "Back to Gym Profile Settings" : "Back to Explore gyms"}
              onFavorite={() =>
                getAccessToken()
                  ? toggleFavorite(gym.publicId)
                  : navigate(authPath("/auth/login", `/gyms/${slug}`))
              }
              onChoosePlan={(p) => {
                if (!getAccessToken()) {
                  navigate(
                    authPath(
                      "/auth/login",
                      `/gyms/${slug}?plan=${encodeURIComponent(p._id)}#gym-plans`,
                    ),
                  );
                  return;
                }
                setPlan(p);
              }}
              onReview={() => {
                if (!getAccessToken()) {
                  navigate(authPath("/auth/login", `/gyms/${slug}`));
                  return;
                }
                if (!ownReview.isFetching && !ownReview.isError)
                  setReview(true);
              }}
              onJoin={() => {
                if (!getAccessToken())
                  navigate(authPath("/auth/login", `/gyms/${slug}#gym-plans`));
                else join.mutate();
              }}
              joinPending={join.isPending}
              joinStatus={
                join.isSuccess
                  ? "Your join request has been sent. The gym will contact you about access and membership options."
                  : undefined
              }
              joinError={join.isError ? join.error.message : undefined}
              reviewDisabled={ownReview.isFetching || ownReview.isError}
              offers={<GymOffers gymId={gym.publicId} />}
              advertisements={<PromotionPlacement placement="GYM_PROFILE" gymId={gym.publicId} />}
              reviewsState={{
                page: reviewPage,
                pages: reviewsQuery.data?.meta?.pages || 1,
                loading: reviewsQuery.isFetching,
                error: reviewsQuery.isError
                  ? reviewsQuery.error.message
                  : undefined,
                onPage: setReviewPage,
              }}
              classesState={{
                page: classPage,
                limit: classLimit,
                total: classesQuery.data?.meta?.total || 0,
                loading: classesQuery.isFetching,
                error: classesQuery.isError ? classesQuery.error.message : undefined,
                onPage: setClassPage,
                onLimit: (value) => { setClassLimit(value); setClassPage(1); },
              }}
              mediaState={{
                page: mediaPage,
                limit: 12,
                total: mediaQuery.data?.meta?.total || gym.mediaCount || gym.media?.length || 0,
                loading: mediaQuery.isFetching,
                onOpen: () => setMediaEnabled(true),
                onPage: setMediaPage,
              }}
              plansState={{
                page: planPage,
                limit: planLimit,
                total: plansQuery.data?.meta?.total || 0,
                loading: plansQuery.isFetching,
                onPage: setPlanPage,
                onLimit: (value) => { setPlanLimit(value); setPlanPage(1); },
              }}
            />
            <Modal
              open={!!plan}
              title="Membership checkout"
              externalOverlayActive={gatewayOpen}
              onClose={() => { if (!checkoutBusy && !gatewayOpen) setPlan(null); }}
            >
              {plan && (
                <PaymentCheckout
                  quotePath="/api/v1/checkout/quotes"
                  quoteBody={{ gymId: gym._id, planId: plan._id }}
                  onBusyChange={setCheckoutBusy}
                  onGatewayOpenChange={setGatewayOpen}
                  onComplete={() =>
                    navigate("/app/subscriptions", {
                      state: { joinedGymName: gym.name },
                    })
                  }
                />
              )}
            </Modal>
            <Modal
              open={review}
              title={
                ownReview.data?.data ? "Edit your review" : "Review this gym"
              }
              onClose={() => { if (!reviewBusy) setReview(false); }}
            >
              {review && (
                <ReviewEditor
                  gymId={gym.publicId}
                  onBusyChange={setReviewBusy}
                  initial={ownReview.data?.data || {}}
                  onSaved={() => {
                    setReview(false);
                    void ownReview.refetch();
                    void reviewsQuery.refetch();
                  }}
                />
              )}
            </Modal>
          </>
        )}
      </QueryState>
    </div>
  );
}
