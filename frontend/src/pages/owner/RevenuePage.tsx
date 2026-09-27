import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceDot,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { QueryState, useData, money, type Row } from "../live/LiveData";
export function RevenuePage() {
  return <RevenueAnalytics />;
}
export function RevenueAnalytics({ embedded = false }: { embedded?: boolean }) {
  const [period, setPeriod] = useState("month");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const params = new URLSearchParams();
  params.set("period", period);
  if (period === "custom" && from) params.set("from", from);
  if (period === "custom" && to) params.set("to", to);
  const query = useData<Row>(`/api/v1/owner/revenue?${params}`),
    data = query.data?.data;
  const metrics: [string, string][] = [
    ["totalMinor", "Net membership revenue"],
    ["grossMinor", "Captured receipts"],
    ["refundMinor", "Processed refunds"],
    ["offlineMinor", "Offline payments"],
    ["onlineMinor", "Online payments"],
    ["pendingMinor", "Pending payments"],
  ];
  const peak = data?.series?.reduce(
    (best: Row | null, row: Row) =>
      !best || row.amountMinor > best.amountMinor ? row : best,
    null,
  );
  return (
    <div className="page-stack revenue-page">
      {!embedded && (
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
      )}
      {embedded && <h2>Revenue analytics</h2>}
      <div className="table-toolbar">
        <label className="field">
          <span>Period</span>
          <select
            className="select"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            {[
              ["today", "Today"],
              ["7d", "7 days"],
              ["month", "This month"],
              ["last-month", "Last month"],
              ["3m", "3 months"],
              ["6m", "6 months"],
              ["year", "This year"],
              ["custom", "Custom range"],
              ["all", "All time"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {period === "custom" && (
          <>
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
          </>
        )}
        <button
          className="btn btn-secondary"
          onClick={() => {
            setFrom("");
            setTo("");
            setPeriod("month");
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
              <article className="panel revenue-kpi">
                <span>Transactions</span>
                <strong>{data.transactionCount || 0}</strong>
              </article>
            </div>
            <section className="panel form-section">
              <h2>Revenue over time</h2>
              <p>
                Dates use {data.dateRangeTimezone}. Refunds reduce the original
                receipt's revenue.
              </p>
              {data.series?.length ? (
                <div className="revenue-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={data.series.map((row: Row) => ({
                        date: row.date,
                        amount: row.amountMinor / 100,
                        transactionCount: row.transactionCount || 0,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" minTickGap={35} />
                      <YAxis width={70} />
                      <Tooltip
                        content={({ active, payload, label }) =>
                          active && payload?.[0] ? (
                            <div className="panel revenue-tooltip">
                              <strong>{String(label)}</strong>
                              <p>{money(Number(payload[0].value) * 100)}</p>
                              <small>
                                {payload[0].payload.transactionCount}{" "}
                                transactions
                              </small>
                            </div>
                          ) : null
                        }
                      />
                      <Area
                        dataKey="amount"
                        name="Revenue"
                        stroke="var(--brand-strong)"
                        fill="var(--brand)"
                        fillOpacity={0.16}
                      />
                      {peak?.amountMinor > 0 && (
                        <ReferenceDot
                          x={peak.date}
                          y={peak.amountMinor / 100}
                          r={5}
                          fill="var(--brand-strong)"
                          stroke="var(--surface-solid)"
                          label={{
                            value: "Peak",
                            position: "top",
                            fill: "var(--text)",
                          }}
                        />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p>No captured revenue in this period.</p>
              )}
              {peak?.amountMinor > 0 && (
                <p className="revenue-peak-summary">
                  Peak: {peak.date} · {money(peak.amountMinor)} ·{" "}
                  {peak.transactionCount || 0} transactions.
                </p>
              )}
            </section>
          </>
        )}
      </QueryState>
    </div>
  );
}
