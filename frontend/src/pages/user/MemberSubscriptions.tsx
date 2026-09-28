import { PageHeader } from "../../components/PageHeader";
import { useState, type FormEvent } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { CalendarDays, CreditCard, LoaderCircle, QrCode } from "lucide-react";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { Modal } from "../../components/Modal";
import { StatusBadge } from "../../components/StatusBadge";
import { GymIdentity } from "../../components/GymIdentity";
import "../../styles/member-workspace.css";

export interface MemberSubscription {
  _id: string;
  publicId: string;
  gymId?: { _id: string; name: string; slug?: string; logoUrl?: string } | null;
  planSnapshot?: {
    name?: string;
    planId?: string;
    totalMinor?: number;
    priceMinor?: number;
    durationDays?: number;
    freezeDaysAllowed?: number;
    benefits?: string[];
  } | null;
  status: string;
  startsAt?: string;
  endsAt?: string;
  freezePeriods?: { startsAt: string; endsAt: string }[];
}
type Command = "cancel" | "freeze" | "reactivate";
type Selection = { subscription: MemberSubscription; command: Command };
const resourcePath = "/api/v1/workspace/records/subscriptions";
const statuses = [
  "ACTIVE",
  "PENDING_PAYMENT",
  "FROZEN",
  "GRACE",
  "EXPIRED",
  "CANCELLED",
  "DEACTIVATED",
];
const day = (value?: string) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(value))
    : "Not started";
const amount = (value?: number) =>
  value == null
    ? "Not available"
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
      }).format(value / 100);

function freezeDaysRemaining(subscription: MemberSubscription) {
  const used = (subscription.freezePeriods || []).reduce((sum, period) => {
    const days = Math.ceil(
      (Date.parse(period.endsAt) - Date.parse(period.startsAt)) / 86400000,
    );
    return sum + (Number.isFinite(days) ? Math.max(0, days) : 0);
  }, 0);
  return Math.max(
    0,
    (subscription.planSnapshot?.freezeDaysAllowed || 0) - used,
  );
}

function SubscriptionSkeleton() {
  return (
    <div
      className="member-subscription-grid"
      role="status"
      aria-label="Loading subscriptions"
      aria-busy="true"
    >
      {[0, 1].map((key) => (
        <div
          className="panel subscription-loading-card"
          key={key}
          aria-hidden="true"
        >
          <span className="subscription-skeleton subscription-skeleton--title" />
          <span className="subscription-skeleton" />
          <span className="subscription-skeleton subscription-skeleton--details" />
          <span className="subscription-skeleton subscription-skeleton--button" />
        </div>
      ))}
      <span className="sr-only">Loading your gym memberships…</span>
    </div>
  );
}

