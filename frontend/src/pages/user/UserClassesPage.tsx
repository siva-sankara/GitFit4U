import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "../../api/hooks";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { PageHeader } from "../../components/PageHeader";
import { Link, useSearchParams } from "react-router-dom";
import { ClassCard } from "../../components/ClassCard";
import { StatusBadge } from "../../components/StatusBadge";
import { Action, QueryState, Table, type Row } from "../live/LiveData";
import { Pagination } from "../../components/DataListControls";

function useMemberData<T>(path: string, userId?: string, enabled = true) {
  return useQuery({
    queryKey: ["api", path, userId],
    queryFn: ({ signal }) => apiRequest<ApiEnvelope<T>>(path, { signal }),
    enabled: Boolean(userId) && enabled,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    retry: false,
  });
}

export function UserClassesPage() {
  const userId = useCurrentUser().data?.data.user._id;
  const [search, setSearch] = useSearchParams();
  const bookingId = search.get("booking") || "";
  const validBookingId = /^[a-f\d]{24}$/i.test(bookingId);
  const selectedBooking = useMemberData<Row>(`/api/v1/users/classes/bookings/${encodeURIComponent(bookingId)}`, userId, validBookingId);
  const [day, setDay] = useState(""), [page, setPage] = useState(1), [sessionLimit, setSessionLimit] = useState(10), [bookingPage, setBookingPage] = useState(1), [bookingLimit, setBookingLimit] = useState(10);
  const [query, setQuery] = useState(""), [searchDraft, setSearchDraft] = useState("");
  useEffect(() => {
    const next = searchDraft.trim();
    if (next === query) return;
    const timer = window.setTimeout(() => { setQuery(next); setPage(1); }, 350);
    return () => window.clearTimeout(timer);
  }, [searchDraft, query]);
  const sessions = useMemberData<Row[]>(
    `/api/v1/users/classes?${new URLSearchParams({ day, q:query, page: String(page), limit: String(sessionLimit) })}`,
    userId,
  );
  const bookings = useMemberData<Row[]>(
    `/api/v1/workspace/records/bookings?limit=${bookingLimit}&page=${bookingPage}`,
    userId,
  );
  return (
    <div className="page-stack">
      <PageHeader>
        <div>
          <h1>Classes and bookings</h1>
          <p>Upcoming classes from your current eligible gym subscriptions. Past bookings remain in your history.</p>
        </div>
      </PageHeader>
      {bookingId && <section className="panel form-section page-stack" aria-label="Selected booking">
        <header className="page-heading"><h2>Your booking details</h2><button className="btn btn-secondary" onClick={() => setSearch((current) => { current.delete("booking"); return current; })}>Close details</button></header>
        {!validBookingId ? <p role="alert">This booking link is invalid.</p> : <QueryState query={selectedBooking}>
          {selectedBooking.data?.data && <><StatusBadge status={selectedBooking.data.data.status} />
            {selectedBooking.data.data.sessionId ? <ClassCard session={selectedBooking.data.data.sessionId} /> : <p>This class is no longer available.</p>}
            {selectedBooking.data.data.sessionId?.publicId && ["BOOKED", "WAITLISTED"].includes(selectedBooking.data.data.status) && new Date(selectedBooking.data.data.sessionId.startsAt) > new Date() &&
              <Action method="DELETE" path={`/api/v1/users/classes/${selectedBooking.data.data.sessionId.publicId}/bookings/${bookingId}`} confirmMessage="Cancel your place in this class?">Cancel booking</Action>}
          </>}
        </QueryState>}
      </section>}
      <form className="table-toolbar" onSubmit={event => { event.preventDefault(); setQuery(searchDraft.trim()); setPage(1); }}>
        <label className="field">
          <span>Search subscribed gym classes</span>
          <input className="input" type="search" maxLength={80} value={searchDraft} onChange={event => setSearchDraft(event.target.value)} />
        </label>
        <button className="btn btn-secondary">Search classes</button>
      </form>
      <label className="field class-status-filter">
        <span>Filter by gym-local date</span>
        <input
          className="input"
          type="date"
          value={day}
          onChange={(event) => { setDay(event.target.value); setPage(1); }}
        />
      </label>
      <QueryState query={sessions}>
        <div className="class-card-grid">
          {sessions.data?.data.map((row) => {
            const booking = row.myBooking;
            return (
              <ClassCard
                key={row.publicId}
                session={row}
                actions={
                  booking ? (
                    <Action
                      method="DELETE"
                      path={`/api/v1/users/classes/${row.publicId}/bookings/${booking._id}`}
                      confirmMessage="Cancel your place in this class?"
                    >
                      Cancel booking
                    </Action>
                  ) : row.bookedCount < row.capacity ? (
                    <Action
                      path={`/api/v1/users/classes/${row.publicId}/bookings`}
                    >
                      Book class
                    </Action>
                  ) : (
                    <span>Fully booked</span>
                  )
                }
              />
            );
          })}
        </div>
        {!sessions.data?.data.length && (
          <div className="state-card">
            {sessions.data?.meta?.eligibleGymCount === 0 ? <>
              <h2>No eligible gym subscriptions</h2>
              <p>Subscribe to a gym to see its classes. Expired, frozen, cancelled or not-yet-started memberships do not provide class access.</p>
              <Link className="btn btn-primary" to="/app/discover">Explore gyms</Link>
            </> : <p>No upcoming classes match your filters at your subscribed gyms.</p>}
          </div>
        )}
      </QueryState>
      <Pagination page={page} limit={sessionLimit} total={sessions.data?.meta?.total || 0} loading={sessions.isFetching} onPageChange={setPage} onLimitChange={(value) => { setSessionLimit(value); setPage(1); }} />
      <section className="panel form-section">
        <h2>Your bookings</h2>
        <p>Your booking history stays available when a membership ends or changes.</p>
        <QueryState query={bookings}>
          <Table
            rows={bookings.data?.data || []}
            columns={[
              { key: "sessionId.name", title: "Class", render: (booking) => <span>{booking.sessionId?.imageUrl && <img className="class-booking-image" src={booking.sessionId.imageUrl} alt="" loading="lazy" decoding="async" />} {booking.sessionId?.name || "Unavailable class"} <Link to={`?booking=${booking._id}`}>View booking</Link></span> },
              { key: "sessionId.startsAt", title: "Starts", format: "date" },
              { key: "status", title: "Status", format: "status" },
            ]}
            actions={(booking) => booking.sessionId?.publicId && ["BOOKED", "WAITLISTED"].includes(booking.status) && new Date(booking.sessionId.startsAt) > new Date()
              ? <Action method="DELETE" path={`/api/v1/users/classes/${booking.sessionId.publicId}/bookings/${booking._id}`} confirmMessage="Cancel your place in this class?">Cancel booking</Action>
              : null}
          />
        </QueryState>
        <Pagination page={bookingPage} limit={bookingLimit} total={bookings.data?.meta?.total || 0} loading={bookings.isFetching} onPageChange={setBookingPage} onLimitChange={(value) => { setBookingLimit(value); setBookingPage(1); }} />
      </section>
    </div>
  );
}
