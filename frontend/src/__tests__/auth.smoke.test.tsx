import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import {
  API_BASE,
  analyzeAudio,
  backendAuthHeaders,
  clearTokenIfAuthError,
  detectBpm,
  getUserToken,
  getUserUid,
  isAuthError,
  me,
  processVideoBatch,
  requestUploadUrl,
  setUserToken,
  submitVideoJob,
  synthesize,
  uploadToR2,
  waitForVideoJob,
  warmEngine,
} from "@/lib/api";
import {
  addDeliverable,
  addSpeechHistory,
  clearDeliverables,
  loadDeliverables,
  loadSpeechHistory,
  removeSpeechHistory,
} from "@/lib/history";
import { resolveTextStyle } from "@/lib/textStyles";
import { POST as uploadUrlRoute } from "@/app/api/upload-url/route";
import { createPresignedUploadUrl } from "@/lib/r2";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/r2", () => ({
  r2Configured: true,
  MAX_UPLOAD_BYTES: 25 * 1024 * 1024,
  createPresignedUploadUrl: vi.fn(async () => "https://r2.example/signed"),
}));

const TOKEN_KEY = "yakodonyo_auth_token";

function makeToken(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function liveToken(uid: string | number = "u1"): string {
  return makeToken({ uid, exp: Math.floor(Date.now() / 1000) + 600 });
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as any;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({}));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (window.localStorage) window.localStorage.clear();
});

function Probe() {
  const { user, logoutAll } = useAuth();
  return (
    <div>
      <span data-testid="user">{user?.email ?? "none"}</span>
      <button onClick={() => { void logoutAll().catch(() => {}); }}>logout all</button>
    </div>
  );
}

describe("AuthProvider smoke", () => {
  it("renders children", async () => {
    render(
      <AuthProvider>
        <div>hello</div>
      </AuthProvider>
    );
    expect(await screen.findByText("hello")).toBeInTheDocument();
  });
});

describe("auth tokens and 401 handling", () => {
  it("removes expired tokens and reads the uid from payload segment 1", () => {
    window.localStorage.setItem(TOKEN_KEY, makeToken({ uid: 7, exp: 1 }));
    expect(getUserToken()).toBeNull();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();

    // A stale exp in the header segment must not be treated as the payload.
    const headerOnly = `${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.${Buffer.from(JSON.stringify({ uid: 42 })).toString("base64url")}.sig`;
    window.localStorage.setItem(TOKEN_KEY, headerOnly);
    expect(getUserToken()).toBe(headerOnly);
    expect(getUserUid()).toBe("42");
    expect(backendAuthHeaders()).toEqual({ Authorization: `Bearer ${headerOnly}` });
  });

  it("attaches status to /me errors and clears only auth errors", async () => {
    const token = liveToken();
    setUserToken(token);

    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "expired" }, 401));
    let caught: unknown;
    try { await me(); } catch (e) { caught = e; }
    expect((caught as { status?: number }).status).toBe(401);
    expect(clearTokenIfAuthError(caught)).toBe(true);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();

    setUserToken(token);
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "unavailable" }, 503));
    try { await me(); } catch (e) { caught = e; }
    expect(isAuthError(caught)).toBe(false);
    expect(getUserToken()).toBe(token);
  });

  it("keeps the session when refresh hits a network error", async () => {
    const token = liveToken();
    setUserToken(token);
    fetchMock.mockRejectedValueOnce(new Error("offline"));

    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByTestId("user")).toHaveTextContent("none");
    await waitFor(() => expect(getUserToken()).toBe(token));
  });

  it("clears on a 401 refresh but keeps the token on a logout-all 500", async () => {
    const token = liveToken();
    setUserToken(token);
    fetchMock.mockImplementation(async (url: any) =>
      String(url).includes("/auth/me")
        ? jsonResponse({ user: { id: 1, email: "user@example.com" } })
        : jsonResponse({})
    );

    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByTestId("user")).toHaveTextContent("user@example.com");

    fetchMock.mockImplementation(async (url: any, init?: any) =>
      init?.method === "POST" && String(url).includes("/auth/logout-all")
        ? jsonResponse({ detail: "server error" }, 500)
        : jsonResponse({})
    );
    fireEvent.click(screen.getByText("logout all"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/auth/logout-all"),
        expect.anything()
      )
    );
    expect(getUserToken()).toBe(token);

    fetchMock.mockImplementation(async (url: any, init?: any) =>
      init?.method === "POST" && String(url).includes("/auth/logout-all")
        ? jsonResponse({ detail: "unauthorized" }, 401)
        : jsonResponse({})
    );
    fireEvent.click(screen.getByText("logout all"));
    await waitFor(() => expect(getUserToken()).toBeNull());
  });
});

