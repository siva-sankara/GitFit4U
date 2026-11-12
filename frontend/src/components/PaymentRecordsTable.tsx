import type { ReactNode } from "react";
import { ReceiptText } from "lucide-react";
import { ListViewport, OverflowText } from "./ListViewport";
import { PaymentPricing } from "./PaymentPricing";
import { StatusBadge } from "./StatusBadge";
import type { Row } from "../pages/live/LiveData";
import "../styles/payments.css";

const readable = (value?: string) => value ? value.toLowerCase().replaceAll("_", " ").replace(/^./, first => first.toUpperCase()) : "Not provided";
const methodName = (payment: Row) => ({ UPI: "UPI", CARD: "Card", CARD_POS: "Card / POS", CASH: "Cash", BANK_TRANSFER: "Bank transfer", NETBANKING: "Net banking" }[String(payment.methodCategory)] || readable(payment.methodCategory || payment.provider));

function PaymentDate({ value, timezone }: { value?: string; timezone?: string }) {
  if (!value || Number.isNaN(new Date(value).getTime())) return <span>—</span>;
  const date = new Date(value);
  let timeZone = timezone || "Asia/Kolkata";
  try { new Intl.DateTimeFormat("en-IN", { timeZone }); } catch { timeZone = "Asia/Kolkata"; }
  const options = { timeZone };
  return <time dateTime={value} title={date.toLocaleString("en-IN", options)}>
    <span>{date.toLocaleDateString("en-IN", { ...options, day: "2-digit", month: "short", year: "numeric" })}</span>
    <small>{date.toLocaleTimeString("en-IN", { ...options, hour: "2-digit", minute: "2-digit" })}</small>
  </time>;
}

export function PaymentRecordsTable({ rows, resetKey, actions }: {
  rows: Row[];
  resetKey: string;
  actions: (payment: Row) => ReactNode;
}) {
  if (!rows.length) return null;
  return <ListViewport label="Payments" resetKey={resetKey} className="payments-viewport">
    <table className="payments-table">
      <colgroup><col className="payment-payer-column" /><col className="payment-purpose-column" /><col className="payment-amount-column" /><col className="payment-status-column" /><col className="payment-date-column" /><col className="payment-actions-column" /></colgroup>
      <thead><tr>{["Payer / reference", "Payment for", "Amount", "Status / method", "Created", "Actions"].map(title => <th scope="col" key={title}>{title}</th>)}</tr></thead>
      <tbody>{rows.map(payment => <tr key={payment.publicId}>
        <td className="payment-payer-cell"><div className="payment-payer"><span className="payment-receipt-icon" aria-hidden="true"><ReceiptText size={18} /></span><div><OverflowText className="payment-payer-name">{payment.payerId?.name || "Payer unavailable"}</OverflowText><OverflowText className="payment-reference">{payment.publicId}</OverflowText></div></div></td>
        <td data-label="Payment for" className="payment-purpose-cell"><OverflowText>{readable(payment.purpose)}</OverflowText>{payment.gymId?.name && <small><OverflowText>{payment.gymId.name}</OverflowText></small>}</td>
        <td data-label="Amount" className="payment-amount-cell"><PaymentPricing payment={payment} /></td>
        <td data-label="Status / method" className="payment-status-cell"><StatusBadge status={payment.status} /><small><OverflowText>{methodName(payment)}</OverflowText></small></td>
        <td data-label="Created" className="payment-date-cell"><PaymentDate value={payment.createdAt} timezone={payment.gymId?.timezone} /></td>
        <td className="payment-actions-cell"><div className="payment-row-actions">{actions(payment)}</div></td>
      </tr>)}</tbody>
    </table>
  </ListViewport>;
}
