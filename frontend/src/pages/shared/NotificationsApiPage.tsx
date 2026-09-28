import {
  Bell,
  Building2,
  CheckCheck,
  CreditCard,
  Dumbbell,
  Flame,
  Megaphone,
  RefreshCw,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useNotifications,
  useReadAllNotifications,
  useReadNotification,
  useDeleteNotifications,
} from "../../api/hooks";
import { Modal } from "../../components/Modal";
import { PushNotificationSettings } from "../../components/PushNotificationSettings";
import { safeReturnTo } from "../../services/authRedirect";
import type { InboxNotification } from "../../services/notificationAlerts";
import "../../styles/notifications.css";

const categories = [
  ["ALL", "All updates"],
  ["UNREAD", "Unread"],
  ["PAYMENT", "Payments"],
  ["SUBSCRIPTION", "Subscriptions"],
  ["MEMBERSHIP", "Memberships"],
  ["TRAINER", "Training"],
  ["ATTENDANCE", "Attendance"],
  ["PROMOTION", "Offers"],
  ["GYM", "Gym updates"],
  ["SYSTEM", "System"],
] as const;
type Filter = (typeof categories)[number][0];
const icons: Record<string, LucideIcon> = {
  PAYMENT: CreditCard,
  SUBSCRIPTION: CreditCard,
  MEMBERSHIP: CreditCard,
  ATTENDANCE: Flame,
  TRAINER: Dumbbell,
  PROMOTION: Megaphone,
  GYM: Building2,
};
const categoryLabel = (category: string) =>
  categories.find(([key]) => key === category)?.[1] || "Update";
const timestamp = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
};

