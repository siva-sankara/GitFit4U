import { ArrowRight, Check, Flag, MessageSquare, Ticket, UserRound } from "lucide-react";

type Person = { _id?: string; name?: string };
type PersonRef = Person | string | null;
type Change = { _id?: string; type?: string; from?: string; to?: string; actorId?: PersonRef; at?: string };
type SupportTicket = { status?: string; createdAt?: string; requesterId?: PersonRef; assignedTo?: PersonRef; activity?: Change[] };
type Reply = { _id?: string; publicId?: string; senderId?: PersonRef; createdAt?: string; deletedAt?: string; attachments?: unknown[] };
type Activity = { id: string; kind: "created" | "reply" | "status" | "priority" | "assignment"; title: string; actor: string; at?: string; from?: string; to?: string; detail?: string };

const stages = [
  { value: "OPEN", label: "Open", hint: "Your request is waiting for review." },
  { value: "IN_PROGRESS", label: "In progress", hint: "Support is working on this request." },
  { value: "WAITING_FOR_USER", label: "Awaiting reply", hint: "Support needs a response from the requester to continue." },
  { value: "RESOLVED", label: "Resolved", hint: "A resolution has been recorded. Reopen the ticket if you still need help." },
  { value: "CLOSED", label: "Closed", hint: "This ticket is closed. You can reopen it if you need more help." },
];
const personId = (person?: PersonRef) => typeof person === "string" ? person : person?._id;
const personName = (person?: PersonRef) => typeof person === "object" ? person?.name : undefined;
const readable = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, first => first.toUpperCase());
const timestamp = (value?: string) => value ? new Date(value).getTime() || 0 : 0;

export function TicketActivityTime({ value }: { value?: string }) {
  return timestamp(value) ? <time dateTime={value}>{new Date(value!).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</time> : <span>Time unavailable</span>;
}

export function SupportTicketProgress({ ticket }: { ticket?: SupportTicket }) {
  const current = ticket?.status || "OPEN";
  // A ticket can skip a stage or be reopened. Only mark recorded stages as visited.
  const visited = new Set(["OPEN", ...(ticket?.activity || []).filter(entry => entry.type === "STATUS").flatMap(entry => [entry.from, entry.to])]);
  return <section className="support-progress" aria-label="Ticket progress">
    <div className="support-section-heading"><h3>Ticket flow</h3><span>Current stage: {stages.find(stage => stage.value === current)?.label || readable(current)}</span></div>
    <ol className="support-progress-steps">{stages.map((stage, index) => {
      const active = stage.value === current, seen = visited.has(stage.value);
      return <li key={stage.value} className={active ? "is-current" : seen ? "is-visited" : ""} aria-current={active ? "step" : undefined}>
        <span className="support-step-marker" aria-hidden="true">{seen && !active ? <Check size={14} /> : index + 1}</span>
        <span><strong>{stage.label}</strong><small>{active ? "Current" : seen ? "Previously visited" : "Not visited"}</small></span>
      </li>;
    })}</ol>
    <p>{stages.find(stage => stage.value === current)?.hint}</p>
  </section>;
}

export function SupportTicketActivity({ ticket, replies, assignees = [], hasEarlierReplies = false }: {
  ticket?: SupportTicket;
  replies: Reply[];
  assignees?: Person[];
  hasEarlierReplies?: boolean;
}) {
  const requester = personName(ticket?.requesterId) || personName(replies.find(reply => personId(reply.senderId) === personId(ticket?.requesterId) && personId(ticket?.requesterId))?.senderId) || "Requester";
  const assignmentName = (id?: string) => !id ? "Unassigned" : assignees.find(person => person._id === id)?.name || (personId(ticket?.assignedTo) === id ? personName(ticket?.assignedTo) : undefined) || "Support agent";
  const activities: Activity[] = [{ id: "created", kind: "created", title: "Ticket opened", actor: requester, at: ticket?.createdAt }];
  for (const [index, entry] of (ticket?.activity || []).entries()) {
    const assignment = entry.type === "ASSIGNMENT", status = entry.type === "STATUS";
    activities.push({
      id: `change-${entry._id || index}`,
      kind: assignment ? "assignment" : status ? "status" : "priority",
      title: assignment ? "Assignment updated" : status ? (entry.to === "OPEN" && ["RESOLVED", "CLOSED"].includes(entry.from || "") ? "Ticket reopened" : "Status changed") : entry.type === "PRIORITY" ? "Priority changed" : "Ticket updated",
      actor: personName(entry.actorId) || "Support",
      at: entry.at,
      from: assignment ? assignmentName(entry.from) : entry.from ? readable(entry.from) : undefined,
      to: assignment ? assignmentName(entry.to) : entry.to ? readable(entry.to) : undefined,
    });
  }
  const seen = new Set<string>();
  for (const [index, reply] of replies.entries()) {
    const id = `reply-${reply.publicId || reply._id || index}`;
    if (seen.has(id)) continue;
    seen.add(id);
    activities.push({ id, kind: "reply", title: "Reply added", actor: personName(reply.senderId) || "Participant", at: reply.createdAt,
      detail: reply.deletedAt ? "Reply has been deleted" : reply.attachments?.length ? `${reply.attachments.length} attachment${reply.attachments.length === 1 ? "" : "s"}` : undefined });
  }
  activities.sort((a, b) => timestamp(b.at) - timestamp(a.at));
  const icons = { created: Ticket, reply: MessageSquare, status: ArrowRight, priority: Flag, assignment: UserRound };
  return <section aria-label="Ticket activity">
    <div className="support-section-heading"><h3>Activity</h3><span>Latest first</span></div>
    <ol className="support-activity-list">{activities.map(entry => {
      const Icon = icons[entry.kind];
      return <li key={entry.id}>
        <span className={`support-activity-marker support-activity-${entry.kind}`} aria-hidden="true"><Icon size={15} /></span>
        <div className="support-activity-content"><strong>{entry.title}</strong>
          {(entry.from || entry.to) && <p className="support-activity-transition">{entry.from && <span>{entry.from}</span>}{entry.from && entry.to && <span aria-hidden="true">→</span>}{entry.from && entry.to && <span className="sr-only">to</span>}{entry.to && <span>{entry.to}</span>}</p>}
          {entry.detail && <p>{entry.detail}</p>}
          <span className="support-activity-actor">{entry.actor}</span><small><TicketActivityTime value={entry.at} /></small>
        </div>
      </li>;
    })}</ol>
    {hasEarlierReplies && <p className="subtle">Load earlier replies to include older reply activity.</p>}
  </section>;
}
