import { NextRequest, NextResponse } from "next/server";
import { API_BASE } from "@/lib/api";
import { createPresignedUploadUrl } from "@/lib/r2";

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

    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    // Local dev fallback: upload directly to backend when R2 is not configured
    if (!accountId || !accessKeyId || !secretAccessKey) {
      const upload_url = `${API_BASE}/api/v1/local-upload/${encodeURIComponent(key)}`;
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