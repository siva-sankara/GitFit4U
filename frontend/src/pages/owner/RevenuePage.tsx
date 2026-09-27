import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { QueryState, useData, money, type Row } from "../live/LiveData";
export function RevenuePage() {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = useData<Row>(`/api/v1/owner/revenue?${params}`),
    data = query.data?.data;
  const metrics: [string, string][] = [
    ["totalMinor", "Total revenue"],
    ["monthMinor", "Current month"],
    ["membershipMinor", "Membership revenue"],
    ["offlineMinor", "Offline payments"],
    ["onlineMinor", "Online payments"],
    ["pendingMinor", "Pending payments"],
  ];
  return (
    <div className="page-stack revenue-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Your gym's performance</span>
          <h1>Revenue</h1>
          <p>
            Captured revenue and recorded refunds, with pending payments shown
            separately.
          </p>
        </div>
      </header>
      <div className="table-toolbar">
        <label className="field">
          <span>From</span>
          <input
            className="input"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="field">
          <span>To</span>
          <input
            className="input"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button
          className="btn btn-secondary"
          onClick={() => {
            setFrom("");
            setTo("");
          }}
        >
          Reset
        </button>
      </div>
      <QueryState query={query}>
        {data && (
          <>
            <div className="revenue-kpis">
              {metrics.map(([key, label]) => (
                <article className="panel revenue-kpi" key={key}>
                  <span>{label}</span>
                  <strong>{money(data[key] || 0)}</strong>
                </article>
              ))}
            </div>
            <section className="panel form-section">
              <h2>Revenue over time</h2>
              {data.series?.length ? (
                <div className="revenue-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={data.series.map((row: Row) => ({
                        date: row.date,
                        amount: row.amountMinor / 100,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" minTickGap={35} />
                      <YAxis width={70} />
                      <Tooltip
                        formatter={(value) => money(Number(value) * 100)}
                      />
                      <Area
                        dataKey="amount"
                        name="Revenue"
                        stroke="var(--brand-strong)"
                        fill="var(--brand)"
                        fillOpacity={0.16}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p>No captured revenue in this period.</p>
              )}
            </section>
          </>
        )}
      </QueryState>
    </div>
  );
}
