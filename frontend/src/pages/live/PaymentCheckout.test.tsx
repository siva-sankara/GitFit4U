// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../services/apiClient", () => ({
  apiRequest: mocks.request,
  getAccessToken: () => "session",
  setAccessToken: vi.fn(),
}));
import { PaymentCheckout } from "./LivePublic";
import { Modal } from "../../components/Modal";
let host: HTMLDivElement,
  root: Root,
  client: QueryClient,
  state: string,
  complete: ReturnType<typeof vi.fn<() => void>>,
  gatewayChanged: ReturnType<typeof vi.fn<(open: boolean) => void>>,
  busyChanged: ReturnType<typeof vi.fn<(busy: boolean) => void>>;
class Checkout {
  static last: Checkout;
  static openHook: (() => void) | undefined;
  handlers: Record<string, (value: any) => void> = {};
  constructor(public options: any) {
    Checkout.last = this;
  }
  on(event: string, handler: (value: any) => void) {
    this.handlers[event] = handler;
  }
  open() { Checkout.openHook?.(); }
  close = vi.fn();
}
beforeEach(() => {
  vi.resetAllMocks();
  state = "PENDING";
  complete = vi.fn();
  gatewayChanged = vi.fn();
  busyChanged = vi.fn();
  Checkout.openHook = undefined;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(window, { Razorpay: Checkout });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mocks.request.mockImplementation((path: string) => {
    if (path.endsWith("/quotes"))
      return Promise.resolve({
        data: {
          publicId: "quote-one",
          planSnapshot: { name: "Backend plan", durationDays: 30 },
          currency: "INR",
          subtotalMinor: 10000,
          discountMinor: 0,
          taxMinor: 0,
          totalMinor: 10000,
        },
      });
    if (path.endsWith("/orders"))
      return Promise.resolve({
        data: {
          paymentId: "payment-one",
          providerOrderId: "order-one",
          razorpayKeyId: "rzp_test",
          amountMinor: 10000,
          currency: "INR",
          prefill: {
            name: "Owner",
            email: "owner@example.com",
            contact: "+919876543210",
          },
        },
      });
    if (path.endsWith("/cancel")) state = "CANCELLED";
    return Promise.resolve({ data: { status: state } });
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  delete (window as any).Razorpay;
});
async function until(check: () => boolean) {
  for (let i = 0; i < 80 && !check(); i++)
    await act(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 20); });
    });
  expect(check()).toBe(true);
}
function pay() {
  return Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === "Pay with Razorpay",
  )!;
}
it("locks a resumed platform order to its committed quote instead of offering a second coupon", async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path, ...args) => {
    const result = await original(path, ...args);
    if (path.endsWith("/quotes")) result.data = { ...result.data, paymentCommitted: true, discountMinor: 2000, totalMinor: 8000,
      pricingSnapshot: { offerDiscountMinor: 2000, offer: { name: "Committed offer", code: "ORIGINAL", terms: "One purchase" } } };
    return result;
  });
  await act(async () => root.render(<QueryClientProvider client={client}><PaymentCheckout quotePath="/api/v1/checkout/platform/quotes" quoteBody={{ registrationId: "registration-one", planId: "plan-one" }} /></QueryClientProvider>));
  await until(() => Boolean(pay()));
  expect(host.textContent).toContain("Pricing is locked to the existing payment order");
  expect(host.textContent).toContain("Applied: Committed offer");
  expect(host.querySelector(".checkout-coupon")).toBeNull();
  expect(host.querySelector(".platform-checkout-offers")).toBeNull();
  expect(mocks.request.mock.calls.some(([path]) => path.endsWith("/orders"))).toBe(false);
});
async function start(membership = false) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <PaymentCheckout
          quotePath={
            membership
              ? "/api/v1/checkout/quotes"
              : "/api/v1/checkout/platform/quotes"
          }
          quoteBody={{ registrationId: "registration-one", planId: "plan-one" }}
          onComplete={complete}
          onGatewayOpenChange={gatewayChanged}
          onBusyChange={busyChanged}
        />
      </QueryClientProvider>,
    ),
  );
  await until(() => Boolean(pay()));
  await act(async () => pay().click());
  await until(() => Boolean(Checkout.last?.options));
}
it("waits for backend capture, then completes exactly once", async () => {
  await start();
  expect(Checkout.last.options.order_id).toBe("order-one");
  expect(Checkout.last.options.amount).toBe(10000);
  expect(Checkout.last.options.description).toBe("Backend plan");
  expect(Checkout.last.options.prefill.email).toBe("owner@example.com");
  expect(host.textContent).toContain("Access for 30 days");
  await act(async () =>
    Checkout.last.options.handler({
      razorpay_order_id: "order-one",
      razorpay_payment_id: "provider-payment",
      razorpay_signature: "signed-response",
    }),
  );
  expect(mocks.request).toHaveBeenCalledWith("/api/v1/checkout/verify", {
    method: "POST",
    body: JSON.stringify({
      paymentId: "payment-one",
      providerOrderId: "order-one",
      providerPaymentId: "provider-payment",
      signature: "signed-response",
    }),
  });
  expect(complete).not.toHaveBeenCalled();
  expect(gatewayChanged).toHaveBeenLastCalledWith(false);
  state = "CAPTURED";
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["payment", "payment-one"] });
  });
  await until(() => complete.mock.calls.length === 1);
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["payment", "payment-one"] });
  });
  expect(complete).toHaveBeenCalledTimes(1);
});
it("records checkout dismissal and allows retry without showing activation", async () => {
  await start();
  await act(async () => Checkout.last.options.modal.ondismiss());
  await until(() => Boolean(pay()) && !pay().disabled);
  expect(mocks.request).toHaveBeenCalledWith(
    "/api/v1/checkout/payments/payment-one/cancel",
    { method: "POST", body: "{}" },
  );
  expect(complete).not.toHaveBeenCalled();
  await act(async () => pay().click());
  expect(
    mocks.request.mock.calls.filter((call) => call[0].endsWith("/orders")),
  ).toHaveLength(2);
  expect(Checkout.last.options.order_id).toBe("order-one");
  await act(async () => Checkout.last.options.modal.ondismiss());
});
it("keeps the gateway open for retry after failure without calling activation", async () => {
  await start();
  await act(async () =>
    Checkout.last.handlers["payment.failed"]({
      error: { description: "Card declined" },
    }),
  );
  await until(() => host.textContent!.includes("Card declined"));
  expect(complete).not.toHaveBeenCalled();
  expect(gatewayChanged).toHaveBeenLastCalledWith(true);
  expect(pay().disabled).toBe(true);
  await act(async () => Checkout.last.options.modal.ondismiss());
  await until(() => !pay().disabled);
  expect(gatewayChanged).toHaveBeenLastCalledWith(false);
});
it("refreshes an expired quote before asking the owner to pay again", async () => {
  const original = mocks.request.getMockImplementation()!;
  let quotes = 0;
  mocks.request.mockImplementation((path, ...rest) =>
    path.endsWith("/quotes")
      ? Promise.resolve({
          data: {
            publicId: "quote-refreshed",
            planSnapshot: { name: "Backend plan" },
            subtotalMinor: 15000,
            discountMinor: 0,
            taxMinor: 0,
            totalMinor: 15000,
            expiresAt: new Date(
              Date.now() + (++quotes === 1 ? -1000 : 600000),
            ).toISOString(),
          },
        })
      : original(path, ...rest),
  );
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <PaymentCheckout
          quotePath="/api/v1/checkout/platform/quotes"
          quoteBody={{ registrationId: "registration-one", planId: "plan-one" }}
          onComplete={complete}
        />
      </QueryClientProvider>,
    ),
  );
  await until(() => Boolean(pay()));
  await act(async () => pay().click());
  await until(() => host.textContent!.includes("Review the refreshed price"));
  expect(
    mocks.request.mock.calls.some((call) => call[0].endsWith("/orders")),
  ).toBe(false);
  expect(quotes).toBe(2);
  expect(complete).not.toHaveBeenCalled();
});

