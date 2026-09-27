import { apiRequest, type ApiEnvelope } from "./apiClient";
import { uploadDocumentBytes } from "./documentUpload";
export async function uploadMedia(
  file: File,
  purpose: string,
  onProgress: (progress: number) => void = () => {},
  signal = new AbortController().signal,
) {
  const start = await apiRequest<
    ApiEnvelope<{ uploadUrl: string; attachment: { publicId: string } }>
  >("/api/v1/uploads", {
    method: "POST",
    body: JSON.stringify({
      name: file.name,
      mimeType: file.type,
      size: file.size,
      purpose,
    }),
    signal,
  });
  await uploadDocumentBytes(start.data.uploadUrl, file, onProgress, signal);
  const completed = await apiRequest<
    ApiEnvelope<{
      _id: string;
      publicId: string;
      url: string;
      mimeType: string;
      originalName: string;
      size: number;
    }>
  >(`/api/v1/uploads/${start.data.attachment.publicId}/complete`, {
    method: "POST",
    body: "{}",
    signal,
  });
  return completed.data;
}
