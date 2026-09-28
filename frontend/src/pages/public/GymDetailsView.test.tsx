// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../../components/GymLocation", () => ({
  GymLocation: ({ point }: any) => (
    <div>
      Map entrance: {point.latitude}, {point.longitude}
    </div>
  ),
}));
import { GymDetailsView } from "./GymDetailsView";
let host: HTMLDivElement, root: Root;
const choose = vi.fn(),
  favorite = vi.fn(),
  review = vi.fn();
const data = () => ({
  gym: {
    publicId: "gym-one",
    name: "Test Fitness",
    address: { line1: "12 Fitness Road", city: "Hyderabad" },
    location: { coordinates: [78.4, 17.4] },
    timezone: "Asia/Kolkata",
    rating: { average: 4.7, count: 12 },
    coverImageUrl: "https://images.test/cover.jpg",
    media: [
      {
        url: "https://images.test/cover.jpg",
        mimeType: "image/jpeg",
        name: "Cover",
      },
      {
        url: "https://images.test/tour.mp4",
        mimeType: "video/mp4",
        name: "Tour",
      },
    ],
    facilities: ["Weights"],
    amenities: ["Showers"],
    benefits: ["Free induction"],
    openingHours: [
      { day: 1, closed: false, opensAt: "22:00", closesAt: "05:00" },
      { day: 0, closed: true },
    ],
  },
  plans: [
    {
      _id: "plan-one",
      name: "Monthly",
      durationDays: 30,
      currency: "INR",
      priceMinor: 250000,
      benefits: ["Full gym access"],
    },
  ],
  classes: [
    {
      publicId: "class-one",
      name: "Morning Yoga",
      category: "YOGA",
      startsAt: "2026-09-12T00:30:00Z",
      endsAt: "2026-09-12T01:30:00Z",
      status: "SCHEDULED",
      capacity: 12,
      bookedCount: 5,
    },
  ],
  trainers: [
    {
      publicId: "trainer-one",
      name: "Trainer One",
      qualifications: ["Certified coach"],
    },
  ],
  reviews: [
    {
      publicId: "review-one",
      rating: 5,
      title: "Welcoming space",
      body: "Helpful staff",
      createdAt: "2026-09-01T10:00:00Z",
    },
  ],
});
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(value: any = data(), saved = false) {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <GymDetailsView
          data={value}
          saved={saved}
          onFavorite={favorite}
          onChoosePlan={choose}
          onReview={review}
        />
      </MemoryRouter>,
    ),
  );
}
it("shows backend details, plan prices, classes, hours and member reviews", async () => {
  await render();
  for (const text of [
    "Test Fitness",
    "Weights",
    "Showers",
    "Free induction",
    "2,500",
    "Morning Yoga",
    "7 available / 12",
    "60 min",
    "Next day",
    "Welcoming space",
    "Helpful staff",
    "Certified coach",
  ])
    expect(host.textContent).toContain(text);
  expect(host.textContent).toContain("Map entrance: 17.4, 78.4");
  expect(
    host.querySelectorAll('nav[aria-label="Gym details sections"] a'),
  ).toHaveLength(5);
});
it("passes the actual API plan into the existing checkout", async () => {
  const value = data();
  await render(value);
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="Choose Monthly"]')!
      .click(),
  );
  expect(choose).toHaveBeenCalledWith(value.plans[0]);
});
it("preserves save and review actions", async () => {
  await render(data(), true);
  const saved = host.querySelector<HTMLButtonElement>(
    'button[aria-pressed="true"]',
  )!;
  expect(saved.textContent).toContain("Saved");
  await act(async () => saved.click());
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "Write a review")!
      .click(),
  );
  expect(favorite).toHaveBeenCalledOnce();
  expect(review).toHaveBeenCalledOnce();
});
it("deduplicates the cover and navigates between a photo and a video", async () => {
  await render();
  const trigger = host.querySelector<HTMLButtonElement>(
    '[aria-label="Open gym photo gallery"]',
  )!;
  await act(async () => trigger.click());
  const dialog = host.querySelector("dialog")!;
  expect(dialog.open).toBe(true);
  expect(dialog.textContent).toContain("1 / 2");
  await act(async () =>
    dialog
      .querySelector<HTMLButtonElement>('[aria-label="Next media"]')!
      .click(),
  );
  expect(dialog.querySelector("video")?.src).toBe(
    "https://images.test/tour.mp4",
  );
  await act(async () =>
    dialog
      .querySelector<HTMLButtonElement>('[aria-label="Close gallery"]')!
      .click(),
  );
  expect(dialog.open).toBe(false);
  expect(document.activeElement).toBe(trigger);
});
it("shows honest empty states and avoids a purchase CTA when no plans exist", async () => {
  await render({
    gym: { publicId: "empty", name: "New gym" },
    plans: [],
    classes: [],
    reviews: [],
    trainers: [],
  });
  expect(host.textContent).toContain("Gym photos will appear here when added");
  expect(host.textContent).toContain("Join this gym");
  expect(host.textContent).toContain("Not provided");
  expect(host.querySelector(".gd-mobile-join")).toBeNull();
  expect(host.querySelector(".gd-gallery-count")).toBeNull();
});

it("shows gym details before adjacent membership choices and explains payment activation", async () => {
  await render(data());
  const sections = [...host.querySelectorAll(".gd-content section")];
  expect(sections[0].id).toBe("gym-overview");
  const plans = host.querySelector("#gym-plans")!;
  expect(plans.textContent).toContain("Subscribe & join");
  expect(plans.textContent).toContain("after payment is verified");
});
