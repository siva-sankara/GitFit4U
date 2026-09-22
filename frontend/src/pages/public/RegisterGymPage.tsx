import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brand } from "../../components/Brand";
import { GymRegistrationForm } from "./GymRegistrationForm";
import { PaymentCheckout } from "../live/LivePublic";
import { useData, QueryState, label, type Row } from "../live/LiveData";
import {
  apiRequest,
  setAccessToken,
  type ApiEnvelope,
} from "../../services/apiClient";
const price = (value: number, currency = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(
    value / 100,
  );

export function RegisterGymPage() {
  const query = useQuery({
    queryKey: ["api", "/api/v1/workspace/registrations"],
    queryFn: () =>
      apiRequest<ApiEnvelope<Row[]>>("/api/v1/workspace/registrations"),
    refetchInterval: (q) =>
      q.state.data?.data.some((r) => r.status === "PAYMENT_PENDING")
        ? 3000
        : false,
  });
  const [selected, setSelected] = useState(""),
    [newGym, setNewGym] = useState(false);
  const registration =
    query.data?.data.find((r) => r.publicId === selected) ||
    query.data?.data[0];
  const navigate = useNavigate(),
    client = useQueryClient();
  const leaveRegistration = useMutation({
    mutationFn: async () => {
      // Capture the selected gym before refreshing; never open another gym's workspace.
      const registrationId = registration?.publicId;
      if (!newGym) {
        const refreshed = await query.refetch();
        if (refreshed.error) throw refreshed.error;
        const current = refreshed.data?.data.find(
          (r) => r.publicId === registrationId,
        );
        const active =
          current?.gymId?.status === "ACTIVE" && current.status === "ACTIVE";
        if (active) {
          const response = await apiRequest<ApiEnvelope<Row>>(
            "/api/v1/auth/switch-role",
            {
              method: "POST",
              body: JSON.stringify({
                role: "GYM_OWNER",
                gymId: current.gymId._id,
              }),
            },
          );
          setAccessToken(response.data.accessToken);
          client.clear();
          navigate("/owner/dashboard", { replace: true });
          return;
        }
      }
      navigate("/auth/login", { replace: true });
    },
  });
  return (
    <main className="container section-space page-stack">
      <header className="onboarding-topbar">
        <Brand />
        <button
          className="btn btn-ghost"
          disabled={query.isPending || leaveRegistration.isPending}
          onClick={() => leaveRegistration.mutate()}
        >
          {leaveRegistration.isPending ? "Opening..." : "Back"}
        </button>
      </header>
      {leaveRegistration.isError && (
        <p role="alert">{leaveRegistration.error.message}</p>
      )}
      <h1>Register your gym</h1>
      <p>
        Save your gym details, choose a registration plan, and pay securely.
        Your gym goes live automatically after the backend verifies payment.
      </p>
      <QueryState query={query}>
        {!registration || newGym ? (
          <section className="panel form-section page-stack">
            <GymRegistrationForm
              endpoint="/api/v1/owner/registrations"
              onSaved={(response) => {
                setSelected(response?.data?.registration?.publicId || "");
                setNewGym(false);
              }}
            />
            <div className="registration-next">
              <h3>Next: choose a registration plan</h3>
              <p>
                Review the available plans and prices after saving. Your gym
                stays hidden until payment is verified.
              </p>
            </div>
            {registration && (
              <button
                className="btn btn-secondary"
                onClick={() => setNewGym(false)}
              >
                Back to registrations
              </button>
            )}
          </section>
        ) : (
          <>
            <label className="field">
              <span>Registration</span>
              <select
                aria-label="Registration"
                className="select"
                value={registration.publicId}
                disabled={leaveRegistration.isPending}
                onChange={(e) => setSelected(e.target.value)}
              >
                {query.data?.data.map((r) => (
                  <option key={r.publicId} value={r.publicId}>
                    {r.gymId?.name} - {label(r.status)}
                  </option>
                ))}
              </select>
            </label>
            <Registration
              key={registration.publicId}
              registration={registration}
              onNew={() => setNewGym(true)}
              onRefresh={() => query.refetch()}
              onOpenWorkspace={() => leaveRegistration.mutate()}
              openingWorkspace={leaveRegistration.isPending}
            />
          </>
        )}
      </QueryState>
    </main>
  );
}
function Registration({
  registration: r,
  onNew,
  onRefresh,
  onOpenWorkspace,
  openingWorkspace,
}: {
  registration: Row;
  onNew: () => void;
  onRefresh: () => void;
  onOpenWorkspace: () => void;
  openingWorkspace: boolean;
}) {
  const client = useQueryClient();
  const [dirty, setDirty] = useState(false),
    [formBusy, setFormBusy] = useState(false),
    [checkoutBusy, setCheckoutBusy] = useState(false),
    [planId, setPlanId] = useState<string>(r.selectedPlatformPlanId || "");
  const active = r.gymId?.status === "ACTIVE" || r.status === "ACTIVE",
    suspended =
      r.status === "SUSPENDED" ||
      ["SUSPENDED", "ARCHIVED"].includes(r.gymId?.status);
  const options = useData<Row>(
    "/api/v1/workspace/registration-options",
    !active && !suspended,
  );
  const plans = useData<Row[]>(
    "/api/v1/workspace/platform-plans",
    !active && !suspended,
  );
  const snapshot = r.latestPaymentId?.metadata?.quoteSnapshot;
  const availablePlans = [...(plans.data?.data || [])];
  if (snapshot && !availablePlans.some((p) => p._id === snapshot.planId))
    availablePlans.push({
      _id: snapshot.planId,
      name: snapshot.planSnapshot.name,
      priceMinor: snapshot.totalMinor,
      currency: snapshot.currency,
      billingPeriod:
        snapshot.planSnapshot.durationDays >= 365 ? "YEARLY" : "MONTHLY",
      existingCheckout: true,
    });
  const chosen = availablePlans.find((p) => p._id === planId);
  return (
    <section className="panel form-section page-stack">
      <header>
        <h2>{r.gymId?.name}</h2>
        <p role="status">Status: {label(r.status)}</p>
      </header>
      <ol className="facility-row" aria-label="Registration progress">
        {["Gym details", "Plan and payment", "Active gym"].map((step, i) => (
          <li
            key={step}
            className="chip"
            aria-current={(active ? i === 2 : i === 1) ? "step" : undefined}
          >
            {i + 1}. {step}
          </li>
        ))}
      </ol>
      {active ? (
        <>
          <p>Your gym is active.</p>
          {r.latestPaymentId?.status === "CAPTURED" && (
            <p>Your payment is verified.</p>
          )}
          <p>
            {r.gymId?.platformSubscriptionStatus === "ACTIVE"
              ? "Members can now find it in gym listings and nearby search."
              : "Check your platform subscription in the owner workspace to confirm listing availability."}
          </p>
          {r.gymId?.slug && r.gymId.platformSubscriptionStatus === "ACTIVE" && (
            <Link className="btn btn-secondary" to={`/gyms/${r.gymId.slug}`}>
              View public gym page
            </Link>
          )}
          <button
            className="btn btn-primary"
            disabled={openingWorkspace}
            onClick={onOpenWorkspace}
          >
            {openingWorkspace ? "Opening..." : "Open gym owner workspace"}
          </button>
          <button className="btn btn-secondary" onClick={onNew}>
            Register another gym
          </button>
        </>
      ) : suspended ? (
        <p>
          This gym is suspended or archived. Contact support to resolve its
          status.
        </p>
      ) : (
        <>
          <details className="registration-section">
            <summary>Edit gym details and location</summary>
            <GymRegistrationForm
              key={`${r.publicId}-${r.version}`}
              initial={r.gymId}
              endpoint={`/api/v1/owner/registrations/${r.publicId}`}
              disabled={checkoutBusy}
              onBusyChange={setFormBusy}
              onDirty={() => setDirty(true)}
              onSaved={() => setDirty(false)}
            />
          </details>
          {dirty && (
            <p role="status">Save your changes before starting payment.</p>
          )}
          <p>
            Your gym is inactive and hidden from members until payment is
            verified. Closing or failing checkout does not activate it.
          </p>
          {["PAYMENT_FAILED", "PAYMENT_CANCELLED"].includes(r.status) && (
            <p role="status">
              Payment was not completed. Select your existing plan to retry
              securely.
            </p>
          )}
          {r.status === "PAYMENT_PENDING" && (
            <p role="status">
              Payment is pending. This page checks for verified payment
              automatically.
            </p>
          )}
          <section className="registration-section page-stack">
            <h3>Choose a registration plan</h3>
            <p>
              Plans and prices are configured by the platform administrator.
              Confirm the total in checkout before paying.
            </p>
            <QueryState query={plans}>
              <div className="live-card-grid">
                {availablePlans.map((p) => (
                  <button
                    className="panel form-section registration-plan-card"
                    key={p._id}
                    aria-pressed={planId === p._id}
                    disabled={dirty || formBusy || checkoutBusy}
                    onClick={() => setPlanId(p._id)}
                  >
                    <strong>{p.name}</strong>
                    <p>
                      {price(p.priceMinor, p.currency)} /{" "}
                      {p.billingPeriod === "YEARLY" ? "year" : "month"}
                    </p>
                    <p>{p.features?.join(", ")}</p>
                    {p.memberLimit != null && (
                      <p>Member limit: {p.memberLimit}</p>
                    )}
                    {p.staffLimit != null && <p>Staff limit: {p.staffLimit}</p>}
                    <span>
                      {planId === p._id ? "Selected plan" : "Select plan"}
                    </span>
                    {p.existingCheckout && (
                      <small>Resume existing checkout</small>
                    )}
                  </button>
                ))}
              </div>
              {!availablePlans.length && (
                <p>
                  No registration plans are available. Please contact support.
                </p>
              )}
            </QueryState>
            <QueryState query={options}>
              {options.data?.data.paymentsAvailable === false ? (
                <div className="page-stack">
                  <p role="alert">
                    Online payment is currently unavailable. Your gym details
                    are saved; contact support to enable payments.
                  </p>
                  <button
                    className="btn btn-secondary"
                    disabled={options.isFetching}
                    onClick={() => void options.refetch()}
                  >
                    {options.isFetching
                      ? "Checking availability..."
                      : "Check payment availability"}
                  </button>
                </div>
              ) : (
                chosen &&
                !dirty &&
                !formBusy && (
                  <PaymentCheckout
                    key={`${r.publicId}-${chosen._id}`}
                    quotePath="/api/v1/checkout/platform/quotes"
                    quoteBody={{
                      registrationId: r.publicId,
                      planId: chosen._id,
                    }}
                    onBusyChange={setCheckoutBusy}
                    onComplete={() => {
                      void client.invalidateQueries({ queryKey: ["api"] });
                      onRefresh();
                    }}
                  />
                )
              )}
            </QueryState>
          </section>
        </>
      )}
      <button
        className="btn btn-secondary"
        disabled={dirty || formBusy || checkoutBusy}
        onClick={() => {
          void options.refetch();
          onRefresh();
        }}
      >
        Refresh status
      </button>
    </section>
  );
}