describe("history storage", () => {
  it("filters corrupted entries before any operation", () => {
    window.localStorage.setItem(
      "speechHistory",
      JSON.stringify([null, { audio_url: "ok" }, 7, { wrong: true }])
    );
    expect(loadSpeechHistory()).toEqual([{ audio_url: "ok" }]);
    expect(removeSpeechHistory("ok")).toEqual([]);
  });

  it("uses one 20-item cap for returned and persisted deliverables", () => {
    let list: any[] = [];
    for (let i = 0; i < 25; i += 1) {
      list = addDeliverable({ kind: "preset", title: "t", url: `u${i}` });
    }
    expect(list).toHaveLength(20);
    expect(JSON.parse(window.localStorage.getItem("deliverableHistory") || "[]")).toHaveLength(20);
  });

  it("scopes keys by uid and migrates legacy entries once", () => {
    window.localStorage.setItem(
      "speechHistory",
      JSON.stringify([{ audio_url: "legacy" }])
    );
    setUserToken(liveToken("alice"));
    expect(addSpeechHistory({ audio_r2_key: "k", audio_url: "new" })).toHaveLength(2);
    expect(window.localStorage.getItem("speechHistory")).toBeNull();
    expect(
      JSON.parse(window.localStorage.getItem("yakodonyo:history:alice:speechHistory") || "[]")
    ).toHaveLength(2);

    setUserToken(liveToken("bob"));
    expect(loadSpeechHistory()).toEqual([]);
  });

  it("clears both scoped and legacy deliverable keys", () => {
    window.localStorage.setItem("deliverableHistory", "[]");
    setUserToken(liveToken("alice"));
    addDeliverable({ kind: "preset", title: "t", url: "u" });
    clearDeliverables();
    expect(loadDeliverables()).toEqual([]);
    expect(window.localStorage.getItem("deliverableHistory")).toBeNull();
    expect(window.localStorage.getItem("yakodonyo:history:alice:deliverableHistory")).toBeNull();
  });
});