function SubscriptionCommand({
  selection,
  onClose,
  onSaved,
}: {
  selection: Selection;
  onClose: () => void;
  onSaved: (subscription: MemberSubscription, command: Command) => void;
}) {
  const { subscription, command } = selection;
  const [reason, setReason] = useState("");
  const [freezeDays, setFreezeDays] = useState(1);
  const remainingDays = freezeDaysRemaining(subscription);
  const save = useMutation({
    mutationFn: () => {
      const startsAt = new Date();
      return apiRequest<ApiEnvelope<MemberSubscription>>(
        `/api/v1/users/me/subscriptions/${encodeURIComponent(subscription.publicId)}/${command}`,
        {
          method: "POST",
          idempotencyKey: crypto.randomUUID(),
          body: JSON.stringify({
            reason: reason.trim(),
            ...(command === "freeze"
              ? {
                  startsAt: startsAt.toISOString(),
                  endsAt: new Date(
                    startsAt.getTime() + freezeDays * 86400000,
                  ).toISOString(),
                }
              : {}),
          }),
        },
      );
    },
    onSuccess: (response) =>
      onSaved(
        { ...subscription, ...response.data, gymId: subscription.gymId },
        command,
      ),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      save.isPending ||
      !reason.trim() ||
      (command === "freeze" &&
        (!Number.isInteger(freezeDays) ||
          freezeDays < 1 ||
          freezeDays > remainingDays))
    )
      return;
    save.mutate();
  }
  return (
    <Modal
      open
      title={
        command === "cancel"
          ? "Cancel membership"
          : command === "reactivate"
            ? "Reactivate membership"
            : "Freeze membership"
      }
      onClose={() => {
        if (!save.isPending) onClose();
      }}
    >
      <form className="modal-form" onSubmit={submit} aria-busy={save.isPending}>
        <p>
          {subscription.planSnapshot?.name || "Membership"} ·{" "}
          {subscription.gymId?.name || "Gym unavailable"}
        </p>
        <p>
          {command === "cancel"
            ? "Cancelling ends access to this membership immediately. This action does not issue a refund."
            : command === "reactivate"
              ? "Gym access resumes immediately. Unused freeze days are returned and your membership end date is recalculated."
              : `Your membership pauses immediately and its end date extends by the selected duration. ${remainingDays} freeze days remain.`}
        </p>
        {command === "freeze" && (
          <label className="field">
            <span>Freeze for (days)</span>
            <input
              className="input"
              type="number"
              min={1}
              max={remainingDays}
              step={1}
              required
              value={freezeDays}
              disabled={save.isPending}
              onChange={(event) => setFreezeDays(Number(event.target.value))}
            />
          </label>
        )}
        <label className="field">
          <span>Reason</span>
          <textarea
            className="textarea"
            required
            maxLength={1000}
            value={reason}
            disabled={save.isPending}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {save.isError && (
          <p className="form-alert" role="alert">
            {save.error.message}
          </p>
        )}
        <div className="heading-actions">
          <button
            className="btn btn-primary"
            disabled={save.isPending || !reason.trim()}
          >
            {save.isPending && (
              <LoaderCircle
                size={18}
                className="subscription-spinner"
                aria-hidden="true"
              />
            )}
            {save.isPending ? "Submitting…" : "Confirm request"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={save.isPending}
            onClick={onClose}
          >
            Keep membership
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function MemberSubscriptions() {
  const location = useLocation();
  const joinedGymName: unknown = location.state?.joinedGymName;
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [notice, setNotice] = useState("");
  const path = `${resourcePath}?${new URLSearchParams({ page: String(page), limit: "12", status, q: search })}`;
  const query = useQuery({
    queryKey: ["api", path],
    queryFn: () => apiRequest<ApiEnvelope<MemberSubscription[]>>(path),
    placeholderData: keepPreviousData,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const rows = query.data?.data || [];
  const meta = query.data?.meta;
  const activeGymJoined =
    typeof joinedGymName === "string" &&
    rows.some(
      (row) => row.status === "ACTIVE" && row.gymId?.name === joinedGymName,
    );
  function saved(subscription: MemberSubscription, command: Command) {
    // Only a confirmed backend response changes access; unrelated requests must not delay feedback.
    client.setQueriesData<ApiEnvelope<MemberSubscription[]>>(
      {
        queryKey: ["api"],
        predicate: (entry) =>
          typeof entry.queryKey[1] === "string" &&
          entry.queryKey[1].startsWith(resourcePath),
      },
      (previous) =>
        previous
          ? {
              ...previous,
              data: previous.data.map((row) =>
                row.publicId === subscription.publicId ? subscription : row,
              ),
            }
          : previous,
    );
    setSelection(null);
    setNotice(
      command === "cancel"
        ? "Membership cancelled."
        : command === "reactivate"
          ? "Membership reactivated. Your end date has been updated."
          : "Membership frozen. Your end date has been updated.",
    );
    void client.invalidateQueries({
      queryKey: ["api"],
      predicate: (entry) => {
        const cachedPath = entry.queryKey[1];
        return (
          typeof cachedPath === "string" &&
          [
            resourcePath,
            "/api/v1/users/me/subscriptions",
            "/api/v1/workspace/summary",
            "/api/v1/users/me/attendance",
            "/api/v1/users/classes",
            "/api/v1/workspace/records/bookings",
          ].some((prefix) => cachedPath.startsWith(prefix))
        );
      },
    });
  }
  return (
    <div className="page-stack member-subscriptions-page">
      <PageHeader>
        <div>
          <span className="eyebrow">Memberships</span>
          <h1>Your subscriptions</h1>
          <p>Manage your gym access, membership dates and plans.</p>
        </div>
        <Link className="btn btn-primary" to="/app/explore">
          Find a gym
        </Link>
      </PageHeader>
      {activeGymJoined && (
        <div className="panel subscription-notice" role="status">
          <strong>Welcome to {joinedGymName}</strong>
          <p>
            Your payment is verified and your gym membership is active. Your gym
            attendance scanner is available below.
          </p>
        </div>
      )}
      {notice && (
        <p className="subscription-notice" role="status">
          {notice}
        </p>
      )}
      <form
        className="panel subscriptions-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSearch(draftSearch.trim());
        }}
      >
        <label className="search-field">
          <span className="sr-only">Search subscriptions</span>
          <input
            placeholder="Search by gym name"
            value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
          />
        </label>
        <button className="btn btn-secondary">Search</button>
        <label className="field">
          <span className="sr-only">Membership status</span>
          <select
            className="select"
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
          >
            <option value="">All memberships</option>
            {statuses.map((value) => (
              <option value={value} key={value}>
                {value
                  .toLowerCase()
                  .replace(/_/g, " ")
                  .replace(/^./, (letter) => letter.toUpperCase())}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.isFetching && (
            <LoaderCircle
              size={18}
              className="subscription-spinner"
              aria-hidden="true"
            />
          )}
          {query.isFetching ? "Updating…" : "Refresh"}
        </button>
      </form>
      {query.isError && (
        <div className="panel state-card" role="alert">
          <p>Unable to load your memberships. {query.error.message}</p>
          <button
            className="btn btn-secondary"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </div>
      )}
      {query.isPending ? (
        <SubscriptionSkeleton />
      ) : !rows.length && !query.isError ? (
        <section className="panel subscription-empty">
          <CreditCard size={36} aria-hidden="true" />
          <h2>
            {search || status
              ? "No matching memberships"
              : "Your next workout starts here"}
          </h2>
          <p>
            {search || status
              ? "Try another gym name or membership status."
              : "You have no gym subscriptions yet. Explore gyms and choose a membership to get started."}
          </p>
          {search || status ? (
            <button
              className="btn btn-secondary"
              onClick={() => {
                setStatus("");
                setSearch("");
                setDraftSearch("");
                setPage(1);
              }}
            >
              Clear filters
            </button>
          ) : (
            <Link className="btn btn-primary" to="/app/explore">
              Explore gyms
            </Link>
          )}
        </section>
      ) : (
        <div className="member-subscription-grid" aria-busy={query.isFetching}>
          {rows.map((subscription) => {
            const plan = subscription.planSnapshot;
            const pending = subscription.status === "PENDING_PAYMENT";
            const started =
              !subscription.startsAt ||
              Date.parse(subscription.startsAt) <= Date.now();
            const current =
              subscription.status === "ACTIVE" &&
              started &&
              !!subscription.endsAt &&
              Date.parse(subscription.endsAt) > Date.now();
            const available = !!subscription.gymId?._id;
            const href = subscription.gymId?.slug
              ? `/app/gyms/${encodeURIComponent(subscription.gymId.slug)}${pending && plan?.planId ? `?plan=${encodeURIComponent(plan.planId)}` : ""}`
              : undefined;
            return (
              <article
                className="panel live-subscription-card"
                key={subscription.publicId}
              >
                <header>
                  <GymIdentity
                    name={subscription.gymId?.name || "Gym unavailable"}
                    logoUrl={subscription.gymId?.logoUrl}
                    subtitle={plan?.name || "Membership details unavailable"}
                  />
                  <StatusBadge status={subscription.status} />
                </header>
                <dl className="live-subscription-details">
                  <div>
                    <dt>
                      <CalendarDays size={16} aria-hidden="true" />
                      Starts
                    </dt>
                    <dd>{day(subscription.startsAt)}</dd>
                  </div>
                  <div>
                    <dt>Valid until</dt>
                    <dd>
                      {subscription.endsAt
                        ? day(subscription.endsAt)
                        : "After payment"}
                    </dd>
                  </div>
                  <div>
                    <dt>Membership total</dt>
                    <dd>{amount(plan?.totalMinor ?? plan?.priceMinor)}</dd>
                  </div>
                </dl>
                {pending && (
                  <p className="subscription-payment-note">
                    Payment is pending. Gym access begins only after payment is
                    verified.
                  </p>
                )}
                {subscription.status === "FROZEN" && (
                  <p className="subscription-payment-note">
                    Your membership is paused. Access resumes after your freeze
                    period.
                  </p>
                )}
                {subscription.status === "DEACTIVATED" && <p className="subscription-payment-note">Gym access has been deactivated. Contact your gym to request reactivation of any remaining paid validity.</p>}
                {subscription.status === "ACTIVE" && !started && (
                  <p className="subscription-payment-note">
                    Your membership starts on {day(subscription.startsAt)}. Your
                    attendance access will be available then.
                  </p>
                )}
                {!available && (
                  <p className="subscription-payment-note">
                    This gym is currently unavailable. Contact support for help
                    with your membership.
                  </p>
                )}
                <footer className="subscription-actions">
                  {current && available && (
                    <Link
                      className="btn btn-primary"
                      to={`/app/attendance/qr?gymId=${encodeURIComponent(subscription.gymId!._id)}`}
                    >
                      <QrCode size={18} aria-hidden="true" />
                      Scan gym QR
                    </Link>
                  )}
                  {subscription.status === "FROZEN" && available && (
                    <button
                      className="btn btn-primary"
                      disabled={query.isPlaceholderData}
                      onClick={() =>
                        setSelection({ subscription, command: "reactivate" })
                      }
                    >
                      Reactivate
                    </button>
                  )}
                  {href && (
                    <Link
                      className={`btn ${pending ? "btn-primary" : "btn-secondary"}`}
                      to={href}
                    >
                      {pending ? "Continue payment" : "Renew / change plan"}
                    </Link>
                  )}
                  {current && freezeDaysRemaining(subscription) > 0 && (
                    <button
                      className="btn btn-secondary"
                      disabled={query.isPlaceholderData}
                      onClick={() =>
                        setSelection({ subscription, command: "freeze" })
                      }
                    >
                      Freeze
                    </button>
                  )}
                  {["ACTIVE", "FROZEN", "GRACE"].includes(
                    subscription.status,
                  ) && (
                    <button
                      className="btn btn-secondary"
                      disabled={query.isPlaceholderData}
                      onClick={() =>
                        setSelection({ subscription, command: "cancel" })
                      }
                    >
                      Cancel
                    </button>
                  )}
                  {!available && (
                    <Link className="btn btn-secondary" to="/app/support">
                      Contact support
                    </Link>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}
      {!!rows.length && (
        <footer className="table-footer panel">
          <span>
            {meta?.total ?? rows.length} memberships · Page {meta?.page || page}{" "}
            of {meta?.pages || 1}
          </span>
          <div>
            <button
              disabled={page <= 1 || query.isFetching}
              onClick={() => setPage((previous) => previous - 1)}
            >
              Previous
            </button>
            <button
              disabled={page >= (meta?.pages || 1) || query.isFetching}
              onClick={() => setPage((previous) => previous + 1)}
            >
              Next
            </button>
          </div>
        </footer>
      )}
      {selection && (
        <SubscriptionCommand
          key={`${selection.subscription.publicId}-${selection.command}`}
          selection={selection}
          onClose={() => setSelection(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}
