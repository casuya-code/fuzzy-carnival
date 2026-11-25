import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME || "voice-clone-audio";

/** Single source of truth for whether direct R2 uploads are available. */
export const r2Configured = Boolean(accountId && accessKeyId && secretAccessKey);

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: accessKeyId || "",
    secretAccessKey: secretAccessKey || "",
  },
});

/**
 * Generate a presigned PUT URL so the browser can upload a reference clip
 * directly to R2 without proxying through our servers.
 */
export async function createPresignedUploadUrl(
  key: string,
  contentType: string,
  contentLength?: number
) {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
    ...(typeof contentLength === "number" && contentLength > 0
      ? { ContentLength: contentLength }
      : {}),
  });
  const url = await getSignedUrl(r2Client, command, { expiresIn: 300 });
  return url;
}
