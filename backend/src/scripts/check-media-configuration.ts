import { env } from "../config/env.js";
import {
  storageProvider,
  verifyMediaConfiguration,
} from "../integrations/storage/mediaStore.js";
const provider = storageProvider();
try {
  verifyMediaConfiguration();
  console.log(
    JSON.stringify({
      provider,
      configured: true,
      endpointHost:
        provider === "s3" && env.OBJECT_STORAGE_ENDPOINT
          ? new URL(env.OBJECT_STORAGE_ENDPOINT).hostname
          : "api.cloudinary.com",
      note: "Configuration presence only; no external upload was made.",
    }),
  );
} catch {
  console.log(
    JSON.stringify({
      provider,
      configured: false,
      required:
        provider === "cloudinary"
          ? [
              "CLOUDINARY_CLOUD_NAME",
              "CLOUDINARY_API_KEY",
              "CLOUDINARY_API_SECRET",
            ]
          : [
              "OBJECT_STORAGE_ENDPOINT",
              "OBJECT_STORAGE_ACCESS_KEY",
              "OBJECT_STORAGE_SECRET_KEY",
            ],
    }),
  );
  process.exitCode = 1;
}
