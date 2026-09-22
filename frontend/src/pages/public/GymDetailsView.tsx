import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Dumbbell,
  Heart,
  Images,
  MapPin,
  Phone,
  Play,
  Star,
  Users,
  X,
} from "lucide-react";
import { GymLocation } from "../../components/GymLocation";
import { validCoordinates } from "../../services/location";
import type { Row } from "../live/LiveData";
import "../../styles/gym-details.css";

const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const price = (value: number, currency = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value / 100);
const localDate = (
  value: string,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
) =>
  new Intl.DateTimeFormat("en-IN", { ...options, timeZone: timezone }).format(
    new Date(value),
  );
function MediaImage({
  src,
  alt,
  className = "",
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed ? (
    <div className={`gd-image-unavailable ${className}`}>
      <Images aria-hidden="true" />
      <span>Photo unavailable</span>
    </div>
  ) : (
    <img
      className={className}
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}
export function GymDetailsView({
  data,
  saved,
  onFavorite,
  onChoosePlan,
  onReview,
}: {
  data: Row;
  saved: boolean;
  onFavorite: () => void;
  onChoosePlan: (plan: Row) => void;
  onReview: () => void;
}) {
  const gym = data.gym,
    plans: Row[] = data.plans || [],
    classes: Row[] = data.classes || [],
    trainers: Row[] = data.trainers || [],
    reviews: Row[] = data.reviews || [];
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    galleryTrigger = useRef<HTMLButtonElement | null>(null);
  const candidates = [
    ...(gym.coverImageUrl
      ? [{ url: gym.coverImageUrl, type: "photo", name: `${gym.name} cover` }]
      : []),
    ...(gym.media || []).map((m: Row) => ({
      url: m.url,
      type: m.mimeType?.startsWith("video/") ? "video" : "photo",
      name: m.name || gym.name,
    })),
    ...(gym.gallery || []).map((url: string, i: number) => ({
      url,
      type: "photo",
      name: `${gym.name} photo ${i + 1}`,
    })),
    ...(gym.videos || []).map((url: string, i: number) => ({
      url,
      type: "video",
      name: `${gym.name} video ${i + 1}`,
    })),
  ];
  const media = candidates.filter(
    (m, i) => m.url && candidates.findIndex((v) => v.url === m.url) === i,
  );
  const photos = media.filter((m) => m.type === "photo");
  const lowestPlan = plans.reduce<Row | undefined>(
    (lowest, p) => (!lowest || p.priceMinor < lowest.priceMinor ? p : lowest),
    undefined,
  );
  let timezone = gym.timezone || "Asia/Kolkata";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    timezone = "Asia/Kolkata";
  }
  const today = new Intl.DateTimeFormat("en", {
    weekday: "long",
    timeZone: timezone,
  }).format(new Date());
  const point = {
    longitude: gym.location?.coordinates?.[0],
    latitude: gym.location?.coordinates?.[1],
  };
  const address = [
    gym.address?.line1,
    gym.address?.line2,
    gym.address?.locality,
    gym.address?.city,
    gym.address?.state,
    gym.address?.postalCode,
  ]
    .filter(Boolean)
    .join(", ");
  const facilityItems = [
    ...new Set<string>([...(gym.facilities || []), ...(gym.amenities || [])]),
  ];
  useEffect(() => {
    if (galleryIndex !== null && !dialog.current?.open)
      dialog.current?.showModal();
    if (galleryIndex === null && dialog.current?.open) dialog.current.close();
  }, [galleryIndex]);
  function openGallery(index: number, trigger: HTMLButtonElement) {
    galleryTrigger.current = trigger;
    setGalleryIndex(index);
  }
  function closeGallery() {
    setGalleryIndex(null);
    galleryTrigger.current?.focus();
  }
  return (
    <div className="gd-page container">
      <div className="gd-breadcrumb">
        <Link to="/explore">
          <ArrowLeft size={16} /> Explore gyms
        </Link>
        <span>/</span>
        <span>{gym.name}</span>
      </div>
      <header className="gd-heading">
        <div>
          <span className="gd-kicker">FIND YOUR EVERYDAY STRONG</span>
          <h1>{gym.name}</h1>
          <div className="gd-meta">
            <span>
              <MapPin size={17} />
              {[gym.address?.locality, gym.address?.city]
                .filter(Boolean)
                .join(", ") || "Location details below"}
            </span>
            <a href="#gym-reviews">
              <Star size={17} />
              {gym.rating?.count
                ? `${Number(gym.rating.average).toFixed(1)} · ${gym.rating.count} reviews`
                : "No ratings yet"}
            </a>
          </div>
        </div>
        <button
          className={`btn btn-secondary gd-save ${saved ? "is-saved" : ""}`}
          aria-pressed={saved}
          onClick={onFavorite}
        >
          <Heart size={18} fill={saved ? "currentColor" : "none"} />
          {saved ? "Saved" : "Save gym"}
        </button>
      </header>
      <section
        className={`gd-gallery ${photos.length > 1 ? "has-thumbnails" : ""}`}
        aria-label="Gym photos"
      >
        {photos.length ? (
          <button
            className="gd-gallery-main"
            aria-label="Open gym photo gallery"
            onClick={(e) =>
              openGallery(media.indexOf(photos[0]), e.currentTarget)
            }
          >
            <MediaImage
              src={photos[0].url}
              alt={`${gym.name} training space`}
            />
            <span className="gd-gallery-caption">
              A closer look at your next gym <ArrowUpRight size={20} />
            </span>
          </button>
        ) : (
          <div className="gd-photo-placeholder">
            <Dumbbell size={52} strokeWidth={1.3} />
            <span>YOUR SPACE TO GROW</span>
            <strong>{gym.name}</strong>
            <p>Gym photos will appear here when added.</p>
          </div>
        )}
        {photos.length > 1 && (
          <div className="gd-gallery-thumbnails">
            {photos.slice(1, 3).map((m, i) => (
              <button
                key={m.url}
                aria-label={`View gym photo ${i + 2}`}
                onClick={(e) => openGallery(media.indexOf(m), e.currentTarget)}
              >
                <MediaImage src={m.url} alt={`${gym.name} space ${i + 2}`} />
              </button>
            ))}
          </div>
        )}
        {!!media.length && (
          <button
            className="gd-gallery-count"
            onClick={(e) => openGallery(0, e.currentTarget)}
          >
            <Images size={17} />
            View all media <span>{media.length}</span>
            {media.some((m) => m.type === "video") && (
              <Play size={15} aria-label="Includes videos" />
            )}
          </button>
        )}
      </section>
      <nav className="gd-section-nav" aria-label="Gym details sections">
        {[
          ["plans", "Memberships"],
          ["overview", "Overview"],
          ["classes", "Classes"],
          ["visit", "Location & hours"],
          ["reviews", "Reviews"],
        ].map(([id, name]) => (
          <a key={id} href={`#gym-${id}`}>
            {name}
          </a>
        ))}
      </nav>
      <div className="gd-layout">
        <div className="gd-content">
          <section id="gym-plans" className="gd-section">
            <div className="gd-section-heading">
              <div>
                <span className="gd-kicker">MAKE IT YOUR ROUTINE</span>
                <h2>Memberships that fit</h2>
              </div>
              <span className="gd-count">
                {plans.length} {plans.length === 1 ? "plan" : "plans"}
              </span>
            </div>
            <p>
              Choose a plan to join this gym. Your membership starts after
              payment is verified.
            </p>
            <div className="gd-plans">
              {plans.map((p) => (
                <article className="gd-plan" key={p._id || p.publicId}>
                  <div className="gd-plan-heading">
                    <span>
                      <CalendarDays size={16} />
                      {p.durationDays} days
                    </span>
                    <h3>{p.name}</h3>
                  </div>
                  <p className="gd-price">
                    {price(p.priceMinor, p.currency)}
                    <small>for the full plan</small>
                  </p>
                  {p.description && <p>{p.description}</p>}
                  <ul>
                    {p.benefits?.map((b: string) => (
                      <li key={b}>
                        <Check size={16} />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="gd-fine-print">
                    Taxes and discounts calculated at checkout.
                  </p>
                  <button
                    className="btn btn-primary"
                    onClick={() => onChoosePlan(p)}
                    aria-label={`Choose ${p.name}`}
                  >
                    Subscribe &amp; join <ArrowUpRight size={17} />
                  </button>
                </article>
              ))}
            </div>
            {!plans.length && (
              <div className="gd-empty">
                <CalendarDays />
                <div>
                  <h3>Memberships coming soon</h3>
                  <p>Contact the gym for current membership options.</p>
                </div>
              </div>
            )}
          </section>
          <section id="gym-overview" className="gd-section">
            <span className="gd-kicker">GET TO KNOW THE SPACE</span>
            <h2>A place for your next chapter</h2>
            <p className="gd-description">
              {gym.description ||
                "Explore the membership options and contact the gym to find the right fit for your routine."}
            </p>
            {!!facilityItems.length && (
              <>
                <h3>Everything you need</h3>
                <div className="gd-facilities">
                  {facilityItems.map((f) => (
                    <div key={f}>
                      <Check size={17} />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {!!gym.benefits?.length && (
              <div className="gd-benefits">
                <h3>More with your membership</h3>
                <ul>
                  {gym.benefits.map((b: string) => (
                    <li key={b}>
                      <Check size={17} />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <section id="gym-classes" className="gd-section">
            <div className="gd-section-heading">
              <div>
                <span className="gd-kicker">MOVE TOGETHER</span>
                <h2>Upcoming classes</h2>
              </div>
              <Link className="gd-text-link" to="/app/classes">
                View timetable <ArrowUpRight size={16} />
              </Link>
            </div>
            <div className="gd-class-list">
              {classes.map((c) => (
                <article key={c.publicId} className="gd-class">
                  <div className="gd-class-date">
                    <span>
                      {localDate(c.startsAt, timezone, { month: "short" })}
                    </span>
                    <strong>
                      {localDate(c.startsAt, timezone, { day: "2-digit" })}
                    </strong>
                  </div>
                  <div className="gd-class-info">
                    <span className="gd-kicker">
                      {c.category?.replaceAll("_", " ")}
                    </span>
                    <h3>{c.name}</h3>
                    <p>
                      <Clock3 size={14} />
                      {localDate(c.startsAt, timezone, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {c.room && ` · ${c.room}`}
                    </p>
                  </div>
                  <span className="gd-class-spaces">
                    <Users size={15} />
                    {Math.max(0, c.capacity - (c.bookedCount || 0))} spots left
                  </span>
                </article>
              ))}
            </div>
            {!classes.length && (
              <div className="gd-empty">
                <Users />
                <p>No upcoming sessions yet. Check back for the next class.</p>
              </div>
            )}
            {!!classes.length && (
              <small className="gd-fine-print">
                Class times shown in {timezone.replaceAll("_", " ")}.
              </small>
            )}
          </section>
          {!!trainers.length && (
            <section className="gd-section">
              <span className="gd-kicker">MEET YOUR SUPPORT TEAM</span>
              <h2>Train with guidance</h2>
              <div className="gd-trainers">
                {trainers.map((t) => (
                  <article key={t.publicId}>
                    {t.photoUrl ? (
                      <MediaImage
                        src={t.photoUrl}
                        alt={t.name}
                        className="gd-avatar"
                      />
                    ) : (
                      <span className="gd-avatar">{t.name?.charAt(0)}</span>
                    )}
                    <div>
                      <h3>{t.name}</h3>
                      <p>
                        {t.specializations?.join(" · ") ||
                          t.qualifications?.join(" · ")}
                      </p>
                      {t.bio && <p>{t.bio}</p>}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          <section id="gym-visit" className="gd-section">
            <span className="gd-kicker">PLAN YOUR FIRST VISIT</span>
            <h2>Find your way here</h2>
            <p className="gd-address">
              <MapPin size={20} />
              {address || "Contact the gym for the full address."}
            </p>
            {validCoordinates(point) && <GymLocation point={point} />}
            <div className="gd-visit-contact">
              {gym.contact?.phone && (
                <a
                  className="btn btn-secondary"
                  href={`tel:${gym.contact.phone}`}
                >
                  <Phone size={17} />
                  Call the gym
                </a>
              )}
              {gym.contact?.whatsapp && (
                <a
                  className="btn btn-secondary"
                  href={`https://wa.me/${gym.contact.whatsapp.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Chat on WhatsApp <ArrowUpRight size={16} />
                </a>
              )}
            </div>
            <div className="gd-hours">
              <div>
                <Clock3 size={24} />
                <h3>Opening hours</h3>
                <p>{timezone.replaceAll("_", " ")}</p>
              </div>
              <dl>
                {days.map((day) => {
                  const h = gym.openingHours?.find(
                    (v: Row) => v.day === days.indexOf(day),
                  );
                  return (
                    <div key={day} className={today === day ? "is-today" : ""}>
                      <dt>
                        {day}
                        {today === day && <small>Today</small>}
                      </dt>
                      <dd>
                        {!h
                          ? "Not provided"
                          : h.closed
                            ? "Closed"
                            : `${h.opensAt} – ${h.closesAt}`}
                        {h && !h.closed && h.closesAt < h.opensAt && (
                          <small>Next day</small>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          </section>
          <section id="gym-reviews" className="gd-section">
            <div className="gd-section-heading">
              <div>
                <span className="gd-kicker">FROM THE COMMUNITY</span>
                <h2>Member experiences</h2>
              </div>
              <button className="btn btn-secondary" onClick={onReview}>
                Write a review
              </button>
            </div>
            {!!gym.rating?.count && (
              <div className="gd-review-summary">
                <strong>{Number(gym.rating.average).toFixed(1)}</strong>
                <div>
                  <span>
                    <Star size={18} fill="currentColor" /> out of 5
                  </span>
                  <p>Based on {gym.rating.count} member reviews</p>
                </div>
              </div>
            )}
            {reviews.map((r) => (
              <article className="gd-review" key={r.publicId}>
                <div>
                  <span className="gd-review-rating">
                    <Star size={15} fill="currentColor" />
                    {r.rating} / 5
                  </span>
                  <time dateTime={r.createdAt}>
                    {localDate(r.createdAt, timezone, {
                      month: "short",
                      year: "numeric",
                      day: "numeric",
                    })}
                  </time>
                </div>
                {r.title && <h3>{r.title}</h3>}
                <p>{r.body}</p>
                {r.ownerResponse?.body && (
                  <blockquote>
                    <strong>Response from the gym</strong>
                    <p>{r.ownerResponse.body}</p>
                  </blockquote>
                )}
              </article>
            ))}
            {!reviews.length && (
              <div className="gd-empty">
                <Star />
                <p>Be the first to share your experience at this gym.</p>
              </div>
            )}
          </section>
        </div>
        <aside className="gd-sidebar">
          <div className="gd-join-card">
            <span className="gd-kicker">YOUR NEXT STEP STARTS HERE</span>
            <h2>Make time for you.</h2>
            {lowestPlan ? (
              <>
                <p>Memberships from</p>
                <div className="gd-sidebar-price">
                  {price(lowestPlan.priceMinor, lowestPlan.currency)}
                  <span> / {lowestPlan.durationDays} days</span>
                </div>
                <a href="#gym-plans" className="btn btn-primary">
                  Explore memberships <ArrowUpRight size={18} />
                </a>
                <small>
                  View plan benefits and confirm your total at checkout.
                </small>
              </>
            ) : (
              <p>Ask the gym about membership availability.</p>
            )}
            <div className="gd-join-divider" />
            {gym.contact?.phone && (
              <a className="gd-contact" href={`tel:${gym.contact.phone}`}>
                <Phone size={18} />
                <span>
                  Have a question?<strong>Call the gym</strong>
                </span>
                <ArrowUpRight size={18} />
              </a>
            )}
            {gym.contact?.whatsapp && (
              <a
                className="gd-text-link"
                href={`https://wa.me/${gym.contact.whatsapp.replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
              >
                Chat on WhatsApp <ArrowUpRight size={16} />
              </a>
            )}
            <a className="gd-text-link" href="#gym-visit">
              <MapPin size={16} />
              Location & opening hours
            </a>
          </div>
        </aside>
      </div>
      {lowestPlan && (
        <div className="gd-mobile-join">
          <div>
            <small>Memberships from</small>
            <strong>
              {price(lowestPlan.priceMinor, lowestPlan.currency)}{" "}
              <span>/ {lowestPlan.durationDays} days</span>
            </strong>
          </div>
          <a href="#gym-plans" className="btn btn-primary">
            View plans <ArrowUpRight size={16} />
          </a>
        </div>
      )}
      <dialog
        ref={dialog}
        className="gd-lightbox"
        aria-label={`${gym.name} photos and videos`}
        onCancel={closeGallery}
        onClose={closeGallery}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeGallery();
        }}
      >
        {galleryIndex !== null && media[galleryIndex] && (
          <>
            <header>
              <span>
                {galleryIndex + 1} / {media.length}
              </span>
              <button
                className="icon-btn"
                aria-label="Close gallery"
                onClick={closeGallery}
              >
                <X />
              </button>
            </header>
            <div className="gd-lightbox-media">
              {media[galleryIndex].type === "video" ? (
                <video
                  key={media[galleryIndex].url}
                  controls
                  autoPlay={false}
                  preload="metadata"
                  src={media[galleryIndex].url}
                  aria-label={media[galleryIndex].name}
                />
              ) : (
                <MediaImage
                  src={media[galleryIndex].url}
                  alt={media[galleryIndex].name}
                />
              )}
            </div>
            <footer>
              <button
                className="btn btn-secondary"
                aria-label="Previous media"
                disabled={media.length < 2}
                onClick={() =>
                  setGalleryIndex(
                    (galleryIndex - 1 + media.length) % media.length,
                  )
                }
              >
                <ChevronLeft />
                Previous
              </button>
              <span>
                {media[galleryIndex].type === "video"
                  ? "Video tour"
                  : "Gym photo"}
              </span>
              <button
                className="btn btn-secondary"
                aria-label="Next media"
                disabled={media.length < 2}
                onClick={() =>
                  setGalleryIndex((galleryIndex + 1) % media.length)
                }
              >
                Next
                <ChevronRight />
              </button>
            </footer>
          </>
        )}
      </dialog>
    </div>
  );
}
