# Yakodonyo Studio — consolidated codebase audit

**Type:** read-only audit. **Workspace:** `C:\Users\Admin\Desktop\yakodonyo`.

All paths below are relative to the workspace root. Every finding was re-opened against the current tree; duplicates were merged and lint-only noise was excluded unless it changes behavior.

---

## Contents

- [Critical](#critical)
- [High](#high)
  - [Backend — auth, config, abuse control](#backend--auth-config-abuse-control)
  - [Backend — synthesis pipeline](#backend--synthesis-pipeline)
  - [Backend — video pipeline](#backend--video-pipeline)
  - [Storage, packaging, frontend](#storage-packaging-frontend)
- [Medium](#medium)
  - [Backend](#backend)
  - [Frontend](#frontend)
- [Re-confirmed duplicates](#re-confirmed-duplicates)
- [Explicitly rejected / excluded](#explicitly-rejected--excluded)
- [Highest-leverage fix order](#highest-leverage-fix-order)

---

## Critical

### C1 — Rate limiting is fully bypassable via `X-Forwarded-For`

**Files:** `backend/app/rate_limit.py:45-49`, `backend/app/rate_limit.py:90-92`

`_client_ip()` trusts the first client-supplied `X-Forwarded-For` value, and the rate-limit key is `{ip}:{request.url.path}`. A client can send a random XFF header per request and get a fresh bucket on every endpoint, including login, signup, reset, synthesis, and upload. This also defeats account lockout in practice.

**Fix:**

```python
_TRUST_XFF = _env_bool("TRUST_X_FORWARDED_FOR", False)

def _client_ip(request: Request) -> str:
    if _TRUST_XFF:
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip() or "unknown"
    return request.client.host if request.client else "unknown"

def rate_limit(request: Request) -> None:
    ip = _client_ip(request)
    route = request.scope.get("route")
    path = getattr(route, "path", request.url.path)
    key = f"{ip}:{request.method}:{path}"
```

---

### C2 — Default `AUTH_SECRET` allows JWT forgery and full account takeover

**Files:** `backend/app/config.py:123`, `backend/app/services/user_store.py:192-210`

`AUTH_SECRET` falls back to the publicly known `"dev-insecure-change-me"`. Tokens are HMAC-signed only with this value and trust `uid`, `email`, and `tv`. If deployed unset, anyone can forge a token for any user and bypass password auth entirely.

**Fix:**

```python
import secrets

REQUIRE_AUTH = _env_bool("REQUIRE_AUTH", False)
AUTH_SECRET = os.getenv("AUTH_SECRET", "").strip()
if not AUTH_SECRET:
    if os.getenv("ENVIRONMENT", "dev").lower() in {"prod", "production"}:
        raise RuntimeError("AUTH_SECRET must be set in production")
    AUTH_SECRET = secrets.token_urlsafe(32)
```

---

### C3 — User database is on ephemeral storage with no Railway volume

**Files:** `backend/app/config.py:142`, `backend/railway.toml:1-12`

`APP_DB_PATH` defaults to `backend/data/app.db`. `railway.toml` declares no volume and enables `sleepApplication = true`. Every redeploy or sleep/wake cycle destroys all accounts, password hashes, token versions, and reset tokens.

**Fix:**

```toml
[[volumes]]
name = "app-data"
mountPath = "/app/data"
```

Set `APP_DB_PATH=/app/data/app.db` in the Railway service environment. Also apply the SQLite hardening in **M7** below.

---

### C4 — `/api/upload-url` mints R2 write URLs without authentication

**Files:** `frontend/src/app/api/upload-url/route.ts:23-64`, `frontend/src/lib/r2.ts:25-38`

The Next route has no auth check and no `middleware.ts` exists. Any anonymous caller can obtain a 5-minute presigned PUT URL into the app’s `references/*` prefix. Keys are predictable (`route.ts:53`), allowing overwrite/poisoning of another user’s voice sample before cloning.

**Fix:**

```ts
// frontend/src/lib/api.ts:292-296
headers: { "Content-Type": "application/json", ...backendAuthHeaders() },
```

```ts
// frontend/src/app/api/upload-url/route.ts
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const me = await fetch(`${API_BASE}/api/v1/auth/me`, { headers: { Authorization: auth } });
  if (!me.ok) return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  // ...existing validation/signing unchanged...
}
```

Use a random key:

```ts
const key = `references/${crypto.randomUUID()}-${safeName}`;
```

---

### C5 — Presigned R2 uploads send a `Content-Type` that does not match the signature

**Files:** `frontend/src/lib/api.ts:301-311` (header at `:305`), `frontend/src/app/api/upload-url/route.ts:28,63`, `frontend/src/lib/r2.ts:30-37`, `frontend/src/components/VoiceRecorder.tsx:124-147`

`MediaRecorder` prefers `audio/webm;codecs=opus` (`VoiceRecorder.tsx:124`). The route strips parameters before signing (`route.ts:28`) and `createPresignedUploadUrl()` signs `ContentType: "audio/webm"` (`r2.ts:33`), but the PUT sends the raw MIME with codec parameters. S3/R2 rejects the mismatch with `SignatureDoesNotMatch`/403, so voice recording succeeds but the sample never uploads. Parameterized background-track MIME types hit the same failure.

**Fix:**

```ts
export async function uploadToR2(uploadUrl: string, file: Blob, contentType: string) {
  const signedType = contentType.split(";")[0].trim().toLowerCase();
  const isLocal = uploadUrl.startsWith(`${API_BASE}/api/v1/local-upload/`);
  return measured("upload.blob", { kind: isLocal ? "local" : "r2" }, async () => {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": signedType,
        ...(isLocal ? backendAuthHeaders() : {}),
      },
      body: file,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return true;
  });
}
```

Delete the now-unused `uploadLocalBlob()` at `frontend/src/lib/api.ts:314-332`.

---

### C6 — Local/dev upload fallback always returns 401

**Files:** `frontend/src/lib/api.ts:301-311`, `frontend/src/app/api/upload-url/route.ts:55-60`, `backend/app/routers/storage.py:37,67`, `backend/app/auth.py:39-63`

When R2 is unset, the route returns a backend `/api/v1/local-upload/<key>` URL. That backend router requires `require_api_key`, which rejects credential-less requests even when no API key is configured. `uploadToR2()` sends only `Content-Type`, so every local-mode voice/music upload fails with 401.

**Fix:** use the `isLocal ? backendAuthHeaders() : {}` branch in **C5**. Do **not** add `Authorization` to presigned R2 URLs, because it can invalidate the signature.

---

### C7 — `ModelManager` loads an engine that alone exceeds `MAX_RAM_GB`

**Files:** `backend/app/services/model_manager.py:68-90`, `backend/app/config.py:146`, `backend/tests/test_model_manager.py:47-55`

The eviction loop only evicts *other* engines. With `MAX_RAM_GB=0.5` and a 3.5 GB engine, all others are evicted, `current` becomes 0, and `engine.ensure_loaded()` still runs → container OOM. The existing test codifies the bug.

**Fix:**

```python
# model_manager.py, before eviction at line 75
if name not in CLOUD_ENGINES and engine.ram_gb > MAX_RAM_GB:
    raise ValueError(
        f"Engine '{name}' needs {engine.ram_gb} GB, exceeds MAX_RAM_GB={MAX_RAM_GB}"
    )
```

Update `test_model_manager.py:47-55` to expect the rejection.

---

### C8 — Default backend config hides every voice engine in the UI

**Files:** `backend/app/main.py:171-182`, `backend/app/config.py:137`, `frontend/src/app/text-to-speech/page.tsx:141-147,293`

`EXPOSE_HEALTH_DETAILS` defaults to `false`, so the minimal `/health` response hard-codes `engines=[]` at `main.py:178`. The speech page treats that empty array as authoritative: `EngineSelector` receives `availableEngines={health?.engines ?? null}` at `:293`, and the validation effect at `:141-147` rejects every engine. A default deployment displays **“No voice engines are available”** even though synthesis works.

**Fix:** keep the non-sensitive enabled-engine list in the minimal response without changing the `HealthResponse` key shape:

```python
# backend/app/main.py:171-182
if not EXPOSE_HEALTH_DETAILS:
    return HealthResponse(
        status="ok" if ready else "degraded",
        awake=True,
        ready=ready,
        loaded_models=[],
        engines=engines,          # non-sensitive enabled names
        capabilities={},
        worker={},
        issues=[],
    )
```

Add the defensive page fix:

```tsx
const availableEngines = health?.engines?.length ? health.engines : null;
// ...
<EngineSelector availableEngines={availableEngines} ... />
```

---

## High

### Backend — auth, config, abuse control

**H1 — `REQUIRE_AUTH` is dead configuration.** `backend/app/auth.py:7-8,18,39-63`; `backend/app/config.py:120`. Imported but never used. With no keys, every request gets 401 regardless of the flag. **Fix:** in `require_api_key()`, after `keys = _configured_keys()`, handle `if not keys:` according to `REQUIRE_AUTH`, or remove the flag from config/docs.

**H2 — Stale `X-API-Key` masks a valid Bearer JWT.** `backend/app/auth.py:49-53`. A client with both headers gets 401 before the bearer token is evaluated. **Fix:** try API-key match, then bearer-key match, then `verify_access_token()`, then 401.

**H3 — Redis outage is cached forever.** `backend/app/rate_limit.py:24-42,93-103`. `_redis_init = True` is set before connecting; a transient failure permanently disables Redis rate limiting. **Fix:** replace `_redis_init` with a cooldown (`_redis_fail_until`) and retry later.

**H4 — Password resets do not invalidate outstanding tokens.** `backend/app/services/user_store.py:222-257`. An older emailed token remains valid after a victim uses a newer one. **Fix:** mark all unused rows used in `create_password_reset()` and in `reset_password()` use a conditional `UPDATE ... WHERE used_at=0` with a `rowcount` check.

**H5 — Failed-login increment is a read-modify-write race.** `backend/app/services/user_store.py:141-159`. Parallel wrong passwords lose increments, so lockout never triggers. **Fix:**

```sql
UPDATE users
SET failed_logins = failed_logins + 1,
    locked_until = CASE WHEN failed_logins + 1 >= ? THEN ? ELSE locked_until END
WHERE id = ?
```

**H6 — Lockout counter is never cleared after expiry.** `backend/app/services/user_store.py:137-153`. After 15 minutes, one wrong guess re-locks immediately. **Fix:** when `locked_until <= now`, reset `failed_logins=0, locked_until=0` before verifying the password.

**H7 — Avatar data URL permits CSS injection.** `backend/app/services/user_store.py:275-288`; rendered in `frontend/src/components/Sidebar.tsx:26-28`, `frontend/src/app/page.tsx:82`, `frontend/src/app/profile/page.tsx:52`. `startswith("data:image/")` plus `";base64,"` is not a full validation. **Fix:**

```python
import re
if not re.fullmatch(r"data:image/(?:png|jpe?g|gif|webp);base64,([A-Za-z0-9+/]+={0,2})", value):
    raise ValueError("Invalid profile image data URL")
```

Also check decoded magic bytes.

**H8 — SMTP STARTTLS has no certificate verification.** `backend/app/services/mailer.py:29-31`. **Fix:** `s.starttls(context=ssl.create_default_context())` followed by `s.ehlo()`.

**H9 — Metrics ingestion has no rate limit and unbounded event cardinality.** `backend/app/routers/observability.py:9,24-28`; `backend/app/observability.py:18-31`. Unlike other routers, it omits `Depends(rate_limit)`; `_samples.setdefault(event, ...)` grows without bound. **Fix:** add `Depends(rate_limit)`, cap `_samples` at ~200 events with FIFO eviction, and bound `fields` value lengths.

**H10 — `/static` serves every temp file without auth.** `backend/app/main.py:116-119`; `backend/app/config.py:136,139`. Reference audio, fonts, and job inputs are publicly fetchable by default. **Fix:** default `SERVE_STATIC` and `ALLOW_LOCAL_MEDIA_FALLBACK` to `False`; when enabled, mount only `TEMP_AUDIO_DIR / "outputs"` under `/static/outputs`.

**H11 — Wildcard CORS origins are silently discarded.** `backend/app/config.py:152-170`. `ALLOWED_ORIGINS=https://*.example.com` is filtered out and never converted to a regex. **Fix:** build a regex from wildcard entries when `CORS_ORIGIN_REGEX` is unset.

**H12 — `_env_float` accepts `nan`/`inf`.** `backend/app/config.py:46-61`; impact at `backend/app/services/model_manager.py:75,84`. `MAX_RAM_GB=nan` disables all eviction. **Fix:**

```python
if not math.isfinite(val):
    return default
```

**H13 — CI reports green while backend tests silently skip.** `.github/workflows/ci.yml:18-29`; `backend/tests/test_profile.py:7-23`; `backend/tests/test_smoke.py:8-36`. CI installs a hand-picked subset; import failures become `pytest.skip`. Also `.github/workflows/ci.yml:21` uses unquoted `requests>=2.31.0`, which bash treats as stdout redirection into `=2.31.0`. **Fix:**

```yaml
pip install -r requirements-dev.txt
python -c "from app.main import app"
```

Remove the try/except skips. If keeping the minimal install, quote every specifier.

---

### Backend — synthesis pipeline

**H14 — Cloud→local fallback bypasses the synthesis worker.** `backend/app/routers/synthesize.py:732-758`; fallbacks at `:485-506`, `:542-588`. `use_worker` is computed from the requested engine, so when Azure/ElevenLabs is disabled/unconfigured, local models load in the API process where `cancel_event` cannot stop them. **Fix:** always route through `worker.submit(...)`.

**H15 — A single fallback engine can be disabled.** `backend/app/routers/synthesize.py:490-501,544-552`. **Fix:** select the first enabled fallback or return 503 with an explicit “no fallback available” error.

**H16 — Chunked synthesis ignores `out_path` and assumes ffmpeg.** `backend/app/routers/synthesize.py:179-224`. **Fix:** honor `out_path`, validate ffmpeg availability, and use a cancellation-aware subprocess call.

**H17 — Duplicate model warm-up in API process and worker.** `backend/app/main.py:78-83`; `backend/app/services/synthesis_worker.py:40-44`. Both processes warm kyutai + mms, roughly doubling RAM. **Fix:** delete `main.py:78-83`; warm only in the worker.

**H18 — `submit()` drops foreign results.** `backend/app/services/synthesis_worker.py:249-251`. `/warm` requeues foreign results at `:202-205`, but `submit()` discards them; a warm completion during synthesis is lost and `/warm` spins to its deadline. **Fix:** requeue non-matching results in `submit()`, and serialize `/warm` with `_synthesize_lock` in `backend/app/routers/text.py:43`.

**H19 — Stale reference cache after R2 key overwrite.** `backend/app/routers/synthesize.py:344-358` vs `:365-383`. Fast paths trust cache keyed only by R2 key + denoise; the content-hash guard runs only on a miss. **Fix:** remove both fast paths and always verify by SHA-256 of downloaded bytes.

**H20 — `get_manager()` is not thread-safe.** `backend/app/routers/synthesize.py:116-120`. Lifespan warm thread, `/health`, and worker can race and load duplicate weights. **Fix:** double-checked locking with `threading.Lock()`.

**H21 — Network I/O under the global cache lock.** `backend/app/routers/synthesize.py:239-257`. S3 HEAD and presign run while holding `_cache_lock`, serializing all cache traffic. **Fix:** pop/read under the lock, validate/sign outside it.

**H22 — `object_exists()` always returns True with a public R2 URL.** `backend/app/services/r2_storage.py:79-81`, used at `synthesize.py:249`. Deleted outputs stay cached and users receive 404 URLs. **Fix:** always HEAD the object or HEAD the public URL.

**H23 — Warnings are stripped from cached responses.** `backend/app/routers/synthesize.py:458-462`, `:679-685`. Remap/fallback warnings are stored as `warning=None`, so identical later requests are silent. **Fix:** recompute request-derivable warnings on every cache hit.

---

### Backend — video pipeline

**H24 — Cancellation is converted into HTTP 500.** `backend/app/routers/video.py:358-366,481-487,674-682`; `backend/app/routers/video_jobs.py:448-449`; `backend/app/services/job_context.py:19-20,92`. `JobCancelled` subclasses `Exception` but is caught by generic `except Exception`. **Fix:**

```python
from app.services.job_context import JobCancelled
...
except HTTPException:
    raise
except JobCancelled:
    raise
```

Add that clause before every generic handler in the four locations.

**H25 — Cancel/status race can resurrect a cancelled job.** `backend/app/services/video_jobs.py:82-118`; `backend/app/routers/video_jobs.py:136-143`. `update(status="running")` and `finish(status="succeeded")` can overwrite `cancelled`. **Fix:** make update ignore terminal statuses and make finish authoritative using `job.cancel_event.is_set()`.

**H26 — Visual overlays are applied twice.** `backend/app/routers/video.py:261,332,445-446,462`; `backend/app/services/video_processor.py:93-104,145-181`. **Fix:** pass `overlay="none"` to `trim_and_zoom_clip()` and keep `overlay=overlay_fx` only on `stitch_clips_with_audio()`.

**H27 — Invalid `lower_third` JSON returns 500.** `backend/app/routers/video.py:273,589`; `backend/app/routers/video_jobs.py:227,373`. **Fix:** add `_lower_third_or_400()` using `normalize_lower_third()` and call it in all four paths.

**H28 — Video/audio uploads are unbounded.** `backend/app/routers/video.py:228-253,418-422,566-570`; `backend/app/routers/video_jobs.py:71-84`. **Fix:** shared capped-copy helper using `MAX_UPLOAD_BYTES` and return 413 before materializing.

**H29 — Job finalize segment parsing disagrees with sync finalize.** `backend/app/routers/video_jobs.py:366` vs `backend/app/routers/video.py:532-542`. `["a,b.mp4"]` is counted as two segments in the job path. **Fix:** use `json.loads()` with comma-split fallback exactly as in `video.py`.

**H30 — `-stream_loop -1` with stream copy breaks MP4 timestamps.** `backend/app/services/video_processor.py:288,309`. **Fix:** force `must_encode_video = True` whenever looping is used.

**H31 — `run_ffmpeg` leaks an orphan process on unexpected exceptions.** `backend/app/services/job_context.py:79-95`. `Popen` is outside any `try`. **Fix:** wrap the loop in `try/except BaseException`, kill/reap the process, then re-raise.

**H32 — Background tasks have no strong reference.** `backend/app/routers/video_jobs.py:275,327,414`. **Fix:** keep a module-level `set[asyncio.Task]`, add `task.add_done_callback(set.discard)`, and drain on shutdown.

**H33 — `get_duration()` has no timeout.** `backend/app/services/audio_processor.py:376-394`. **Fix:** `subprocess.run(..., timeout=15)` and handle `TimeoutExpired` like other failures.

**H34 — Slot and temp files leak if submission fails after `acquire_slot()`.** `backend/app/routers/video_jobs.py:229-275,303-327,375-414`. **Fix:** wrap create/materialize/spawn in `try/except BaseException` with `store.release_slot()` and `shutil.rmtree(...)`.

**H35 — Bad `.ass` path escaping.** `backend/app/services/captions_processor.py:229-231`. Line 230 inserts `\:`; line 231 re-escapes it into `C\\\:/...`. **Fix:** escape only backslash and apostrophe inside single-quoted filter values; drop colon escaping, including `fontsdir` at `:234`.

---

### Storage, packaging, frontend

**H36 — Multipart endpoints stream unbounded data.** `backend/app/routers/packaging.py:116-119`, `backend/app/routers/captions.py:149-153`, `backend/app/routers/storage.py:312-314`. **Fix:** async capped-copy helper with 413 over `MAX_UPLOAD_BYTES`; cap fonts at 5 MB.

**H37 — `/audio/analyze` and `/audio/bpm` delete the user’s source file.** `backend/app/routers/storage.py:226-238,248-262`. A key like `references/analyze_voice.mp3` is deleted by the `finally` block. **Fix:** delete only if `Path(path).resolve() == expected_temp_dest.resolve()`.

**H38 — MIME/extension validation bypass.** `backend/app/services/upload_validation.py:43-66`. Lines 62-65 accept any sniffed audio type when the client-supplied `Content-Type` looks audio-ish. **Fix:** require `ext == sniff` with only the explicit m4a/mp4/aac overlap; remove the content-type fallback and dead `allowed` at `:49`.

**H39 — Presigned uploads have no effective size limit.** `frontend/src/app/api/upload-url/route.ts:29-33,44,63`; `frontend/src/lib/r2.ts:25-38`; caller `frontend/src/app/speech-and-background/page.tsx:627-629` omits size. **Fix:** require `contentLength` in `(0, 25MB]`, make it required in `createPresignedUploadUrl()`, and pass `track.blob.size`.

**H40 — Local upload is published before validation/scan.** `backend/app/routers/storage.py:98-105`. `tmp.replace(dest)` runs before validation. **Fix:** validate/scan the temp file, then atomically `replace()`.

**H41 — Audio-analysis calls omit auth headers.** `frontend/src/lib/api.ts:917-928` (`detectBpm`), `:930-941` (`analyzeAudio`); backend dependency `backend/app/routers/storage.py:37,245-253`. “Fit to beats” and voice-sample quality analysis always 401 with `API_KEY` configured. **Fix:**

```ts
headers: { "Content-Type": "application/json", ...backendAuthHeaders() },
```

**H42 — Any `/me` failure deletes a valid session.** `frontend/src/components/AuthProvider.tsx:41-49`; `frontend/src/lib/api.ts:72-80`. Network errors, timeouts, and 5xx clear a still-valid 7-day token. **Fix:** attach `status` to the error in `me()` and clear only on 401/403.

**H43 — Uploaded brand fonts are silently discarded.** `frontend/src/lib/textStyles.ts:207`; `frontend/src/components/TextStylePicker.tsx:72,175-186`. `resolveTextStyle()` accepts only `FONT_OPTIONS`, so the font reverts immediately and presets strip it. **Fix:** add `extraFonts: readonly string[] = []` to `resolveTextStyle()`/`withStyleChanges()` and pass `loadBrandFont()?.font_name` when reading persisted styles.

**H44 — Segment playback always starts at 0.** `frontend/src/components/SpeechTimelineSidebar.tsx:98-121` (specifically `:106-107`). `currentTime` is set before `loadedmetadata`, so the seek is ignored. **Fix:** wait for `loadedmetadata` or reuse an already loaded `src` before seeking and calling `play()`.

**H45 — Corrupted localStorage entries crash history operations.** `frontend/src/lib/history.ts:42-51`, used at `:69,88,100,132,138`. One `null` element makes add/remove throw. **Fix:** filter with shape guards in `readList()`.

**H46 — Failed/aborted synthesis is recorded as `status:"ok"`.** `frontend/src/lib/api.ts:225-249`. **Fix:**

```ts
} catch (e) {
  reportMetric("speech.generate", performance.now() - started, {
    engine: payload.engine || "default",
    language: payload.language || "en",
    status: e?.name === "AbortError" ? "cancelled" : "error",
  });
  throw e;
}
```

**H47 — `waitForVideoJob` cannot be interrupted and does not enforce its own timeout.** `frontend/src/lib/api.ts:754-799`. The signal is checked only at loop top; `getVideoJob()` gets no signal and the sleep is not abortable. **Fix:** internal `AbortController`, pass its signal to `getVideoJob()`, abort on external abort and on a deadline timer.

**H48 — Open redirect through login `next`.** `frontend/src/app/login/page.tsx:12,19,28`. **Fix:**

```ts
const rawNext = sp.get("next") || "/";
const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
```

**H49 — Batch cache key omits `transitionDuration`.** `frontend/src/app/trimming-and-zooming/page.tsx:517` vs `:541-563`. Changing 0.3s → 1.5s hits the old cache and renders stale transitions. **Fix:** add `transitionDuration`, `transition: defaultTransition`, and every other result-affecting field to `signature`.

**H50 — Publish drops `frame`/`shape` shown in thumbnail preview.** `frontend/src/app/publish-package/page.tsx:390` passes them; `:424-452` omits them. **Fix:** add `frame, shape,` to the `publishPackage({...})` payload at `:424`, and use `border: frame !== "none"` to match preview.

**H51 — Hook input cannot be typed as multiple words.** `frontend/src/app/publish-package/page.tsx:750`. `onChange` trims and rejoins after every keystroke. Typing `AFRICA'S`, then a space, then `H` produces `AFRICA'SH` because the trailing space is removed immediately. Manual 3-word hook entry is effectively broken. **Fix:**

```tsx
<input
  value={hookWords}
  onChange={(e) => setHookWords(e.target.value)}
  onBlur={() =>
    setHookWords((v) => v.trim().split(/\s+/).slice(0, 3).join(" "))
  }
  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold uppercase"
  placeholder="AFRICA'S HIGHEST PEAK"
/>
```

Keep the existing `hookWords.trim().split(/\s+/).length > 3` guard in `publish()` at `:418`.

**H52 — Loaded presets are overwritten by mount/default effects.** `frontend/src/app/publish-package/page.tsx:142-182` vs `:186-228` and `:248-264`; `frontend/src/app/trimming-and-zooming/page.tsx:179-217` vs `:221-233`. React runs effects in declaration order. In Publish, preset values for `topic`, `language`, `clipLength`, `starts`, `textStyle`, and `lowerThird` are set first, then immediately overwritten by video-history, speech-language, `projectTopic`, typography, and lower-third restore effects. In Trimming, preset `language` is overwritten by the audio-history effect at `:231`. Loading a preset appears to do nothing for those settings. **Fix:**

```tsx
const presetApplied = useRef<string | null>(null);

useEffect(() => {
  if (!presetId || presetApplied.current === presetId) return;
  if (!styleReady || !lowerReady) return; // omit this gate in Trimming

  const item = getDeliverableById(presetId);
  const s = item?.meta?.settings as Record<string, any> | undefined;
  if (!s) return;

  presetApplied.current = presetId;

  // existing preset setters unchanged
}, [presetId, styleReady, lowerReady]);
```

Place the Publish block after the restore effects ending at `:264` and before the save effects at `:268`; place the Trimming block after `:233`.

---

## Medium

### Backend

- **M1 — `backend/app/auth.py:22-36`** — `API_KEY` is import-time but `API_KEYS` is read per request. Read both once at import.
- **M2 — `backend/app/config.py:28-43`** — `_env_int` call sites needing ceilings omit `max_value`. Pass explicit maxima.
- **M3 — `backend/app/rate_limit.py:93-102`** — Redis `INCR` succeeds then an exception falls back to local memory, double-counting. Fail closed with 503 when Redis was selected.
- **M4 — `backend/app/rate_limit.py:84-87`** — `_hits` can grow unbounded under attack. Use an LRU cap.
- **M5 — `backend/app/services/user_store.py:240-257`** — concurrent reset requests both SELECT the same unused token. Use conditional `UPDATE ... WHERE used_at=0` + `rowcount`.
- **M6 — `backend/app/services/user_store.py:328`** — `hmac.compare_digest(str, str)` raises `TypeError` for non-ASCII passwords. Use `current_password == new_password`.
- **M7 — `backend/app/services/user_store.py:28-31`** — no WAL/busy timeout; concurrent writes 500. Use `timeout=30`, `PRAGMA busy_timeout=30000`, `PRAGMA journal_mode=WAL`.
- **M8 — `backend/app/services/user_store.py:178-185,199`** — `exp < now` accepts a token during its expiry second and `iat` is unchecked. Use `exp <= now` and reject `iat > now + 60`.
- **M9 — `backend/app/services/user_store.py:260-265`** — `count_users()` runs `init_db()` on every public request; initialize once in lifespan.
- **M10 — `backend/app/services/mailer.py:29`** — port 465 uses `SMTP` + `starttls()` instead of implicit TLS. Use `SMTP_SSL` for 465.
- **M11 — `backend/app/routers/auth.py:143-153`** — reset returns success even when no email can be delivered. Return 503 when `not EXPOSE_RESET_TOKENS and not smtp_configured()`; log delivery failures server-side.
- **M12 — `backend/app/routers/auth.py:101-110`** — lockout returns 429 while wrong password returns 401, creating an account-state oracle. Use the same 401 body.
- **M13 — `backend/app/routers/auth.py:55-58`** — avatar request accepts ~1.4 MB before validation. Lower `max_length` to ≈400,100.
- **M14 — `backend/app/main.py:146-168` vs `:171-182`** — health computes discarded data. Move computation inside the `EXPOSE_HEALTH_DETAILS` branch.
- **M15 — `backend/app/observability.py:30-31`** — newline in a metric field forges log lines. Escape `\`, `\n`, `\r`.
- **M16 — `backend/app/services/video_transitions.py:250-251`** — `max(0.05, ...)` exceeds clip duration for 0.05s clips. Raise `ValueError` when `max_overlap < 0.05`.
- **M17 — `backend/app/services/video_transitions.py:46-50,90`** — `liquiddrops` leaves corners uncovered at P=1. Scale radii past frame edges.
- **M18 — `backend/app/services/sfx_generator.py:17` vs `backend/app/services/audio_processor.py:625`** — incompatible SFX vocabularies. Alias the sets (`lift`↔`chime`/`applause`).
- **M19 — `backend/app/routers/video.py:286-300,602-616`; `backend/app/services/captions_processor.py:71-84`** — captions can extend past audio. Clamp intro and skip when remaining duration ≤0.25s.
- **M20 — `backend/app/services/sfx_generator.py:108-128`** — SFX bed generation is uninterruptible. Call `check_cancelled()` every ~1M samples.
- **M21 — `backend/app/routers/video_jobs.py:55-61`** — job ownership hashes the raw auth header; Bearer vs X-API-Key differ and all API-key users share one owner. Hash the verified token subject.
- **M22 — `backend/app/services/video_jobs.py:50-58`** — concurrency limit is global, not per owner. Use per-owner semaphores or a real queue.
- **M23 — `backend/app/services/job_context.py:24-27,53-66`** — stage metrics `kind` is always None. Add `kind` to `JobContext`.
- **M24 — `backend/app/services/audio_processor.py:554-567`** — mixed 1-D/2-D concatenation crashes. Normalize every chunk to mono s16 first.
- **M25 — `backend/app/services/audio_processor.py:592-621`** — crossfade mixes channel layouts. Add `aformat=channel_layouts=stereo` to both resample filters.
- **M26 — `backend/app/routers/timeline.py:60-63`; `backend/app/services/timeline_service.py:105-113`** — forced alignment ignores character-level responses. Read `.text`/`.word` and fall back to the ElevenLabs timestamp extractor.
- **M27 — `backend/app/routers/timeline.py:92-95`** — internal errors returned as 400 with exception text. Return 500 generic; map missing keys to 404.
- **M28 — `backend/app/routers/packaging.py:244-261`** — short masters produce three identical Shorts at start 0. Distribute `0, d/3, 2d/3` and fail early when duration is 0.
- **M29 — `backend/app/routers/packaging.py:34-41`** — CSV start times accept `NaN`/`Infinity`. Filter with `math.isfinite(p) and p >= 0`.
- **M30 — `backend/app/routers/captions.py:118,177,217`** — `lower_third_duration_sec` clamped only in the response. Clamp before ASS generation too.
- **M31 — `backend/app/routers/packaging.py:133,152,199,235,271`; `backend/app/routers/captions.py:119,178,187`** — arbitrary server-side `font_path` accepted. Require resolved path under `TEMP_AUDIO_DIR / "brand_fonts"`.
- **M32 — `backend/app/services/r2_storage.py:121-125`** — stale local file shadows R2 object. Prefer local only when `not _r2_configured()`.
- **M33 — `backend/app/services/r2_storage.py:30-38`** — new boto3 client per operation. Cache the client with timeouts and a connection pool.
- **M34 — `frontend/src/app/api/upload-url/route.ts:53`** — `Date.now()` + name collides under concurrent uploads. Use `crypto.randomUUID()`.
- **M35 — `frontend/src/app/api/upload-url/route.ts:48-53`** — unbounded filename length. Slice sanitized name to 120 chars.
- **M36 — `backend/app/services/packaging_processor.py:115-118,132-137,428,440-446,516`** — ffmpeg/ffprobe calls have no timeout. Add `timeout=600`.
- **M37 — `backend/app/routers/packaging.py:276-297`** — five sequential uploads with no rollback. Track keys and delete on failure.
- **M38 — `backend/app/routers/storage.py:315-324`** — brand fonts never cleaned up and are publicly served. Add TTL/janitor or a 64-file cap.
- **M39 — `backend/app/services/upload_validation.py:69-85`; `backend/app/routers/storage.py:100-102`** — scanner receives only a hash and the full file is read into memory. Stream the payload and hash during upload.
- **M40 — `backend/app/services/r2_storage.py:98-99`** — `public_url()` does not URL-encode keys. Use `quote(key, safe="/")`.
- **M41 — `backend/app/config.py:115`** — `PUBLIC_BASE_URL` defaults to localhost. Fail fast when local fallback is used with that value.
- **M42 — `backend/app/services/naming_utils.py:23-28`** — sanitization strips non-ASCII and lowercases acronyms. Use Unicode-aware `re.sub(r"[^\w\s]", "", topic, flags=re.UNICODE)` and preserve capitalization.
- **M43 — `backend/app/services/naming_utils.py:6`; `backend/requirements.txt`** — `tzdata` is used but undeclared. Add `tzdata>=2024.1` or use a fixed-offset timezone.
- **M44 — `backend/app/routers/storage.py:140-142` vs `packaging.py`/`captions.py`/`timeline.py`** — missing keys map to 404 in one router and 500/400 elsewhere. Share `except RuntimeError → 404`.
- **M45 — `.github/workflows/release.yml:18-21`** — re-running a tag release fails. Use `gh release create ... || gh release view "$GITHUB_REF_NAME"`.
- **M46 — `scripts/dev-watch.ps1:20,26,55-75,102-107,123`** — suppresses start errors and never removes its lock on failure. Use `$ErrorActionPreference = "Stop"`, check `Start-Process`, and remove the lock in `finally`.
- **M63 — `backend/app/auth.py:44-61`** — non-ASCII API key/Bearer header returns 500 because `hmac.compare_digest(str, str)` rejects non-ASCII. Compare UTF-8 bytes:

```python
def _eq(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))
```

- **M64 — `backend/Dockerfile:24,44`; `backend/.dockerignore:1-27`** — `.env` is correctly ignored, but `data/` and `*.db` are not; the local `backend/data/app.db` can be baked into the image. Add `data/`, `*.db`, `*.db-shm`, `*.db-wal` to `.dockerignore`.
- **M68 — `backend/app/main.py:171-193`; `backend/Dockerfile:51-52`; `backend/railway.toml:7`** — degraded `/health` still returns 200, so container/Railway healthchecks never restart a degraded instance. Keep 200 for liveness if desired, but add `/ready` and point healthchecks at it.

### Frontend

- **M47 — `frontend/src/lib/api.ts:9-33`; `frontend/src/components/AuthProvider.tsx:34-54`** — no token-expiry handling; UI stays logged in after expiry. Decode `exp` in `getUserToken()` and centralize 401 handling.
- **M48 — `frontend/src/components/AuthProvider.tsx:74-81`** — `logoutAll` clears the local token even when the server call fails. Clear only on success or 401; rethrow otherwise.
- **M49 — `frontend/src/components/AuthProvider.tsx:56-94`** — `useMemo` omits `refresh`. Wrap `refresh` in `useCallback` and include it.
- **M50 — `frontend/src/lib/history.ts:53-60` vs `:126-135`** — `addDeliverable()` returns 40 but persists 20. Use one cap everywhere.
- **M51 — `frontend/src/components/AudioPlayer.tsx:74,96`** — crashes when `audio_r2_key` is missing. Use `(result.audio_r2_key || "")` and skip export when absent.
- **M52 — `frontend/src/components/AudioPlayer.tsx:24-33,231-245`** — prepared MP3 is not invalidated when speed/volume change. Add `exportSpeed, exportVolume` to the reset effect deps.
- **M53 — `frontend/src/lib/media.ts:2-26`** — no timeout; can hang forever. Add an 8s timeout and settle via one `finish()` that revokes the URL.
- **M54 — `frontend/src/components/VoiceRecorder.tsx:145-147,234-245`** — object URL created after `await` leaks on unmount. Check `mountedRef.current` before creating; revoke immediately if unmounted.
- **M55 — `frontend/src/components/TextToSpeechForm.tsx:96-101`** — `if (loading)` guard allows two same-tick submissions. Use a synchronous `submittingRef`.
- **M56 — `frontend/src/lib/api.ts:762-768`; `frontend/src/app/trimming-and-zooming/page.tsx:399-417`** — `cancelVideoJob()` has no caller; aborting polling leaves the backend slot occupied. Call it in the abort path.
- **M57 — `frontend/src/lib/api.ts:754-760`; `backend/app/routers/video_jobs.py:55-61`** — token changed mid-render makes polling 404. Pin job headers per `job_id`; ideally fix ownership in M21.
- **M58 — `frontend/src/lib/textStyles.ts:199-206`** — `preset in TEXT_STYLE_PRESETS` walks the prototype chain; `"toString"` yields `NaN` styles. Use `Object.prototype.hasOwnProperty.call(...)`.
- **M59 — `frontend/src/lib/history.ts:38-40,120`** — history is global across accounts on shared devices. Suffix keys with the token’s `uid` and migrate legacy keys.
- **M60 — `frontend/src/components/RequireAuth.tsx:25-36`; `frontend/src/app/signup/page.tsx:17-19,31`** — login/signup lose query state and signup has no `next` path. Include `useSearchParams().toString()` and pass a validated `next` to both routes.
- **M61 — `frontend/src/lib/api.ts:275-285`** — `warmEngine()` ignores non-2xx responses. Throw on `!res.ok` or stop reporting success.
- **M62 — `frontend/src/components/SpeechTimelineSidebar.tsx:195-205`** — blob URL revoked synchronously after `click()`. Defer with `setTimeout(() => URL.revokeObjectURL(url), 0)`.
- **M65 — `frontend/src/components/TextToSpeechForm.tsx:96-99,261-267`** — Ctrl+Enter bypasses the 2,000-character limit. Add `|| text.length > MAX_CHARS` to the guard at `:98`.
- **M66 — `frontend/src/components/SpeechTimelineSidebar.tsx:27-35,157-187,209,321-322`** — split/merge renumbers IDs and reassigns user prompts to the wrong segments. Preserve existing IDs and allocate new ones with `Math.max(...ids) + 1`.
- **M67 — `frontend/src/components/SpeechTimelineSidebar.tsx:16-18,172-187`** — splitting a <0.1s segment produces inverted start/end. Use `const pad = Math.min(0.05, (seg.end - seg.start) / 4)`.
- **M69 — `frontend/src/__tests__/auth.smoke.test.tsx:1-23`; `frontend/vitest.config.ts:5-16`** — one smoke test, global `fetch` stub never restored. Add focused suites for auth/401, history corruption, API FormData construction, job polling, text styles; restore mocks with `afterEach(() => vi.restoreAllMocks())`.
- **M70 — `frontend/src/app/animated-captions/page.tsx:168,444-450,562-564,1120-1132`** — in `fresh` mode with `audioMode === "upload"`, `knownDuration` never includes `audioFile`. Uploaded duration is read at `:1128-1130` only when `autoVoiceDuration` is off. With auto mode on, `effectiveVoiceDuration` is `0`, so `doPreview()` exits with “Select a video/audio with a known duration”. **Fix:**

```tsx
const [audioFileDuration, setAudioFileDuration] = useState(0);
```

```tsx
setAudioFile(f);
setPreview(null);
setAudioFileDuration(0);
if (f) {
  try {
    const d = await getMediaDuration(f, "audio");
    setAudioFileDuration(d);
    if (!autoVoiceDuration) setVoiceDuration(Math.max(1, d - introDelay - outroSec));
  } catch {
    setAudioFileDuration(0);
  }
}
```

```tsx
const knownDuration =
  sourceMode === "device" ? deviceDuration
  : sourceMode === "history" ? (selectedVideo?.duration_seconds || 0)
  : audioMode === "upload" ? audioFileDuration
  : (selectedAudio?.duration_seconds || 0);
```

- **M71 — `frontend/src/app/publish-package/page.tsx:296,986`; backend clamps silently at `backend/app/routers/packaging.py:241-255`** — the number input has `min={0}` but no `max`. Entering `999` for a 60-second master shows an impossible timeline; the backend clamps it, so rendered Shorts do not match the UI. **Fix:**

```tsx
<input
  type="number"
  min={0}
  max={knownDuration > 0 ? Math.max(0, knownDuration - clipLength) : undefined}
  value={starts[i]}
  onChange={(e) => {
    const raw = parseFloat(e.target.value);
    const maxStart =
      knownDuration > 0
        ? Math.max(0, knownDuration - clipLength)
        : Number.MAX_SAFE_INTEGER;
    const value = Number.isFinite(raw)
      ? Math.min(Math.max(raw, 0), maxStart)
      : 0;
    setStarts((s) => s.map((x, j) => (j === i ? value : x)));
  }}
  className="w-20 rounded border border-gray-200 px-2 py-1 text-right font-mono"
/>
```

- **M72 — `frontend/src/app/animated-captions/page.tsx:150,258,354-362`; `frontend/src/app/publish-package/page.tsx:138,144-152`; `frontend/src/app/speech-and-background/page.tsx:291,297`; `frontend/src/app/trimming-and-zooming/page.tsx:175,181`** — boolean `presetApplied` refs apply only the first `?preset=` seen. The captions page additionally reads `window.location.search` directly at `:258` instead of the `searchParams` already available at `:146`. If query params change without a remount, the new preset or handoff video is ignored. **Fix:**

```tsx
const appliedPresetId = useRef<string | null>(null);

useEffect(() => {
  if (!presetId || appliedPresetId.current === presetId) return;
  const item = getDeliverableById(presetId);
  const s = item?.meta?.settings as Record<string, any> | undefined;
  if (!s) return;
  appliedPresetId.current = presetId;
  // existing setters
}, [presetId]);
```

For the captions handoff:

```tsx
const handoffUrl = searchParams.get("video_url");

useEffect(() => {
  if (!handoffUrl) return;
  const v = loadVideoHistory().find((item) => item.video_url === handoffUrl);
  if (!v) return;
  setVideoHistory((prev) =>
    prev.some((x) => x.video_url === v.video_url) ? prev : [v, ...prev]
  );
  setSelectedVideoUrl(v.video_url);
  setSourceMode("history");
}, [handoffUrl]);
```

- **M73 — `frontend/src/app/trimming-and-zooming/page.tsx:205`** — `OverlayPicker` offers `center`, and `savePreset()` persists it at `:375`, but the restore condition accepts only four corners. A saved center-position preset silently falls back to the current/default position. **Fix:**

```ts
if (
  s.overlay_position === "top-left" ||
  s.overlay_position === "top-right" ||
  s.overlay_position === "bottom-left" ||
  s.overlay_position === "bottom-right" ||
  s.overlay_position === "center"
) {
  setOverlayPosition(s.overlay_position);
}
```

- **M74 — `frontend/src/app/trimming-and-zooming/page.tsx:199`; backend validation `backend/app/services/sfx_generator.py:17-29`** — preset restoration casts any string to `SfxId`. A stored `chime` or `applause` value is accepted by the UI, sent at `:369`/`:619`, then rejected by video endpoints with `400 transition_sfx must be one of click, lift, off, pop, whoosh`. This is the frontend half of **M18**. **Fix:**

```ts
import {
  DEFAULT_SFX,
  DEFAULT_SFX_LEVEL,
  SFX_OPTIONS,
  type SfxId,
} from "@/lib/transitionSfx";

if (
  typeof s.transition_sfx === "string" &&
  SFX_OPTIONS.some((o) => o.id === s.transition_sfx)
) {
  setTransitionSfx(s.transition_sfx as SfxId);
}
```

---

## Re-confirmed duplicates

The final frontend page audit independently re-confirmed findings already listed above:

- Open redirect via `?next=` — **H48**
- Missing auth on BPM/analyze calls — **H41**
- Publish dropping `frame`/`shape` — **H50**
- `RequireAuth` dropping query strings — **M60**
- Incompatible SFX vocabularies — **M18** / **M74**

---

## Explicitly rejected / excluded

- **“`.env` with live secrets is baked into the Docker image” — false.** `backend/.dockerignore:14-16` excludes `.env` and `.env.*`, and `backend/.env` is gitignored and untracked. **M64** covers the separate `app.db` issue.
- **“Presigned upload keys are random” — false.** They are `Date.now()`-based; that is **M34**, not a strength.
- **`/health` returning 200 with `status:"degraded"`** is liveness semantics, but **M68** covers the separate readiness/healthcheck misconfiguration.
- **Lint-only items** (unused imports, f-strings without placeholders, unreachable fallback returns, unused helpers like `fmtSeconds`) were excluded unless tied to behavior. The behavioral exceptions are **H1** (`REQUIRE_AUTH`) and **H38** (`allowed` in `upload_validation.py`).

---

## Highest-leverage fix order

1. **C1**, **C2**, **C3** — rate-limit trust, auth secret, and database persistence.
2. **C4**, **C5**, **C6**, **H39** — close anonymous/presigned upload holes and make recording actually work.
3. **C7**, **H14**, **H17** — RAM guard and worker-only synthesis to stop OOM and uncancellable renders.
4. **H24**, **H25**, **H13** — restore cancellation semantics and make CI tests meaningful.
5. **C8**, **H41**, **H42**, **H43**, **H51**, **H52** — restore default UI visibility, auth headers, session handling, brand fonts, hook entry, and preset loading.

---

## Remediation status (2026-11-26)

All findings **C1–C8**, **H1–H52**, and **M1–M74** have code/config fixes in this changeset. One deployment step cannot be expressed in source control: **C3** requires a Railway persistent volume and service variables to be created/attached in the Railway dashboard or CLI. `backend/railway.toml` now declares `deploy.requiredMountPath = "/app/data"` so a missing mount fails the deployment explicitly, and documents the required `APP_DB_PATH=/app/data/app.db` and `RAILWAY_RUN_UID=0` variables. No matching Yakodonyo Railway project was linked in this environment, so no remote infrastructure was changed.

Verification performed after all fixes:

- Backend `python -m compileall -q app tests` — clean.
- Backend `python -m pytest -q` — **63 passed**.
- Backend import gate with all heavy ML modules blocked — **OK** (lazy imports preserved).
- Frontend `npm run lint -- --no-cache` — only the two pre-existing `<img>` warnings in `publish-package/page.tsx`.
- Frontend `npm test -- --reporter=dot` — **21 passed**.
- Frontend `npm run build` — passed; home route `3.28 kB / 109 kB First Load JS`.
- Live dev servers: backend `/health` and `/ready` → 200, frontend `/` → 200.

No push was performed.
