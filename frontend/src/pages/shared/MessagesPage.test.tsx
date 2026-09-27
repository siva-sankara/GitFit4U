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
    const conversation = {
      publicId: "conversation-one",
      participants: [
        { _id: "other-user", name: "Same name" },
        { _id: "current-user", name: "Same name" },
      ],
      supportTicketId: state.ticket,
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
async function render() {
  await act(async () =>
    root.render(
      <MemoryRouter
        initialEntries={["/messages?conversation=conversation-one"]}
      >
        <MessagesPage />
      </MemoryRouter>,
    ),
  );
}
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
