import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
const h = (key: Buffer | string, value: string) =>
  crypto.createHmac("sha256", key).update(value).digest();
const hex = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase(),
  );
export function presignedObjectUrl(
  method: "PUT" | "GET" | "HEAD" | "DELETE",
  key: string,
  expires = 900,
) {
  if (
    !env.OBJECT_STORAGE_ENDPOINT ||
    !env.OBJECT_STORAGE_ACCESS_KEY ||
    !env.OBJECT_STORAGE_SECRET_KEY
  )
    throw new AppError(
      503,
      "OBJECT_STORAGE_NOT_CONFIGURED",
      "File storage is not configured.",
    );
  if (
    !key ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((part) => !part || part === "." || part === "..") ||
    [...key].some((character) => character.charCodeAt(0) < 32)
  )
    throw new AppError(
      422,
      "INVALID_OBJECT_KEY",
      "Invalid storage object path.",
    );
  const endpoint = new URL(env.OBJECT_STORAGE_ENDPOINT);
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(endpoint.hostname))
  )
    throw new AppError(
      503,
      "OBJECT_STORAGE_ENDPOINT_INVALID",
      "Configure a secure S3 endpoint.",
    );
  const date =
      new Date()
        .toISOString()
        .replace(/[:-]|\.\d{3}/g, "")
        .slice(0, 15) + "Z",
    day = date.slice(0, 8),
    region = env.OBJECT_STORAGE_REGION,
    scope = day + "/" + region + "/s3/aws4_request";
  const virtualHost = endpoint.hostname.startsWith(
    env.OBJECT_STORAGE_BUCKET + ".",
  );
  const path =
    "/" +
    (virtualHost ? "" : encode(env.OBJECT_STORAGE_BUCKET) + "/") +
    key.split("/").map(encode).join("/");
  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": env.OBJECT_STORAGE_ACCESS_KEY + "/" + scope,
    "X-Amz-Date": date,
    "X-Amz-Expires": String(Math.max(1, Math.min(expires, 604800))),
    "X-Amz-SignedHeaders": "host",
    ...(env.OBJECT_STORAGE_SESSION_TOKEN
      ? { "X-Amz-Security-Token": env.OBJECT_STORAGE_SESSION_TOKEN }
      : {}),
  };
  const query = Object.keys(params)
    .sort()
    .map((name) => encode(name) + "=" + encode(params[name]))
    .join("&");
  const canonical =
    method +
    "\n" +
    path +
    "\n" +
    query +
    "\nhost:" +
    endpoint.host +
    "\n\nhost\nUNSIGNED-PAYLOAD";
  const signing = h(
    h(h(h("AWS4" + env.OBJECT_STORAGE_SECRET_KEY, day), region), "s3"),
    "aws4_request",
  );
  const signature = crypto
    .createHmac("sha256", signing)
    .update("AWS4-HMAC-SHA256\n" + date + "\n" + scope + "\n" + hex(canonical))
    .digest("hex");
  return endpoint.origin + path + "?" + query + "&X-Amz-Signature=" + signature;
}
