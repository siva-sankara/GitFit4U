import { useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ChevronLeft, ChevronRight, Flame } from "lucide-react";
import { QueryState, Table, useData, type Row } from "../live/LiveData";
import "../../styles/account-hub.css";

export interface AttendanceSummary {
  month: string; timezone: string; today: string;
  currentStreak: number; longestStreak: number; totalAttendance: number;
  monthlyAttendance: number; attendedDays: string[];
  lastAttendanceDate: string | null; lastCheckIn: string | null;
}
interface AttendanceData { summary: AttendanceSummary; events: Row[] }
export function shiftMonth(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}
function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}
function instant(value: string | null, timezone: string) {
  return value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value)) : "No check-ins yet";
}
export function StreakKpi() {
  const query = useData<AttendanceData>("/api/v1/users/me/attendance?limit=1");
  const summary = query.data?.data.summary;
  return <article className="panel streak-kpi"><QueryState query={query}>
    {summary && <Link to="/app/attendance" aria-label={`View attendance: ${summary.currentStreak} day streak`}>
      <Flame aria-hidden="true" /><span><strong>{summary.currentStreak} day streak</strong><small>Longest: {summary.longestStreak} days · View attendance</small></span>
    </Link>}
  </QueryState></article>;
}
export function AttendanceCalendar({ summary, onMonth, busy = false }: { summary: AttendanceSummary; onMonth: (month: string) => void; busy?: boolean }) {
  const first = new Date(`${summary.month}-01T00:00:00Z`);
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const attended = new Set(summary.attendedDays);
  const title = monthLabel(summary.month);
  return <section className="panel attendance-calendar" aria-label="Attendance streak calendar">
    <header><button className="icon-btn" aria-label="Previous month" disabled={busy} onClick={() => onMonth(shiftMonth(summary.month, -1))}><ChevronLeft /></button>
      <h2 aria-live="polite">{title}</h2>
      <button className="icon-btn" aria-label="Next month" disabled={busy || summary.month >= summary.today.slice(0, 7)} onClick={() => onMonth(shiftMonth(summary.month, 1))}><ChevronRight /></button></header>
    <div className="calendar-grid">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <span className="calendar-weekday" key={day}>{day}</span>)}
      {Array.from({ length: first.getUTCDay() }, (_, i) => <span key={`empty-${i}`} aria-hidden="true" />)}
      {Array.from({ length: days }, (_, i) => {
        const date = `${summary.month}-${String(i + 1).padStart(2, "0")}`;
        const future = date > summary.today, checked = !future && attended.has(date), today = date === summary.today;
        return <time key={date} dateTime={date} aria-current={today ? "date" : undefined} aria-label={`${date}${today ? ", today" : ""}, ${future ? "future date" : checked ? "attended" : "no attendance"}`} className={`calendar-day${checked ? " attended" : ""}${today ? " today" : ""}${future ? " future" : ""}`}>
          <span>{i + 1}</span>{checked && <Flame size={16} aria-hidden="true" />}
        </time>;
      })}
    </div>
    <p className="subtle calendar-legend"><Flame size={15} aria-hidden="true" /> Attended · Outlined: today · Timezone: {summary.timezone}</p>
  </section>;
}
export function AttendancePage() {
  const [month, setMonth] = useState(""), [page, setPage] = useState(1), [details, setDetails] = useState(false);
  const query = useData<AttendanceData>(`/api/v1/users/me/attendance?page=${page}&limit=20${month ? `&month=${month}` : ""}`);
  const data = query.data?.data, summary = data?.summary, meta = query.data?.meta;
  return <div className="page-stack account-attendance">
    <header className="page-heading"><div><h1>Attendance & streaks</h1><p>Progress from your verified gym check-ins, counted once per day.</p></div><Link className="btn btn-secondary" to="/app/attendance/qr">Scan gym QR</Link></header>
    <QueryState query={query}>{summary && <>
      <div className="account-stat-grid">
        <article className="panel"><Flame aria-hidden="true" /><span>Current streak</span><strong>{summary.currentStreak} days</strong></article>
        <article className="panel"><span>Longest streak</span><strong>{summary.longestStreak} days</strong></article>
        <article className="panel"><span>{monthLabel(summary.month)} attendance</span><strong>{summary.monthlyAttendance} days</strong></article>
        <article className="panel"><span>Last check-in</span><strong className="account-last-checkin">{instant(summary.lastCheckIn, summary.timezone)}</strong></article>
      </div>
      <AttendanceCalendar summary={summary} busy={query.isFetching} onMonth={value => { setMonth(value); setPage(1); }} />
      <p className="subtle">{summary.totalAttendance} total attendance days. A streak stays current when you attended today or yesterday.</p>
      <button className="btn btn-secondary attendance-details-toggle" aria-expanded={details} aria-controls="attendance-history" onClick={() => setDetails(!details)}><Activity size={18} aria-hidden="true" />{details ? "Hide Attendance Details" : "View Attendance Details"}</button>
      {details && <section id="attendance-history" className="panel"><h2>Attendance history</h2><p className="subtle">All recorded check-ins, newest first. Times shown in {summary.timezone}.</p>
        <Table rows={data?.events || []} columns={[
          { key: "occurredAt", title: "Check-in date & time", render: row => instant(row.occurredAt, summary.timezone) },
          { key: "gymId.name", title: "Gym" }, { key: "status", title: "Status", format: "status" },
          { key: "classSessionId.name", title: "Class / session", render: row => row.classSessionId?.name || row.classId?.name || "Gym check-in" },
        ]} />
        <footer className="table-footer"><span>{meta?.total || 0} records · Page {page} of {meta?.pages || 1}</span><div>
          <button disabled={page <= 1 || query.isFetching} onClick={() => setPage(value => value - 1)}>Previous</button>
          <button disabled={page >= (meta?.pages || 1) || query.isFetching} onClick={() => setPage(value => value + 1)}>Next</button>
        </div></footer>
      </section>}
    </>}</QueryState>
  </div>;
}
