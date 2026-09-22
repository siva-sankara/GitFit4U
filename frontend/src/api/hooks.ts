import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, type ApiEnvelope } from "../services/apiClient";
import type { InboxNotification } from "../services/notificationAlerts";
import { useSession } from "../services/session";

export const useCurrentUser = useSession;
export const useNotifications = (page = 1, category = "ALL") =>
  useQuery({
    queryKey: ["notifications", page, category],
    queryFn: ({ signal }) =>
      apiRequest<ApiEnvelope<InboxNotification[]>>(
        `/api/v1/users/me/notifications?page=${page}&category=${encodeURIComponent(category)}`,
        { signal },
      ),
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
export function useReadNotification() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/v1/users/me/notifications/${id}/read`, {
        method: "POST",
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
export function useReadAllNotifications() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest("/api/v1/users/me/notifications/read-all", { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
export const useConversations = () =>
  useQuery({
    queryKey: ["conversations"],
    queryFn: () => apiRequest<ApiEnvelope<any[]>>("/api/v1/conversations"),
  });
export const useMessages = (conversationId?: string) =>
  useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () =>
      apiRequest<ApiEnvelope<any[]>>(
        `/api/v1/conversations/${conversationId}/messages`,
      ),
    enabled: Boolean(conversationId),
  });
export function useSendMessage(conversationId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      apiRequest(`/api/v1/conversations/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          clientMessageId: crypto.randomUUID(),
          type: "TEXT",
          text,
        }),
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["messages", conversationId] }),
  });
}
export const useTrainerResource = (resource: string) =>
  useQuery({
    queryKey: ["trainer", resource],
    queryFn: () => apiRequest<ApiEnvelope<any>>(`/api/v1/trainer/${resource}`),
  });