it("uses the quote currency in the plan totals", async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path, ...rest) => {
    const result = await original(path, ...rest);
    if (path.endsWith("/quotes")) result.data.currency = "USD";
    return result;
  });
  await start();
  expect(host.textContent).toContain("$100.00");
  expect(host.textContent).not.toContain("\u20b9");
  await act(async () => Checkout.last.options.modal.ondismiss());
});

it("allows another attempt if the Razorpay script fails to load", async () => {
  delete (window as any).Razorpay;
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <PaymentCheckout
          quotePath="/api/v1/checkout/platform/quotes"
          quoteBody={{ registrationId: "registration-one", planId: "plan-one" }}
          onComplete={complete}
        />
      </QueryClientProvider>,
    ),
  );
  await until(() => Boolean(pay()));
  await act(async () => pay().click());
  const script = document.querySelector(
    'script[src="https://checkout.razorpay.com/v1/checkout.js"]',
  )!;
  expect(script).not.toBeNull();
  await act(async () => script.dispatchEvent(new Event("error")));
  await until(() =>
    host.textContent!.includes("Razorpay checkout could not load"),
  );
  expect(
    mocks.request.mock.calls.some((call) => call[0].endsWith("/orders")),
  ).toBe(false);
  Object.assign(window, { Razorpay: Checkout });
  await act(async () => pay().click());
  await until(() => Checkout.last.options.order_id === "order-one");
  await act(async () => Checkout.last.options.modal.ondismiss());
});

