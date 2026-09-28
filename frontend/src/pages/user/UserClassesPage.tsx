import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ClassCard } from "../../components/ClassCard";
import { StatusBadge } from "../../components/StatusBadge";
import { Action, QueryState, Table, useData, type Row } from "../live/LiveData";

export function UserClassesPage() {
  const [search, setSearch] = useSearchParams();
  const bookingId = search.get("booking") || "";
  const validBookingId = /^[a-f\d]{24}$/i.test(bookingId);
  const selectedBooking = useData<Row>(`/api/v1/users/classes/bookings/${encodeURIComponent(bookingId)}`, validBookingId);
  const [day, setDay] = useState(""), [page, setPage] = useState(1), [bookingPage, setBookingPage] = useState(1);
  const sessions = useData<Row[]>(
    `/api/v1/users/classes?${new URLSearchParams({ day, page: String(page), limit: "12" })}`,
  );
  const bookings = useData<Row[]>(
    `/api/v1/workspace/records/bookings?limit=20&page=${bookingPage}`,
  );
  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <h1>Classes and bookings</h1>
          <p>Find a session and book using your eligible gym membership.</p>
        </div>
      </header>
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
          <p>No upcoming classes match this date.</p>
        )}
      </QueryState>
      <nav className="table-footer" aria-label="Class pages">
        <button disabled={page <= 1 || sessions.isPending} onClick={() => setPage(page - 1)}>Previous classes</button>
        <span>Page {page} of {sessions.data?.meta?.pages || 1}</span>
        <button disabled={sessions.isPending || page >= (sessions.data?.meta?.pages || 1)} onClick={() => setPage(page + 1)}>Next classes</button>
      </nav>
      <section className="panel form-section">
        <h2>Your bookings</h2>
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
        <nav className="table-footer" aria-label="Booking pages">
          <button disabled={bookingPage <= 1 || bookings.isPending} onClick={() => setBookingPage(bookingPage - 1)}>Previous bookings</button>
          <span>Page {bookingPage} of {bookings.data?.meta?.pages || 1}</span>
          <button disabled={bookings.isPending || bookingPage >= (bookings.data?.meta?.pages || 1)} onClick={() => setBookingPage(bookingPage + 1)}>Next bookings</button>
        </nav>
      </section>
    </div>
  );
}
