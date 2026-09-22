import type { LucideIcon } from "lucide-react";

export function StatCard({ label, value, note, trend, icon: Icon, tone = "brand" }: { label: string; value: string; note?: string; trend?: string; icon: LucideIcon; tone?: "brand" | "teal" | "orange" | "violet" }) {
  return (
    <article className={`stat-card stat-${tone}`}>
      <div className="stat-icon"><Icon size={20} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <div>{trend && <em>{trend}</em>} {note && <small>{note}</small>}</div>
    </article>
  );
}