it("automatically completes member checkout only after verified capture", async () => {
  await start(true);
  await act(async () =>
    Checkout.last.options.handler({
      razorpay_order_id: "order-one",
      razorpay_payment_id: "provider-payment",
      razorpay_signature: "signed-response",
    }),
  );
  expect(complete).not.toHaveBeenCalled();
  state = "CAPTURED";
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["payment", "payment-one"] });
  });
  await until(() => complete.mock.calls.length === 1);
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["payment", "payment-one"] });
  });
  expect(complete).toHaveBeenCalledOnce();
});
it("never completes member checkout when signature verification fails", async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path, ...args) =>
    path === "/api/v1/checkout/verify"
      ? Promise.reject(new Error("Payment verification failed"))
      : original(path, ...args),
  );
  await start(true);
  await act(async () =>
    Checkout.last.options.handler({
      razorpay_order_id: "order-one",
      razorpay_payment_id: "provider-payment",
      razorpay_signature: "invalid",
    }),
  );
  await until(() => host.textContent!.includes("Payment verification failed"));
  expect(complete).not.toHaveBeenCalled();
  expect(gatewayChanged).toHaveBeenLastCalledWith(false);
});

it("lets the gateway own synchronous focus and Escape, restoring the modal only on dismissal", async () => {
  const outside = document.createElement("input");
  outside.setAttribute("aria-label", "Gateway payment input");
  document.body.append(outside);
  const closed = vi.fn();
  function CheckoutDialog() {
    const [gatewayOpen, setGatewayOpen] = useState(false);
    return (
      <Modal open title="Membership checkout" onClose={closed} externalOverlayActive={gatewayOpen}>
        <PaymentCheckout quotePath="/api/v1/checkout/quotes" quoteBody={{ planId: "plan-one" }} onGatewayOpenChange={setGatewayOpen} />
      </Modal>
    );
  }
  try {
    Checkout.openHook = () => outside.focus();
    await act(async () => root.render(<QueryClientProvider client={client}><CheckoutDialog /></QueryClientProvider>));
    await until(() => Boolean(pay()));
    const dialog = document.querySelector('[role="dialog"]')!;
    outside.focus();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await act(async () => pay().click());
    expect(document.activeElement).toBe(outside);
    expect(document.body.style.overflow).toBe("hidden");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    document.querySelector(".modal-backdrop")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(closed).not.toHaveBeenCalled();
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    await act(async () => Checkout.last.handlers["payment.failed"]({ error: { description: "Try another method" } }));
    await until(() => Boolean(pay()) && document.body.textContent!.includes("Try another method"));
    outside.focus();
    expect(document.activeElement).toBe(outside);
    expect(pay().disabled).toBe(true);
    await act(async () => Checkout.last.options.modal.ondismiss());
    await until(() => Boolean(pay()) && !pay().disabled);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    outside.focus();
    expect(dialog.contains(document.activeElement)).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(closed).toHaveBeenCalledOnce();
  } finally {
    outside.remove();
  }
});

it("releases gateway ownership if opening the provider throws", async () => {
  Checkout.openHook = () => { throw new Error("Gateway could not open"); };
  await start();
  await until(() => host.textContent!.includes("Gateway could not open"));
  expect(gatewayChanged.mock.calls.map(([open]) => open)).toEqual([true, false]);
  expect(Checkout.last.close).toHaveBeenCalledOnce();
  expect(pay().disabled).toBe(false);
  expect(complete).not.toHaveBeenCalled();
});

it("closes the owned gateway and releases its focus flag when checkout unmounts", async () => {
  await start();
  const checkout = Checkout.last;
  await act(async () => root.render(null));
  expect(checkout.close).toHaveBeenCalledOnce();
  expect(gatewayChanged).toHaveBeenLastCalledWith(false);
  expect(complete).not.toHaveBeenCalled();
});

it("keeps retry verification busy after a gateway failure and activates only on backend capture", async () => {
  const original = mocks.request.getMockImplementation()!;
  let finishVerification!: (value: { data: { status: string } }) => void;
  mocks.request.mockImplementation((path, ...args) => path === "/api/v1/checkout/verify"
    ? new Promise((resolve) => { finishVerification = resolve; })
    : original(path, ...args));
  await start(true);
  await act(async () => Checkout.last.handlers["payment.failed"]({ error: { description: "First method failed" } }));
  await until(() => host.textContent!.includes("First method failed"));
  expect(busyChanged).toHaveBeenLastCalledWith(false);
  expect(pay().disabled).toBe(true);
  let verification!: Promise<void>;
  await act(async () => {
    verification = Checkout.last.options.handler({
      razorpay_order_id: "order-one", razorpay_payment_id: "provider-retry", razorpay_signature: "verified-retry",
    });
  });
  expect(gatewayChanged).toHaveBeenLastCalledWith(false);
  expect(busyChanged).toHaveBeenLastCalledWith(true);
  const inProgress = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.startsWith("Checkout in progress"));
  expect(inProgress?.disabled).toBe(true);
  expect(complete).not.toHaveBeenCalled();
  expect(mocks.request.mock.calls.filter(([path]) => path.endsWith("/orders"))).toHaveLength(1);
  await act(async () => {
    state = "CAPTURED";
    finishVerification({ data: { status: "CAPTURED" } });
    await verification;
  });
  await until(() => complete.mock.calls.length === 1);
  expect(busyChanged).toHaveBeenLastCalledWith(false);
  expect(complete).toHaveBeenCalledOnce();
});
