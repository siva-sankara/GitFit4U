// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InboxNotification } from "../../services/notificationAlerts";

const state = vi.hoisted(() => ({
  rows: [] as InboxNotification[],
  loading: false,
  error: false,
  read: vi.fn(),
  readAll: vi.fn(),
  refetch: vi.fn(),
  query: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../../components/PushNotificationSettings", () => ({
  PushNotificationSettings: () => null,
}));
vi.mock("../../api/hooks", () => ({
  useNotifications: (page: number, category: string) => {
    state.query(page, category);
    return {
      data: { data: state.rows, meta: { pages: 2, total: state.rows.length } },
      isLoading: state.loading,
      isFetching: state.loading,
      isError: state.error,
      isSuccess: !state.loading && !state.error,
      refetch: state.refetch,
    };
  },
  useReadNotification: () => ({
    mutate: state.read,
    isPending: false,
    isError: false,
  }),
  useReadAllNotifications: () => ({
    mutate: state.readAll,
    isPending: false,
    isError: false,
  }),
  useDeleteNotifications: () => ({ mutate: state.remove, isPending: false, isError: false }),
}));
import { NotificationsApiPage } from "./NotificationsApiPage";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  state.loading = false;
  state.error = false;
  state.rows = [
    {
      _id: "notification-1",
      category: "MEMBERSHIP",
      title: "Membership activated",
      message: "Welcome to your gym",
      createdAt: "2026-09-09T00:00:00Z",
      actionUrl: "/app/subscriptions",
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
const render = async () => {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <NotificationsApiPage />
      </MemoryRouter>,
    ),
  );
};
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent === text,
  )!;

it("renders readable categories and opens the exact notification with its safe action", async () => {
  await render();
  expect(host.textContent).toContain("Memberships");
  expect(host.textContent).not.toContain("MEMBERSHIP");
  await act(async () =>
    host.querySelector<HTMLButtonElement>(".notification-item")!.click(),
  );
  expect(state.read).toHaveBeenCalledWith("notification-1");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Welcome to your gym",
  );
  expect(button("View details")).toBeDefined();
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("requires confirmation before deleting all inbox notifications", async () => {
  await render();
  await act(async () => button("Delete all").click());
  expect(state.remove).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("including other pages and categories");
  await act(async () => button("Confirm delete").click());
  expect(state.remove).toHaveBeenCalledWith({ all: true, confirmed: true }, expect.any(Object));
});
it("resets pagination when changing filters", async () => {
  await render();
  await act(async () => button("Next").click());
  expect(state.query).toHaveBeenLastCalledWith(2, "ALL");
  await act(async () => button("Unread").click());
  expect(state.query).toHaveBeenLastCalledWith(1, "UNREAD");
  expect(button("Unread").getAttribute("aria-pressed")).toBe("true");
});
it("shows a loading skeleton and disables bulk actions while loading", async () => {
  state.loading = true;
  await render();
  expect(
    host.querySelector('[aria-label="Loading notifications"]'),
  ).not.toBeNull();
  expect(button("Mark all read").disabled).toBe(true);
  expect(host.textContent).not.toMatch(/â|Updating\?/);
});
it("handles empty inboxes without misleading pagination controls", async () => {
  state.rows = [];
  await render();
  await act(async () => button("Unread").click());
  expect(host.textContent).toContain("You're all caught up");
  expect(host.querySelector(".notification-pagination")).toBeNull();
});
it("does not offer external or unsafe notification actions", async () => {
  state.rows[0].actionUrl = "//evil.example/login";
  await render();
  await act(async () =>
    host.querySelector<HTMLButtonElement>(".notification-item")!.click(),
  );
  expect(button("View details")).toBeUndefined();
});
it("retries failed inbox requests without displaying debug content", async () => {
  state.error = true;
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Unable to load notifications",
  );
  await act(async () => button("Try again").click());
  expect(state.refetch).toHaveBeenCalledOnce();
});
