import { useState, type ReactNode } from "react";
import { Avatar } from "./Avatar";
import { StatusBadge } from "./StatusBadge";
import "../styles/classes.css";

export function ClassCard({
  session,
  actions,
}: {
  session: Record<string, any>;
  actions?: ReactNode;
}) {
  const timezone =
    session.gymId?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const start = new Date(session.startsAt),
    end = new Date(session.endsAt);
  const slots = Math.max(0, session.capacity - session.bookedCount);
  const [failedImage, setFailedImage] = useState<string>();
  return (
    <article className="class-card panel">
      {session.imageUrl && failedImage !== session.imageUrl ? <img className="class-image" src={session.imageUrl}
        alt={`${session.name} class`} loading="lazy" decoding="async" width={640} height={360}
        referrerPolicy="no-referrer" onError={() => setFailedImage(session.imageUrl)} />
        : <div className="class-image class-image-fallback" aria-hidden="true"><span>{session.category || "FITNESS"}</span></div>}
      <header>
        <span className="eyebrow">{session.category || "Fitness"}</span>
        <StatusBadge status={session.status} />
      </header>
      <h3>{session.name}</h3>
      {session.gymId?.name && <small>{session.gymId.name}</small>}
      <div className="class-trainer">
        <Avatar
          name={session.trainerId?.name || "Gym team"}
          src={session.trainerId?.photoUrl}
          thumbnailSrc={session.trainerId?.photoThumbnailUrl}
          size={28}
        />
        <span>{session.trainerId?.name || "Trainer to be assigned"}</span>
      </div>
      <dl>
        <div>
          <dt>Date</dt>
          <dd>
            {start.toLocaleDateString("en-GB", {
              timeZone: timezone,
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>
            {start.toLocaleTimeString([], {
              timeZone: timezone,
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            · {Math.round((end.getTime() - start.getTime()) / 60000)} min
          </dd>
        </div>
        <div>
          <dt>Places</dt>
          <dd>
            {slots} available / {session.capacity}
          </dd>
        </div>
        <div>
          <dt>Room</dt>
          <dd>{session.room || "At the gym"}</dd>
        </div>
      </dl>
      <small className="class-timezone">{timezone.replaceAll("_", " ")}</small>
      {session.description && (
        <p className="class-description">{session.description}</p>
      )}
      {session.cancellationReason && <p>{session.cancellationReason}</p>}
      {actions && <footer className="heading-actions">{actions}</footer>}
    </article>
  );
}
