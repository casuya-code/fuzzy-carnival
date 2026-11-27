import { NextRequest, NextResponse } from "next/server";
import { API_BASE } from "@/lib/api";
import { createPresignedUploadUrl, MAX_UPLOAD_BYTES, r2Configured } from "@/lib/r2";

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
  "video/mp4",
  "video/webm",
]);
const ALLOWED_EXTS = new Set(["webm", "wav", "mp3", "m4a", "aac", "ogg", "flac", "mp4"]);

export async function POST(req: NextRequest) {
  // Never mint a write URL for an anonymous caller. Do not fall back to
  // NEXT_PUBLIC_API_KEY here: only a verified user token is authoritative.
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ") || !auth.slice(7).trim()) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  try {
    const me = await fetch(`${API_BASE}/api/v1/auth/me`, {
      headers: { Authorization: auth },
      cache: "no-store",
    });
    if (!me.ok) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "Auth check unavailable" }, { status: 503 });
  }

  try {
    const body = await req.json();
    const filename = typeof body?.filename === "string" ? body.filename : "";
    const contentTypeRaw = typeof body?.contentType === "string" ? body.contentType : "";
    const contentType = contentTypeRaw.split(";")[0].trim().toLowerCase();
    const contentLengthRaw = body?.contentLength;
    const contentLength =
      typeof contentLengthRaw === "number" &&
      Number.isInteger(contentLengthRaw) &&
      contentLengthRaw > 0
        ? contentLengthRaw
        : 0;

    if (!filename || !contentType) {
      return NextResponse.json(
        { error: "filename and contentType are required" },
        { status: 400 }
      );
    }
    if (!ALLOWED_AUDIO_TYPES.has(contentType)) {
      return NextResponse.json({ error: "Unsupported content type" }, { status: 400 });
    }
    if (!contentLength) {
      return NextResponse.json({ error: "Valid contentLength is required" }, { status: 400 });
    }
    if (contentLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB)` },
        { status: 413 }
      );
    }

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    const ext = safeName.split(".").pop()?.toLowerCase() || "";
    if (!ALLOWED_EXTS.has(ext)) {
      return NextResponse.json({ error: "Unsupported file extension" }, { status: 400 });
    }
    const key = `references/${crypto.randomUUID()}-${safeName}`;

    // Local dev fallback: upload directly to backend when R2 is not configured
    if (!r2Configured) {
      // Encode each path segment separately so "/" stays a path separator.
      const encodedKey = key.split("/").map(encodeURIComponent).join("/");
      const upload_url = `${API_BASE}/api/v1/local-upload/${encodedKey}`;
      return NextResponse.json({ upload_url, key });
    }

    const upload_url = await createPresignedUploadUrl(key, contentType, contentLength);
    return NextResponse.json({ upload_url, key });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to create upload URL" },
      { status: 500 }
    );
  }
}
