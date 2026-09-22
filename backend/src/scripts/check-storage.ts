import "dotenv/config";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { presignedObjectUrl } from "../integrations/storage/s3ObjectStore.js";

// This check only writes and removes its own unique diagnostic object.
const key = `diagnostics/registration-upload-${randomUUID()}.pdf`;
const bytes = Buffer.from(
  "%PDF-1.4\n% GetFit4U registration upload connectivity check. No personal data.\n%%EOF\n",
);
let written = false;
function storageError(xml: string) {
  const code = xml.match(/<Code>([^<]+)<\/Code>/)?.[1] || "UNKNOWN";
  // Never print provider messages containing IAM identities, object paths or keys.
  if (xml.includes("no identity-based policy allows"))
    return `${code}: the IAM identity is missing an object permission policy. See docs/aws-upload-fix/README.md.`;
  if (xml.includes("CORS is not enabled"))
    return `${code}: CORS is not enabled on the bucket. Apply docs/aws-upload-fix/cors.json in the S3 console.`;
  return code;
}
async function request(method: "PUT" | "GET" | "HEAD" | "DELETE") {
  return fetch(presignedObjectUrl(method, key, 120), {
    method,
    signal: AbortSignal.timeout(15000),
    ...(method === "PUT"
      ? { headers: { "content-type": "application/pdf" }, body: bytes }
      : {}),
  });
}
try {
  // A connection failure can occur after S3 accepted the bytes; still attempt cleanup.
  written = true;
  const put = await request("PUT");
  if (!put.ok) {
    written = false;
    const code = storageError(await put.text());
    throw new Error(
      `Storage PUT failed: HTTP ${put.status}, ${code}. Check the bucket, region, endpoint and IAM credentials.`,
    );
  }
  const head = await request("HEAD");
  if (
    !head.ok ||
    Number(head.headers.get("content-length")) !== bytes.length ||
    head.headers.get("content-type") !== "application/pdf"
  )
    throw new Error("Storage metadata verification failed.");
  const get = await request("GET");
  if (!get.ok || !Buffer.from(await get.arrayBuffer()).equals(bytes))
    throw new Error("Storage download verification failed.");
  console.log("PASS: signed cloud upload, metadata verification and download.");
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Storage check failed.",
  );
  process.exitCode = 1;
} finally {
  // Check browser permissions independently, even when IAM blocks the PUT.
  try {
    for (const origin of env.CLIENT_ORIGIN.split(",")
      .map((value) => value.trim())
      .filter(Boolean)) {
      const response = await fetch(presignedObjectUrl("PUT", key, 120), {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "PUT",
          "access-control-request-headers": "content-type",
        },
        signal: AbortSignal.timeout(15000),
      });
      const allow = response.headers.get("access-control-allow-origin");
      if (
        !response.ok ||
        ![origin, "*"].includes(allow || "") ||
        !response.headers.get("access-control-allow-methods")?.includes("PUT")
      )
        throw new Error(
          `Browser upload CORS failed: HTTP ${response.status}, ${storageError(await response.text())}. Check the exact frontend origins in CLIENT_ORIGIN.`,
        );
    }
    console.log(
      "PASS: browser upload CORS for configured application origins.",
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Storage check failed.",
    );
    process.exitCode = 1;
  }
  if (
    written &&
    /^diagnostics\/registration-upload-[a-f0-9-]+\.pdf$/.test(key)
  ) {
    try {
      const deleted = await request("DELETE");
      if (!deleted.ok && deleted.status !== 404)
        throw new Error(
          "Cleanup failed: the diagnostic object could not be removed.",
        );
      console.log("Diagnostic object removed.");
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : "Diagnostic cleanup failed.",
      );
      process.exitCode = 1;
    }
  }
}
