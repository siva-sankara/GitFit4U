// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  role: "USER",
  ticket: null as any,
  error: false,
  read: vi.fn(),
  rows: [] as any[],
  archived: false,
  query: vi.fn(),
}));
vi.mock("../../api/hooks", () => ({
  useCurrentUser: () => ({
    data: {
      data: { user: { _id: "current-user" }, context: { role: state.role } },
    },
  }),
}));
vi.mock("../../services/mediaUpload", () => ({ uploadMedia: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: state.read, isPending: false, isError: false }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    state.query(queryKey);
    const conversation = {
      publicId: "conversation-one",
      participants: [
        { _id: "other-user", name: "Same name" },
        { _id: "current-user", name: "Same name" },
      ],
      supportTicketId: state.ticket,
      archivedBy: state.archived ? ["current-user"] : [],
    };
    return {
      isPending: false,
      isError: queryKey[0] === "messages" && state.error,
      error: new Error("You no longer have access to this conversation."),
      data: {
        data:
          queryKey[0] === "messages"
            ? state.rows
            : queryKey[0] === "conversation"
              ? conversation
              : queryKey[0] === "conversations"
                ? [conversation]
                : [],
        meta: { pages: 1 },
      },
    };
  },
}));
import { MessagesPage } from "./MessagesPage";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  state.role = "USER";
  state.ticket = null;
  state.error = false;
  state.archived = false;
  vi.clearAllMocks();
  state.rows = [
    {
      publicId: "mine",
      senderId: { _id: "current-user", name: "Same name" },
      text: "My message",
      createdAt: "2026-09-26T10:00:00Z",
      readBy: [],
    },
    {
      publicId: "theirs",
      senderId: { _id: "other-user", name: "Same name" },
      text: "Their message",
      createdAt: "2026-09-26T10:01:00Z",
      readBy: [],
    },
  ];
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(source?: { returnTo: string; returnLabel: string }) {
  await act(async () =>
    root.render(
      <MemoryRouter
        initialEntries={[{
          pathname: "/messages",
          search: "?conversation=conversation-one",
          state: source,
        }]}
      >
        <MessagesPage />
      </MemoryRouter>,
    ),
  );
}
it("offers a source-aware back link to the filtered member directory", async () => {
  await render({
    returnTo: "/owner/members?page=2&status=ACTIVE",
    returnLabel: "Back to members",
  });
  const link = host.querySelector<HTMLAnchorElement>(
    'a[aria-label="Back to members"]',
  );
  expect(link?.getAttribute("href")).toBe(
    "/owner/members?page=2&status=ACTIVE",
  );
});
it("aligns messages by authenticated IDs even when sender names are identical", async () => {
  await render();
  expect(host.querySelector(".outgoing")?.textContent).toContain("My message");
  expect(host.querySelector(".incoming")?.textContent).toContain(
    "Their message",
  );
  expect(
    host.querySelectorAll('[aria-label="Delete your message for everyone"]'),
  ).toHaveLength(1);
  expect(host.querySelector('[aria-label="Message history"]')).not.toBeNull();
  expect(state.read).toHaveBeenCalledWith("conversation-one");
});
it("shows a reopen action but no administrator status selector to the requester", async () => {
  state.ticket = { status: "RESOLVED" };
  await render();
  expect(host.textContent).toContain("Reopen conversation");
  expect(host.querySelector('[aria-label="Message"]')).toBeNull();
  expect(host.querySelector('[aria-label="Support status"]')).toBeNull();
});
it("shows backend message errors without presenting cached history as readable", async () => {
  state.error = true;
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "no longer have access",
  );
  expect(host.querySelector(".message-bubble")).toBeNull();
});
it("offers a persistent Archived chats filter backed by the conversation query", async () => {
  await render();
  const archived = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Archived chats")!;
  await act(async () => archived.click());
  expect(state.query.mock.calls.some(([key]) => key[0] === "conversations" && key[3] === true)).toBe(true);
  expect(archived.getAttribute("aria-pressed")).toBe("true");
});
it("offers Restore for an archived conversation without exposing a destructive delete action", async () => {
  state.archived = true;
  await render();
  const restore = host.querySelector<HTMLButtonElement>('[aria-label="Restore conversation"]');
  expect(restore).not.toBeNull();
  expect(host.querySelector('[aria-label="Archive conversation for me"]')).toBeNull();
  state.read.mockClear();
  await act(async () => restore!.click());
  expect(state.read).toHaveBeenCalledOnce();
});
