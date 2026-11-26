# TTS engine reference

The backend exposes all engines through a common `BaseTTSEngine` interface. The
frontend lets you pick per request; `backend/app/services/model_manager.py`
loads and unloads local models to stay within the Railway RAM budget.

| Engine option | Best use case | Cost / quota (typical) | RAM on Railway | Cloning | Notes |
|---|---|---|---|---|---|
| **Azure AI Speech** (`azure`, sw-TZ Daudi/Rehema) | Default Swahili storytelling, documentaries, narration | F0: 500k chars/mo free (plan-dependent) | 0 MB (cloud REST) | No (preset neural voices) | Auto-falls back to MMS on HTTP 429 quota/rate limit; commercial rights per Azure terms |
| **Kyutai Pocket TTS** (`kyutai`) | Unlimited English custom voice cloning from short sample | Included in your container | ~1.0 GB (CPU) | Zero-shot | Local/open weights |
| **AfriSpeech Pocket** (`afrispeech`) | African-accented English cloning from short sample | Included in your container | ~1.0 GB (CPU) | Zero-shot | Community PocketTTS checkpoint via `AFRISPEECH_CONFIG`, otherwise the base Kyutai model |
| **ElevenLabs** (`elevenlabs`) | Dramatic character voices and short hooks (EN/SW accents) | Free tier limited (plan-dependent); paid unlocks more | 0 MB (cloud SDK/API) | Preset voice, or IVC when `ELEVENLABS_ENABLE_CLONING=true` and the plan allows it | Uses `eleven_flash_v2_5` by default to stretch quota |
| **Msingi-AI Sauti / XTTS-v2** (`msingi`) | Self-hosted Swahili voice cloning when cloud is unavailable/quota is used | Included in your container | ~3.5 GB (loaded on demand) | Zero-shot | Base XTTS has no `sw` token, so Swahili uses a safe tokenizer fallback with a UI warning. Point `MSINGI_CHECKPOINT_PATH` at a Swahili-aware checkpoint for native `sw` |
| **Meta MMS-TTS** (`mms`) | Offline/low-cost Swahili fallback | Included in your container | ~0.5 GB | No | Sentence/chunked delivery with punctuation-aware breaths and adjustable pace; checkpoint via `MMS_MODEL_ID` |

## Routing and safety rules

- Text is normalized before synthesis: Swahili uses `kiswahili-text-normalizer`
  when available, then custom loanwords from
  `backend/app/data/swahili_loanwords.json` (or `SWAHILI_LOANWORDS_PATH`), then
  number/punctuation normalization. Raw text is used for captions.
- If `azure` returns HTTP 429, the backend falls back to `mms` for that request
  and returns a UI warning.
- `msingi` auto-detects the loaded checkpoint's languages. Stock XTTS-v2 does
  not include Swahili (`sw`), so it uses a supported tokenizer token (normally
  `en`) while still cloning the sample. `MSINGI_LANGUAGE=auto` is the default.
- `COQUI_TOS_AGREED=1` is set automatically for unattended/server use; make sure
  your Coqui/XTTS/CPML usage complies with the applicable license terms.
- Cloud engines run over HTTPS and do not load PyTorch/XTTS weights into RAM.

## Swahili delivery (pauses, breaths, pace)

Meta MMS-TTS is a single-pass VITS vocoder: it reads straight through a
paragraph with no natural breaths. The backend compensates by splitting long
text at sentence/clause boundaries, synthesizing each segment, then stitching
silence that follows the punctuation:

- `.` → 480 ms, `!` → 500 ms, `?` → 560 ms (a real breath)
- `,` → 180 ms, `;` → 240 ms, `:` → 260 ms (a short catch)
- Long segments also break at commas so a 60-word sentence never becomes a sprint

`speaking_rate` (request field and "Speaking pace" slider, 0.7–1.4) is applied by
**Azure Swahili** (SSML prosody rate) and **Basic Swahili / MMS** (VITS
`speaking_rate`). Other engines keep their natural pace and the API returns a
warning when a non-neutral pace is requested.

Swahili text without a trailing `.` is force-terminated, and `;` / `:` are
rewritten so passages don't run on.

## Swapping the MMS checkpoint

Set `MMS_MODEL_ID` to any VITS/MMS repo with its own tokenizer. Benchmarked on a
four-sentence Swahili passage:

| `MMS_MODEL_ID` | Voiced | Peak | License |
|---|---|---|---|
| `facebook/mms-tts-swh` (default) | 68% | 0.73 | CC-BY-NC |
| `stano03/jambogpt-swahili-tts-v1` | 74% | 0.80 | Apache-2.0 |
| `mussacharles60/swahili-tts-female-voice` | 77% | 0.82 | MIT |

Weights are cached per model under `backend/weights/mms/<model>/`, so switching
never mixes checkpoints.