export function NotificationsApiPage() {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [selected, setSelected] = useState<InboxNotification>();
  const [checked, setChecked] = useState<string[]>([]);
  const [deleteSelection, setDeleteSelection] = useState<{
    ids?: string[];
    all?: boolean;
  }>();
  const query = useNotifications(page, filter);
  const read = useReadNotification();
  const readAll = useReadAllNotifications();
  const remove = useDeleteNotifications();
  const navigate = useNavigate();
  const data = query.data?.data || [];
  const pages = Math.max(1, query.data?.meta?.pages || 1);
  const destination = safeReturnTo(selected?.actionUrl);

  useEffect(() => {
    if (query.isSuccess && page > pages) setPage(pages);
  }, [query.isSuccess, page, pages]);
  useEffect(() => setChecked([]), [page, filter]);

  return (
    <div className="page-stack notifications-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Stay up to date</span>
          <h1>Notifications</h1>
          <p>Your membership, payments and gym updates in one place.</p>
        </div>
        <div className="heading-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            aria-label="Refresh notifications"
          >
            <RefreshCw
              size={18}
              className={query.isFetching ? "notification-spin" : undefined}
            />
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => readAll.mutate()}
            disabled={readAll.isPending || query.isLoading || query.isError}
          >
            <CheckCheck size={18} />
            {readAll.isPending ? "Marking read…" : "Mark all read"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={
              query.isLoading ||
              query.isError ||
              !data.length ||
              remove.isPending
            }
            onClick={() => setDeleteSelection({ all: true })}
          >
            <Trash2 size={16} />
            Delete all
          </button>
        </div>
      </header>
      <PushNotificationSettings />
      {(read.isError || readAll.isError || remove.isError) && (
        <p className="form-alert" role="alert">
          {read.error?.message ||
            readAll.error?.message ||
            remove.error?.message}
        </p>
      )}
      <section
        className="panel notification-inbox"
        aria-label="Notification inbox"
        aria-busy={query.isFetching}
      >
        <div className="notification-toolbar">
          {!!data.length && (
            <div className="notification-selection">
              <label>
                <input
                  type="checkbox"
                  aria-label="Select all notifications on this page"
                  checked={data.every((row) => checked.includes(row._id))}
                  onChange={(event) =>
                    setChecked(
                      event.target.checked ? data.map((row) => row._id) : [],
                    )
                  }
                />
                Select page
              </label>
              {checked.length > 0 && (
                <button
                  className="btn btn-secondary"
                  onClick={() => setDeleteSelection({ ids: checked })}
                >
                  <Trash2 size={15} />
                  Delete selected ({checked.length})
                </button>
              )}
            </div>
          )}
          <div
            className="notification-filters"
            role="group"
            aria-label="Filter notifications"
          >
            {categories.map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={filter === value ? "active" : undefined}
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value);
                  setPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {query.isLoading ? (
          <div
            className="notification-loading"
            role="status"
            aria-label="Loading notifications"
          >
            <span className="sr-only">Loading notifications…</span>
            {[0, 1, 2, 3].map((id) => (
              <div
                className="notification-skeleton"
                key={id}
                aria-hidden="true"
              >
                <span />
                <div>
                  <i />
                  <i />
                </div>
              </div>
            ))}
          </div>
        ) : query.isError ? (
          <div className="state-card error" role="alert">
            <Bell size={28} />
            <strong>Unable to load notifications</strong>
            <p>Please try again in a moment.</p>
            <button
              className="btn btn-secondary"
              onClick={() => void query.refetch()}
            >
              Try again
            </button>
          </div>
        ) : data.length === 0 ? (
          <div className="state-card">
            <Bell size={32} />
            <strong>
              {filter === "UNREAD"
                ? "You're all caught up"
                : "No updates here yet"}
            </strong>
            <p>
              New{" "}
              {filter === "ALL" || filter === "UNREAD"
                ? "notifications"
                : categoryLabel(filter).toLowerCase()}{" "}
              will appear here.
            </p>
          </div>
        ) : (
          <div className="notification-list">
            {data.map((notification) => {
              const Icon = icons[notification.category] || Bell;
              return (
                <div className="notification-row" key={notification._id}>
                  <label className="notification-checkbox">
                    <input
                      type="checkbox"
                      aria-label={`Select ${notification.title}`}
                      checked={checked.includes(notification._id)}
                      onChange={(event) =>
                        setChecked((old) =>
                          event.target.checked
                            ? [...old, notification._id]
                            : old.filter((id) => id !== notification._id),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    key={notification._id}
                    className={`notification-item${notification.readAt ? "" : " unread"}`}
                    onClick={() => {
                      setSelected({
                        ...notification,
                        readAt: notification.readAt || new Date().toISOString(),
                      });
                      if (!notification.readAt && !read.isPending)
                        read.mutate(notification._id);
                    }}
                  >
                    <span className="notification-icon" aria-hidden="true">
                      <Icon size={21} />
                    </span>
                    <span className="notification-copy">
                      <span className="notification-category">
                        {categoryLabel(notification.category)}
                      </span>
                      <strong>{notification.title}</strong>
                      <span className="notification-preview">
                        {notification.message}
                      </span>
                    </span>
                    <span className="notification-meta">
                      <time dateTime={notification.createdAt}>
                        {timestamp(notification.createdAt)}
                      </time>
                      {!notification.readAt && (
                        <span className="notification-unread-label">
                          Unread
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    className="notification-delete"
                    aria-label={`Delete ${notification.title}`}
                    onClick={() =>
                      setDeleteSelection({ ids: [notification._id] })
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {!query.isLoading &&
          !query.isError &&
          (query.data?.meta?.total || 0) > 0 && (
            <footer className="table-footer notification-pagination">
              <span>
                Page {page} of {pages}
              </span>
              <div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={page <= 1 || query.isFetching}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={page >= pages || query.isFetching}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </button>
              </div>
            </footer>
          )}
      </section>
      <Modal
        open={Boolean(selected)}
        title={selected?.title || "Notification"}
        onClose={() => setSelected(undefined)}
      >
        {selected && (
          <div className="notification-detail">
            <span className="notification-category">
              {categoryLabel(selected.category)}
            </span>
            <p>{selected.message}</p>
            <dl className="notification-detail-grid">
              <div>
                <dt>Source</dt>
                <dd>{selected.source || "GETFIT4U"}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{selected.readAt ? "Read" : "Unread"}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{new Date(selected.createdAt).toLocaleDateString()}</dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>
                  {new Date(selected.createdAt).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </dd>
              </div>
              {selected.metadata?.gymName && (
                <div>
                  <dt>Gym</dt>
                  <dd>{selected.metadata.gymName}</dd>
                </div>
              )}
              {selected.metadata?.planName && (
                <div>
                  <dt>Plan</dt>
                  <dd>{selected.metadata.planName}</dd>
                </div>
              )}
              {selected.metadata?.expiresAt && (
                <div>
                  <dt>Expiry</dt>
                  <dd>
                    {new Date(selected.metadata.expiresAt).toLocaleDateString(
                      undefined,
                      {
                        timeZone: selected.metadata.timeZone || "UTC",
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      },
                    )}
                  </dd>
                </div>
              )}
            </dl>
            {!!selected.metadata?.benefits?.length && (
              <section>
                <h3>Plan benefits</h3>
                <ul>
                  {selected.metadata.benefits.map((benefit) => (
                    <li key={benefit}>{benefit}</li>
                  ))}
                </ul>
              </section>
            )}
            {!!selected.metadata?.availablePlans?.length && (
              <section>
                <h3>Available renewal plans</h3>
                <ul>
                  {selected.metadata.availablePlans.map((plan) => (
                    <li key={plan.publicId}>
                      <strong>{plan.name}</strong> · {plan.durationDays} days ·{" "}
                      {(plan.priceMinor / 100).toLocaleString(undefined, {
                        style: "currency",
                        currency: "INR",
                      })}
                      {plan.benefits?.length ? (
                        <p>{plan.benefits.join(" · ")}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {destination && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setSelected(undefined);
                  navigate(destination);
                }}
              >
                {selected.actionLabel || "View details"}
              </button>
            )}
          </div>
        )}
      </Modal>
      <Modal
        open={!!deleteSelection}
        title={
          deleteSelection?.all
            ? "Delete all notifications?"
            : "Delete notifications?"
        }
        onClose={() => {
          if (!remove.isPending) setDeleteSelection(undefined);
        }}
      >
        <div className="notification-detail">
          <p>
            {deleteSelection?.all
              ? "This removes every notification from your inbox, including other pages and categories."
              : `Remove ${deleteSelection?.ids?.length || 0} notification(s) from your inbox?`}{" "}
            Related memberships, payments and conversations are not deleted.
          </p>
          {remove.isError && <p role="alert">{remove.error.message}</p>}
          <div className="notification-confirm-actions">
            <button
              className="btn btn-secondary"
              disabled={remove.isPending}
              onClick={() => setDeleteSelection(undefined)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(
                  {
                    ...deleteSelection,
                    ...(deleteSelection?.all ? { confirmed: true } : {}),
                  },
                  {
                    onSuccess: () => {
                      setDeleteSelection(undefined);
                      setChecked([]);
                      setSelected(undefined);
                    },
                  },
                )
              }
            >
              {remove.isPending ? "Deleting…" : "Confirm delete"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