describe("API requests", () => {
  it("builds multipart bodies and sends auth headers", async () => {
    const token = liveToken();
    setUserToken(token);
    fetchMock.mockResolvedValueOnce(jsonResponse({ video_url: "u" }));
    const clip = new File(["x"], "clip.mp4", { type: "video/mp4" });

    await processVideoBatch({ clips: [clip], aspect_ratio: "9:16", trim_end_sec: 2, topic: "t" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/v1/video/process-batch`);
    expect((init.body as FormData).get("aspect_ratio")).toBe("9:16");
    expect(((init.body as FormData).get("clips") as File).name).toBe("clip.mp4");
    expect(init.headers.Authorization).toBe(`Bearer ${token}`);
  });

  it("sends auth headers on audio analysis and upload-url requests", async () => {
    const token = liveToken();
    setUserToken(token);
    fetchMock.mockResolvedValue(jsonResponse({ bpm: 100 }));

    await detectBpm("key");
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    });
    await analyzeAudio("key");
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      Authorization: `Bearer ${token}`,
    });
    await requestUploadUrl("a.webm", "audio/webm", 42);
    expect(fetchMock.mock.calls[2][0]).toBe("/api/upload-url");
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ contentLength: 42 });
  });

  it("strips MIME parameters and authorizes only local uploads", async () => {
    const token = liveToken();
    setUserToken(token);
    fetchMock.mockResolvedValue(jsonResponse({}));
    const blob = new Blob(["a"], { type: "audio/webm;codecs=opus" });

    await uploadToR2("https://r2.example/signed?sig=1", blob, blob.type);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "Content-Type": "audio/webm" });

    await uploadToR2(`${API_BASE}/api/v1/local-upload/references/a.webm`, blob, blob.type);
    const localCall = fetchMock.mock.calls.find(([url]) =>
      String(url) === `${API_BASE}/api/v1/local-upload/references/a.webm`
    );
    expect(localCall?.[1].headers).toEqual({
      "Content-Type": "audio/webm",
      Authorization: `Bearer ${token}`,
    });
  });

  it("reports cancelled/error status when synthesis throws", async () => {
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    fetchMock.mockRejectedValueOnce(aborted);
    await expect(synthesize({ text: "t", language: "en", engine: "kyutai" }))
      .rejects.toThrow("aborted");

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(synthesize({ text: "t", language: "en", engine: "kyutai" }))
      .rejects.toThrow("offline");

    const metrics = fetchMock.mock.calls
      .filter(([url]) => String(url).includes("/api/v1/metrics"))
      .map(([, init]) => JSON.parse(init.body).fields.status);
    expect(metrics).toEqual(["cancelled", "error"]);
  });

  it("warmEngine reports failure instead of claiming success", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(warmEngine("kyutai")).resolves.toBe(false);
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 200));
    await expect(warmEngine("kyutai")).resolves.toBe(true);
  });
});

describe("video job polling", () => {
  it("pins job headers across a token change", async () => {
    const first = liveToken("first");
    setUserToken(first);
    fetchMock.mockImplementation(async (url: any, init?: any) => {
      const target = String(url);
      if (target.includes("/video/jobs/process")) {
        return jsonResponse({ job_id: "j1", status: "queued", status_url: "/status" });
      }
      if (target.includes("/video/jobs/j1") && init?.method !== "DELETE") {
        return jsonResponse({
          job_id: "j1", kind: "process", status: "succeeded", progress: 100, stage: "done",
        });
      }
      return jsonResponse({});
    });

    const accepted = await submitVideoJob("process", { aspect_ratio: "9:16" });
    setUserToken(liveToken("second"));
    const done = await waitForVideoJob(accepted.job_id, { intervalMs: 1 });
    expect(done.status).toBe("succeeded");

    const statusCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes("/video/jobs/j1") && init?.method !== "DELETE"
    );
    expect(statusCall?.[1].headers.Authorization).toBe(`Bearer ${first}`);
  });

  it("cancels the job when polling is externally aborted", async () => {
    setUserToken(liveToken());
    fetchMock.mockImplementation(async (url: any, init?: any) => {
      if (String(url).includes("/video/jobs/j1")) {
        if (init?.method === "DELETE") return jsonResponse({});
        return jsonResponse({
          job_id: "j1", kind: "process", status: "running", progress: 0, stage: "wait",
        });
      }
      return jsonResponse({});
    });

    const controller = new AbortController();
    const pending = waitForVideoJob("j1", {
      signal: controller.signal,
      intervalMs: 10,
      timeoutMs: 500,
    });
    setTimeout(() => controller.abort(), 25);
    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
      message: "Video job cancelled",
    });
    expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).includes("/video/jobs/j1") && init?.method === "DELETE"
    )).toBe(true);
  });

  it("enforces its own deadline", async () => {
    fetchMock.mockImplementation(async (url: any) =>
      String(url).includes("/video/jobs/t1")
        ? jsonResponse({ job_id: "t1", kind: "process", status: "queued", progress: 0, stage: "wait" })
        : jsonResponse({})
    );
    await expect(waitForVideoJob("t1", { intervalMs: 50, timeoutMs: 15 }))
      .rejects.toThrow("Video job timed out");
  });
});

describe("text styles", () => {
  it("does not resolve inherited Object keys as presets", () => {
    const style = resolveTextStyle({ preset: "toString", font_scale: NaN });
    expect(style.preset).toBe("custom");
    expect(Number.isFinite(style.font_scale)).toBe(true);
    expect(resolveTextStyle({ preset: "neon" }).preset).toBe("neon");
  });
});

describe("upload-url route", () => {
  const auth = `Bearer ${liveToken("route-user")}`;
  const body = { filename: "clip.webm", contentType: "audio/webm;codecs=opus", contentLength: 123 };

  function request(payload: unknown, authorization?: string) {
    return {
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "authorization" && authorization ? authorization : null,
      },
      json: async () => payload,
    } as any;
  }

  it("rejects anonymous callers before signing", async () => {
    const res = await uploadUrlRoute(request(body));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it("verifies the bearer token with the backend", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "bad token" }, 401));
    const res = await uploadUrlRoute(request(body, auth));
    expect(res.status).toBe(401);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/api/v1/auth/me`);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: auth });
    expect(createPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it("requires a valid content length and signs with it", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user: { id: 1 } }));

    expect((await uploadUrlRoute(request({ ...body, contentLength: 0 }, auth))).status).toBe(400);
    expect((await uploadUrlRoute(request({ ...body, contentLength: 25 * 1024 * 1024 + 1 }, auth))).status).toBe(413);

    const res = await uploadUrlRoute(request(body, auth));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.key).toMatch(/^references\/[0-9a-f-]{36}-clip\.webm$/);
    expect(createPresignedUploadUrl).toHaveBeenCalledWith(data.key, "audio/webm", 123);
  });
});
