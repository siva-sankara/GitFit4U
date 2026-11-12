// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { SupportTicketActivity, SupportTicketProgress } from "./SupportTicketActivity";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("marks the actual current and visited stages when a ticket skips stages or is reopened", async () => {
  const activity = [{ type: "STATUS", from: "OPEN", to: "RESOLVED" }];
  await act(async () => root.render(<SupportTicketProgress ticket={{ status: "RESOLVED", activity }} />));
  expect(host.querySelector('[aria-current="step"]')?.textContent).toContain("Resolved");
  expect([...host.querySelectorAll(".is-visited")].map(row => row.textContent)).toEqual([expect.stringContaining("Open")]);
  expect([...host.querySelectorAll("li")].find(row => row.textContent?.includes("Awaiting reply"))?.textContent).toContain("Not visited");
  await act(async () => root.render(<SupportTicketProgress ticket={{ status: "OPEN", activity: [...activity, { type: "STATUS", from: "RESOLVED", to: "OPEN" }] }} />));
  expect(host.querySelector('[aria-current="step"]')?.textContent).toContain("Open");
  expect([...host.querySelectorAll(".is-visited")].map(row => row.textContent)).toEqual([expect.stringContaining("Resolved")]);
});

it("combines ticket changes and replies in time order, deduplicates replies and shows people without raw assignment IDs", async () => {
  const reply = { publicId: "reply-one", createdAt: "2026-11-12T10:10:00Z", senderId: { _id: "requester", name: "Rahul" }, attachments: [{}] };
  const ticket = { requesterId: "requester", createdAt: "2026-11-12T10:00:00Z", assignedTo: { _id: "agent-id", name: "Anita" }, activity: [
    { type: "STATUS", from: "OPEN", to: "IN_PROGRESS", at: "2026-11-12T10:20:00Z", actorId: { name: "Anita" } },
    { type: "ASSIGNMENT", from: "old-agent-id", to: "agent-id", at: "2026-11-12T10:05:00Z", actorId: { name: "Admin" } },
  ] };
  await act(async () => root.render(<SupportTicketActivity ticket={ticket} replies={[reply, reply]} hasEarlierReplies />));
  const rows = [...host.querySelectorAll("li")];
  expect(rows.map(row => row.querySelector("strong")?.textContent)).toEqual(["Status changed", "Reply added", "Assignment updated", "Ticket opened"]);
  expect(rows[0].textContent).toContain("In progress");
  expect(rows[1].textContent).toContain("Rahul");
  expect(rows[1].textContent).toContain("1 attachment");
  expect(rows[2].textContent).toContain("Support agent");
  expect(rows[2].textContent).toContain("Anita");
  expect(rows[3].textContent).toContain("Rahul");
  expect(host.textContent).not.toContain("agent-id");
  expect(host.textContent).toContain("Load earlier replies");
  expect(rows[0].querySelector("time")?.dateTime).toBe("2026-11-12T10:20:00Z");
});

it("labels reopened tickets and deleted replies without reproducing private or deleted content", async () => {
  const ticket = { createdAt: "2026-11-10T10:00:00Z", internalNotes: [{ body: "Private admin note" }], activity: [
    { type: "STATUS", from: "CLOSED", to: "OPEN", at: "2026-11-12T10:00:00Z", actorId: { name: "Rahul" } },
  ] };
  const reply = { publicId: "removed", senderId: { name: "Rahul" }, deletedAt: "2026-11-11T10:00:00Z", text: "Deleted body", attachments: [{ name: "Deleted attachment" }] };
  await act(async () => root.render(<SupportTicketActivity ticket={ticket} replies={[reply]} />));
  expect(host.textContent).toContain("Ticket reopened");
  expect(host.textContent).toContain("Reply has been deleted");
  expect(host.textContent).toContain("Time unavailable");
  expect(host.textContent).not.toMatch(/Private admin note|Deleted body|Deleted attachment|1 attachment/);
});
