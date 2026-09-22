export function validateDocument(file: File) {
  if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type))
    throw new Error("Choose a PDF, JPG or PNG file.");
  if (!file.size || file.size > 10_000_000)
    throw new Error("Choose a nonempty file no larger than 10 MB.");
}
export function uploadDocumentBytes(
  url: string,
  file: File,
  onProgress: (value: number) => void,
  signal: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = (error?: Error) => {
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve();
    };
    xhr.open("PUT", url);
    xhr.timeout = 120000;
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? finish()
        : finish(
            new Error(
              xhr.status === 403
                ? "Cloud storage rejected the upload. Retry to get a fresh upload link; contact support if this continues."
                : "The cloud upload failed. Retry your selected file.",
            ),
          );
    xhr.onerror = () =>
      finish(
        new Error(
          "Could not reach cloud storage. Check your connection and retry. If this continues, contact support to check upload access.",
        ),
      );
    xhr.ontimeout = () =>
      finish(
        new Error(
          "The upload timed out. Your file is still selected; retry when your connection improves.",
        ),
      );
    xhr.onabort = () =>
      finish(
        new Error("Upload cancelled. You can retry or choose another file."),
      );
    if (signal.aborted) {
      finish(new Error("Upload cancelled."));
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(file);
  });
}
