import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar } from "../../components/Avatar";
import { Modal } from "../../components/Modal";
import { MediaImageEditor } from "../../components/MediaImageEditor";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { ProfileEditor } from "./ProfileEditor";
import { AccountAppSettings } from "../../components/PwaSettings";
import { useCurrentUser } from "../../api/hooks";
import { workspacePrefix } from "../../services/authRedirect";
import "../../styles/social-profile.css";
type Person = {
  publicId: string;
  name?: string;
  avatarUrl?: string;
  avatarThumbnailUrl?: string;
};
type Content = {
  publicId: string;
  text: string;
  author: Person;
  createdAt: string;
  editedAt?: string;
  expiresAt?: string;
  attachmentIds: string[];
  images: { id: string; url: string; thumbnailUrl?: string }[];
};
type Profile = Person & {
  own: boolean;
  canView: boolean;
  canModerate: boolean;
  following: boolean;
  social?: {
    bio?: string;
    location?: string;
    visibility?: string;
    fitnessInterests?: string[];
  };
  counts: { followers?: number; following?: number; posts?: number };
  streak?: {
    currentStreak: number;
    longestStreak: number;
    lastAttendanceDate?: string;
    totalVisits: number;
    timezone: string;
  };
};
type Paged<T> = ApiEnvelope<T[]> & {
  meta?: { page: number; pages: number; total: number };
};
const displayDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
function Pages({
  page,
  pages = 1,
  onChange,
  label = "Pagination",
}: {
  page: number;
  pages?: number;
  onChange: (page: number) => void;
  label?: string;
}) {
  return pages > 1 ? (
    <nav className="profile-pagination" aria-label={label}>
      <button
        className="btn btn-ghost"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button
        className="btn btn-ghost"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </nav>
  ) : null;
}
function PeopleList({
  profileId,
  kind,
  onClose,
}: {
  profileId: string;
  kind: "followers" | "following" | "discover";
  onClose: () => void;
}) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState("");
  const path =
    kind === "discover"
      ? `/api/v1/social/profiles?q=${encodeURIComponent(search)}&page=${page}&limit=12`
      : `/api/v1/social/profiles/${profileId}/${kind}?page=${page}&limit=12`;
  const query = useQuery({
    queryKey: ["api", path],
    queryFn: () => apiRequest<Paged<Person>>(path),
  });
  return (
    <Modal
      open
      title={
        kind === "discover"
          ? "Find members"
          : kind === "followers"
            ? "Followers"
            : "Following"
      }
      onClose={onClose}
    >
      {kind === "discover" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSearch(String(new FormData(event.currentTarget).get("q") || ""));
          }}
        >
          <label>
            Find public profiles
            <input
              name="q"
              type="search"
              maxLength={80}
              defaultValue={search}
            />
          </label>
          <button className="btn btn-secondary">Search</button>
        </form>
      )}
      {query.isPending && <p role="status">Loading members…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      <div className="profile-people">
        {query.data?.data.map((person) => (
          <Link
            key={person.publicId}
            to={`/profile/${person.publicId}`}
            onClick={onClose}
          >
            <Avatar user={person} />
            <span>{person.name || "Member"}</span>
          </Link>
        ))}
      </div>
      {query.data && !query.data.data.length && <p>No members to show.</p>}
      <Pages page={page} pages={query.data?.meta?.pages} onChange={setPage} />
    </Modal>
  );
}
function ContentComposer({
  kind,
  initial,
  onClose,
}: {
  kind: "posts" | "stories";
  initial?: Content;
  onClose: () => void;
}) {
  const [imageBusy, setImageBusy] = useState(false);
  const client = useQueryClient(),
    [text, setText] = useState(initial?.text || ""),
    [images, setImages] = useState(initial?.images || []),
    [uploader, setUploader] = useState(0);
  const save = useMutation({
    mutationFn: () =>
      apiRequest(
        `/api/v1/social/${kind}${initial ? `/${initial.publicId}` : ""}`,
        {
          method: initial ? "PATCH" : "POST",
          body: JSON.stringify({
            text,
            attachmentIds: images.map((image) => image.id),
          }),
        },
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["api"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      title={
        initial
          ? "Edit post"
          : kind === "stories"
            ? "Share a 25-hour story"
            : "Create a fitness post"
      }
      onClose={onClose}
    >
      <form
        className="profile-composer"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label>
          {kind === "stories" ? "Your story" : "What did you achieve today?"}
          <textarea
            maxLength={3000}
            rows={5}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <div className="profile-compose-images">
          {images.map((image) => (
            <div key={image.id}>
              <img
                src={image.thumbnailUrl || image.url}
                width={96}
                height={96}
                alt="Selected post image"
              />
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  setImages(images.filter((item) => item.id !== image.id))
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        {images.length < (kind === "stories" ? 1 : 4) && (
          <MediaImageEditor
            key={uploader}
            purpose={kind === "stories" ? "STORY_IMAGE" : "POST_IMAGE"}
            label="Add image"
            onBusyChange={setImageBusy}
            onChange={(id, url) => {
              if (id && url) {
                setImages([...images, { id, url }]);
                setUploader(uploader + 1);
                setImageBusy(false);
              }
            }}
          />
        )}
        {kind === "stories" && (
          <p>
            Expires 25 hours after sharing. Your profile privacy also applies to
            stories.
          </p>
        )}
        {save.error && <p role="alert">{save.error.message}</p>}
        <button
          className="btn btn-primary"
          disabled={
            save.isPending || imageBusy || (!text.trim() && !images.length)
          }
        >
          {save.isPending ? "Saving…" : "Share"}
        </button>
      </form>
    </Modal>
  );
}
export function SocialProfilePage({ profileId }: { profileId?: string }) {
  const params = useParams(),
    id = profileId || params.profileId || "me";
  return <ProfileContent key={id} id={id} />;
}
function ProfileContent({ id }: { id: string }) {
  const me = useCurrentUser();
  const client = useQueryClient(),
    [page, setPage] = useState(1),
    [storyPage, setStoryPage] = useState(1),
    [now, setNow] = useState(Date.now),
    [editing, setEditing] = useState(false),
    [people, setPeople] = useState<"followers" | "following" | "discover">(),
    [composer, setComposer] = useState<{
      kind: "posts" | "stories";
      initial?: Content;
    }>(),
    [story, setStory] = useState<Content>(),
    [deleting, setDeleting] = useState<{
      kind: "posts" | "stories";
      publicId: string;
    }>();
  const endpoint = `/api/v1/social/profiles/${encodeURIComponent(id)}`;
  const profile = useQuery({
    queryKey: ["api", endpoint],
    queryFn: () => apiRequest<ApiEnvelope<Profile>>(endpoint),
    refetchInterval: 240000,
  });
  const account = useQuery({
    queryKey: ["api", "/api/v1/users/me"],
    queryFn: () => apiRequest<ApiEnvelope<any>>("/api/v1/users/me"),
    enabled: Boolean(profile.data?.data.own && editing),
  });
  const posts = useQuery({
    queryKey: ["api", endpoint, "posts", page],
    queryFn: () =>
      apiRequest<Paged<Content>>(`${endpoint}/posts?page=${page}&limit=10`),
    enabled: Boolean(profile.data?.data.canView),
    refetchInterval: 240000,
  });
  const stories = useQuery({
    queryKey: ["api", endpoint, "stories", storyPage],
    queryFn: () =>
      apiRequest<Paged<Content>>(
        `${endpoint}/stories?page=${storyPage}&limit=10`,
      ),
    enabled: Boolean(profile.data?.data.canView),
    refetchInterval: 30000,
  });
  useEffect(() => {
    if (stories.data?.meta && storyPage > stories.data.meta.pages)
      setStoryPage(stories.data.meta.pages);
  }, [stories.data?.meta, storyPage]);
  useEffect(() => {
    const current = Date.now();
    const deadlines = [...(stories.data?.data || []), ...(story ? [story] : [])]
      .map((item) => Date.parse(item.expiresAt || ""))
      .filter((deadline) => Number.isFinite(deadline) && deadline > current);
    if (!deadlines.length) return;
    // Expire an already-open viewer on time, even when a poll fails or is offline.
    const timer = window.setTimeout(
      () => {
        setNow(Date.now());
        void client.invalidateQueries({
          queryKey: ["api", endpoint, "stories"],
        });
      },
      Math.min(
        2_147_483_647,
        Math.max(1, Math.min(...deadlines) - current + 1),
      ),
    );
    return () => window.clearTimeout(timer);
  }, [stories.data, story, now, client, endpoint]);
  const follow = useMutation({
    mutationFn: () =>
      apiRequest(`${endpoint}/follow`, {
        method: profile.data?.data.following ? "DELETE" : "POST",
        body: "{}",
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["api", endpoint] }),
  });
  const remove = useMutation({
    mutationFn: () =>
      apiRequest(`/api/v1/social/${deleting!.kind}/${deleting!.publicId}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      setDeleting(undefined);
      setStory(undefined);
      await client.invalidateQueries({ queryKey: ["api"] });
    },
  });
  if (profile.isPending)
    return (
      <section className="state-card" role="status">
        Loading fitness profile…
      </section>
    );
  if (profile.error)
    return (
      <section className="state-card" role="alert">
        <p>{profile.error.message}</p>
        <button
          className="btn btn-secondary"
          onClick={() => void profile.refetch()}
        >
          Retry
        </button>
      </section>
    );
  const person = profile.data!.data;
  const viewedStory =
    stories.data?.data.find((item) => item.publicId === story?.publicId) ||
    story;
  const activeStories = (stories.data?.data || []).filter(
    (item) =>
      item.expiresAt && Date.parse(item.expiresAt) > Math.max(now, Date.now()),
  );
  return (
    <div className="social-profile">
      <div className="profile-page-title">
        <div>
          <h1>{person.own ? "Your fitness profile" : "Fitness profile"}</h1>
          <p>Progress, connections and everyday wins.</p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => setPeople("discover")}
        >
          Find members
        </button>
      </div>
      <section className="profile-hero">
        <Avatar user={person} size={96} />
        <div className="profile-identity">
          <h2>{person.name || "Member"}</h2>
          {person.social?.bio && (
            <p className="profile-bio">{person.social.bio}</p>
          )}
          {person.social?.location && <p>{person.social.location}</p>}
          <div className="profile-interests">
            {person.social?.fitnessInterests?.map((interest) => (
              <span key={interest}>{interest}</span>
            ))}
          </div>
          <small>
            {person.social?.visibility === "PUBLIC"
              ? "Visible to signed-in members"
              : "Private profile"}
          </small>
        </div>
        <div className="profile-actions">
          {person.own && <AccountAppSettings />}
          {person.own && (
            <Link
              className="btn btn-secondary"
              to={`${workspacePrefix(me.data?.data.context.role || "USER")}/security`}
            >
              Account security
            </Link>
          )}
          {person.own ? (
            <button
              className="btn btn-secondary"
              onClick={() => setEditing(true)}
            >
              Edit profile
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={
                follow.isPending || (!person.following && !person.canView)
              }
              onClick={() => follow.mutate()}
            >
              {person.following ? "Unfollow" : "Follow"}
            </button>
          )}
        </div>
        {person.canView && (
          <div className="profile-stats">
            <div>
              <strong>{person.counts.posts || 0}</strong>
              <span>Posts</span>
            </div>
            <button onClick={() => setPeople("followers")}>
              <strong>{person.counts.followers || 0}</strong>
              <span>Followers</span>
            </button>
            <button onClick={() => setPeople("following")}>
              <strong>{person.counts.following || 0}</strong>
              <span>Following</span>
            </button>
            <div
              title={`Longest: ${person.streak?.longestStreak || 0} days. Last attendance: ${person.streak?.lastAttendanceDate || "None"}. ${person.streak?.timezone || ""}`}
            >
              <strong>{person.streak?.currentStreak || 0}</strong>
              <span>Day streak</span>
            </div>
          </div>
        )}
      </section>
      {follow.error && <p role="alert">{follow.error.message}</p>}
      {!person.canView ? (
        <section className="state-card">
          This member keeps their posts, stories and fitness activity private.
        </section>
      ) : (
        <>
          <section className="profile-stories">
            <div className="profile-section-title">
              <h2>Stories</h2>
              {person.own && (
                <button
                  className="btn btn-secondary"
                  onClick={() => setComposer({ kind: "stories" })}
                >
                  Add story
                </button>
              )}
            </div>
            <p className="muted">Every story lasts exactly 25 hours.</p>
            {stories.error && <p role="alert">{stories.error.message}</p>}
            {stories.isPending && <p role="status">Loading stories…</p>}
            <div className="profile-story-row">
              {activeStories.map((item) => (
                <button
                  key={item.publicId}
                  className="profile-story-card"
                  onClick={() => setStory(item)}
                >
                  {item.images[0] ? (
                    <img
                      src={item.images[0].thumbnailUrl || item.images[0].url}
                      alt="View story"
                      width={88}
                      height={110}
                    />
                  ) : (
                    <span>{item.text.slice(0, 45)}</span>
                  )}
                  <small>{displayDate(item.createdAt)}</small>
                </button>
              ))}
            </div>
            {!stories.isPending && !activeStories.length && (
              <p>No active stories.</p>
            )}
            <Pages
              page={storyPage}
              pages={stories.data?.meta?.pages}
              onChange={setStoryPage}
              label="Stories pagination"
            />
          </section>
          <section className="profile-posts">
            <div className="profile-section-title">
              <h2>Posts</h2>
              {person.own && (
                <button
                  className="btn btn-primary"
                  onClick={() => setComposer({ kind: "posts" })}
                >
                  Create post
                </button>
              )}
            </div>
            {posts.isPending && <p role="status">Loading posts…</p>}
            {posts.error && <p role="alert">{posts.error.message}</p>}
            {posts.data && !posts.data.data.length && (
              <div className="state-card">
                No posts yet. {person.own && "Share your first workout win."}
              </div>
            )}
            {posts.data?.data.map((post) => (
              <article className="profile-post" key={post.publicId}>
                <header>
                  <Avatar user={post.author} />
                  <div>
                    <strong>{post.author.name || "Member"}</strong>
                    <small>
                      {displayDate(post.createdAt)}
                      {post.editedAt ? " · Edited" : ""}
                    </small>
                  </div>
                  <div className="profile-post-actions">
                    {person.own && (
                      <button
                        className="btn btn-ghost"
                        onClick={() =>
                          setComposer({ kind: "posts", initial: post })
                        }
                      >
                        Edit
                      </button>
                    )}
                    {(person.own || person.canModerate) && (
                      <button
                        className="btn btn-ghost"
                        onClick={() =>
                          setDeleting({
                            kind: "posts",
                            publicId: post.publicId,
                          })
                        }
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </header>
                <p className="profile-post-text">{post.text}</p>
                <div className="profile-post-images">
                  {post.images.map((image) => (
                    <a
                      key={image.id}
                      href={image.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={image.url}
                        alt="Post attachment"
                        loading="lazy"
                      />
                    </a>
                  ))}
                </div>
              </article>
            ))}
            <Pages
              page={page}
              pages={posts.data?.meta?.pages}
              onChange={setPage}
            />
          </section>
          <aside className="profile-streak-note">
            Streaks count verified gym attendance, once per day across gyms in{" "}
            {person.streak?.timezone || "your timezone"}. Longest:{" "}
            {person.streak?.longestStreak || 0} days. Last activity:{" "}
            {person.streak?.lastAttendanceDate || "No check-ins yet"}.
          </aside>
        </>
      )}
      {editing && (
        <Modal open title="Edit your profile" onClose={() => setEditing(false)}>
          {account.isPending ? (
            <p role="status">Loading details…</p>
          ) : account.error ? (
            <p role="alert">{account.error.message}</p>
          ) : (
            <ProfileEditor
              user={account.data!.data}
              onSaved={() => setEditing(false)}
            />
          )}
        </Modal>
      )}
      {people && (
        <PeopleList
          profileId={id}
          kind={people}
          onClose={() => setPeople(undefined)}
        />
      )}
      {composer && (
        <ContentComposer {...composer} onClose={() => setComposer(undefined)} />
      )}
      {viewedStory && (
        <Modal open title="Story" onClose={() => setStory(undefined)}>
          {viewedStory.expiresAt &&
          Date.parse(viewedStory.expiresAt) <= Math.max(now, Date.now()) ? (
            <p>This story has expired.</p>
          ) : (
            <div className="profile-story-view">
              <p>{viewedStory.text}</p>
              {viewedStory.images.map((image) => (
                <img src={image.url} key={image.id} alt="Story image" />
              ))}
              <small>
                Shared {displayDate(viewedStory.createdAt)} · Expires{" "}
                {displayDate(viewedStory.expiresAt!)}
              </small>
              {(person.own || person.canModerate) && (
                <button
                  className="btn btn-ghost"
                  onClick={() =>
                    setDeleting({
                      kind: "stories",
                      publicId: viewedStory.publicId,
                    })
                  }
                >
                  Delete story
                </button>
              )}
            </div>
          )}
        </Modal>
      )}
      {deleting && (
        <Modal
          open
          title="Delete this content?"
          onClose={() => setDeleting(undefined)}
        >
          <p>
            It will be removed from your profile. The record is retained for
            moderation and audit.
          </p>
          {remove.error && <p role="alert">{remove.error.message}</p>}
          <button
            className="btn btn-primary"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? "Deleting…" : "Delete content"}
          </button>
        </Modal>
      )}
    </div>
  );
}
