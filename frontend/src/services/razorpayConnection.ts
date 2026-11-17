import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, type ApiEnvelope } from "./apiClient";
import { API_URL } from "./runtimeConfig";

export function openRazorpayAuthorization(value: unknown) {
  const url = typeof value === "string" ? new URL(value) : null;
  if (!url || url.origin !== "https://auth.razorpay.com" || url.pathname !== "/authorize")
    throw new Error("Unable to open Razorpay. Please connect again.");
  window.location.assign(url.toString());
}

export function useRazorpayConnect(gymId: string) {
  const starting = useRef(false);
  const [opening, setOpening] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => {
      const path = `/api/v1/gyms/${encodeURIComponent(gymId)}/payments/razorpay`;
      const status = await apiRequest<ApiEnvelope<{ oauthFlowVersion?: number }>>(`${path}/status`);
      if (status.data?.oauthFlowVersion !== 2)
        throw new Error("The payment connection update is not available on this backend yet. Deploy the updated backend before connecting Razorpay.");
      const response = await apiRequest<ApiEnvelope<{ authorizationUrl: string; oauthFlowVersion?: number }>>(`${path}/connect`, {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: JSON.stringify({ browserApiOrigin: new URL(API_URL || window.location.origin).origin }),
      });
      if (response.data?.oauthFlowVersion !== 2)
        throw new Error("The backend changed while starting this connection. Finish deploying the payment update, then connect again.");
      return response;
    },
    onSuccess: response => openRazorpayAuthorization(response.data?.authorizationUrl),
    onError: () => { starting.current = false; setOpening(false); },
  });
  return {
    start: () => {
      if (!gymId || starting.current) return;
      starting.current = true;
      setOpening(true);
      mutation.mutate();
    },
    isPending: mutation.isPending || opening,
    isError: mutation.isError,
    error: mutation.error,
  };
}
