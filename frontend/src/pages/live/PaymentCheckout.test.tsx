// @vitest-environment jsdom
import { act } from "react";
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
let host: HTMLDivElement,
  root: Root,
  client: QueryClient,
  state: string,
  complete: ReturnType<typeof vi.fn<() => void>>;
class Checkout {
  static last: Checkout;
  handlers: Record<string, (value: any) => void> = {};
  constructor(public options: any) {
    Checkout.last = this;
  }
  on(event: string, handler: (value: any) => void) {
    this.handlers[event] = handler;
  }
  open() {}
}
beforeEach(() => {
  vi.resetAllMocks();
  state = "PENDING";
  complete = vi.fn();
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
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  expect(check()).toBe(true);
}
function pay() {
  return Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === "Pay with Razorpay",
  )!;
}
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
it("shows gateway failure without calling activation", async () => {
  await start();
  await act(async () =>
    Checkout.last.handlers["payment.failed"]({
      error: { description: "Card declined" },
    }),
  );
  await until(() => host.textContent!.includes("Card declined"));
  expect(complete).not.toHaveBeenCalled();
  expect(pay().disabled).toBe(false);
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
});
