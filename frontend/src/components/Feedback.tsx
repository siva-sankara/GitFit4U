import { CheckCircle2, Inbox, RefreshCw, WifiOff } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return <div className="feedback-state"><span><Inbox size={26} /></span><h3>{title}</h3><p>{message}</p>{action}</div>;
}

export function ErrorState({ retry }: { retry?: () => void }) {
  return <div className="feedback-state"><span><WifiOff size={26} /></span><h3>We couldn’t load this</h3><p>Your information is safe. Check your connection and try again.</p>{retry && <button className="btn btn-secondary" onClick={retry}><RefreshCw size={17} /> Retry</button>}</div>;
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return <div className="skeleton-stack" aria-label="Loading">{Array.from({ length: count }, (_, index) => <div className="skeleton-row" key={index} />)}</div>;
}

export function SuccessState({ title, message }: { title: string; message: string }) {
  return <div className="feedback-state success-state"><span><CheckCircle2 size={28} /></span><h3>{title}</h3><p>{message}</p></div>;
}
