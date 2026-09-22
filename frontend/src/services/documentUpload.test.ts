// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { uploadDocumentBytes } from "./documentUpload";
class Request {
  static last: Request;
  upload: { onprogress?: (event: any) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  ontimeout?: () => void;
  status = 200;
  timeout = 0;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.onabort?.());
  constructor() {
    Request.last = this;
  }
}
afterEach(() => vi.unstubAllGlobals());
it("sends file bytes to the signed URL and reports actual upload progress", async () => {
  vi.stubGlobal("XMLHttpRequest", Request);
  const file = new File(["%PDF-1.4"], "proof.pdf", { type: "application/pdf" }),
    progress = vi.fn();
  const result = uploadDocumentBytes(
    "https://storage.example/signed",
    file,
    progress,
    new AbortController().signal,
  );
  const request = Request.last;
  expect(request.open).toHaveBeenCalledWith(
    "PUT",
    "https://storage.example/signed",
  );
  expect(request.setRequestHeader).toHaveBeenCalledExactlyOnceWith(
    "Content-Type",
    "application/pdf",
  );
  expect(request.send).toHaveBeenCalledWith(file);
  request.upload.onprogress?.({ lengthComputable: true, loaded: 6, total: 8 });
  expect(progress).toHaveBeenCalledWith(75);
  request.onload?.();
  await result;
});
it("rejects storage access errors without reporting upload success", async () => {
  vi.stubGlobal("XMLHttpRequest", Request);
  const result = uploadDocumentBytes(
    "https://storage.example/signed",
    new File(["proof"], "proof.pdf"),
    vi.fn(),
    new AbortController().signal,
  );
  const assertion = expect(result).rejects.toThrow(
    "Cloud storage rejected the upload",
  );
  Request.last.status = 403;
  Request.last.onload?.();
  await assertion;
});
it("cancels the transfer when requested", async () => {
  vi.stubGlobal("XMLHttpRequest", Request);
  const controller = new AbortController();
  const result = uploadDocumentBytes(
    "https://storage.example/signed",
    new File(["proof"], "proof.pdf"),
    vi.fn(),
    controller.signal,
  );
  const assertion = expect(result).rejects.toThrow("Upload cancelled");
  controller.abort();
  await assertion;
  expect(Request.last.abort).toHaveBeenCalledTimes(1);
});
