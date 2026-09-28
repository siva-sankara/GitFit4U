// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
vi.mock("../../api/hooks", () => ({
  useCurrentUser: () => ({ data: { data: { context: { role: "USER" } } } }),
}));
vi.mock("./ProfileEditor", () => ({ ProfileEditor: () => <p>Editor</p> }));
import { SocialProfilePage } from "./SocialProfilePage";
let host: HTMLDivElement, root: Root, client: QueryClient;
const person = {
  publicId: "me",
  name: "Ada Member",
  own: true,
  canView: true,
  canModerate: false,
  following: false,
  social: { visibility: "PRIVATE" },
  counts: { followers: 0, following: 0, posts: 0 },
  streak: {
    currentStreak: 0,
    longestStreak: 0,
    totalVisits: 0,
    timezone: "UTC",
  },
};
function story(
  index: number,
  expiresAt = new Date(Date.now() + 3600000).toISOString(),
) {
  return {
    publicId: `story-${index}`,
    text: `Story ${index}`,
    author: person,
    createdAt: new Date().toISOString(),
    expiresAt,
    attachmentIds: [],
    images: [],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.useRealTimers();
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SocialProfilePage profileId="me" />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
async function until(check: () => boolean) {
  for (let i = 0; i < 60 && !check(); i++)
    await act(async () => {
      if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(10);
      else
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
    });
  expect(check()).toBe(true);
}
function defaults(path: string) {
  if (path === "/api/v1/social/profiles/me")
    return { success: true, data: person };
  if (path.includes("/posts?"))
    return { success: true, data: [], meta: { page: 1, pages: 1, total: 0 } };
  throw new Error(`Unexpected request: ${path}`);
}
it("makes the 21st story reachable and deletable via actual pagination controls", async () => {
  let deleted = false;
  mocks.request.mockImplementation(async (path, options) => {
    if (
      path === "/api/v1/social/stories/story-21" &&
      options?.method === "DELETE"
    ) {
      deleted = true;
      return;
    }
    if (path.includes("/stories?")) {
      const page = Number(
        new URL(path, "http://localhost").searchParams.get("page"),
      );
      return {
        success: true,
        data:
          page === 1
            ? Array.from({ length: 20 }, (_, i) => story(i + 1))
            : deleted
              ? []
              : [story(21)],
        meta: { page, pages: deleted ? 1 : 2, total: deleted ? 20 : 21 },
      };
    }
    return defaults(path);
  });
  await render();
  await until(() => !!host.querySelector('[aria-label="Stories pagination"]'));
  const next = [
    ...host.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Stories pagination"] button',
    ),
  ].find((button) => button.textContent === "Next")!;
  await act(async () => next.click());
  await until(
    () =>
      host
        .querySelector(".profile-story-card")
        ?.textContent?.includes("Story 21") || false,
  );
  await act(async () =>
    (host.querySelector(".profile-story-card") as HTMLButtonElement).click(),
  );
  const deleteStory = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ].find((button) => button.textContent === "Delete story")!;
  await act(async () => deleteStory.click());
  const confirm = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ].find((button) => button.textContent === "Delete content")!;
  await act(async () => confirm.click());
  await until(
    () =>
      (deleted &&
        host
          .querySelector(".profile-story-card")
          ?.textContent?.includes("Story 1")) ||
      false,
  );
  expect(mocks.request).toHaveBeenCalledWith(
    "/api/v1/social/stories/story-21",
    expect.objectContaining({ method: "DELETE" }),
  );
});
it("expires an open story at its server deadline even when refresh fails", async () => {
  vi.useFakeTimers();
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  let unavailable = false;
  mocks.request.mockImplementation(async (path) => {
    if (path.includes("/stories?")) {
      if (unavailable) throw new Error("Offline");
      return {
        success: true,
        data: [story(1, expiresAt)],
        meta: { page: 1, pages: 1, total: 1 },
      };
    }
    return defaults(path);
  });
  await render();
  await until(() => !!host.querySelector(".profile-story-card"));
  await act(async () =>
    (host.querySelector(".profile-story-card") as HTMLButtonElement).click(),
  );
  unavailable = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(61000);
  });
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "This story has expired.",
  );
  expect(host.querySelector(".profile-story-card")).toBeNull();
});
