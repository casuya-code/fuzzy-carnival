import { NextRequest, NextResponse } from "next/server";
import { API_BASE } from "@/lib/api";
import { createPresignedUploadUrl, r2Configured } from "@/lib/r2";

export async function POST(req: NextRequest) {
  try {
    const { filename, contentType } = await req.json();
    if (!filename || !contentType) {
      return NextResponse.json(
        { error: "filename and contentType are required" },
        { status: 400 }
      );
    }
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `references/${Date.now()}-${safeName}`;

    // Local dev fallback: upload directly to backend when R2 is not configured
    if (!r2Configured) {
      // Encode each path segment separately so "/" stays a path separator.
      const encodedKey = key.split("/").map(encodeURIComponent).join("/");
      const upload_url = `${API_BASE}/api/v1/local-upload/${encodedKey}`;
      return NextResponse.json({ upload_url, key });
    }

    const upload_url = await createPresignedUploadUrl(key, contentType);
    return NextResponse.json({ upload_url, key });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to create upload URL" },
      { status: 500 }
    );
  }
}
