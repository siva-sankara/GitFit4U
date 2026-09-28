import { useState } from "react";
import { ClassCard } from "../../components/ClassCard";
import { Action, QueryState, Table, useData, type Row } from "../live/LiveData";

export function UserClassesPage() {
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
              { key: "sessionId.name", title: "Class" },
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
