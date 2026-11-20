import os
from pathlib import Path

from app.config import WEIGHTS_DIR, HF_TOKEN
from app.engines.base import BaseTTSEngine

# Coqui XTTS prompts for license acceptance on first use. In a server process
# that prompt blocks on stdin and surfaces as "EOF when reading a line".
os.environ.setdefault("COQUI_TOS_AGREED", "1")

# Msingi-AI Sauti: East African Swahili fine-tune of XTTS-v2
MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"


def _patch_xtts_audio_loader() -> None:
    """Use soundfile for XTTS reference audio instead of TorchCodec.

    Recent torchaudio releases route ``torchaudio.load`` through TorchCodec,
    which needs full-shared FFmpeg DLLs that are not present in many Python
    installs. Coqui's XTTS loader only needs a mono float tensor, so soundfile
    is a safe, dependency-light replacement for reference-cloning audio.
    """
    try:
        import torch
        import torchaudio.functional as audio_functional
        from TTS.tts.models import xtts as xtts_module
        import soundfile as sf
    except Exception:
        return

    def _load_audio(audiopath, sampling_rate):
        data, loaded_sr = sf.read(str(audiopath), dtype="float32", always_2d=True)
        audio = torch.from_numpy(data.T.copy())
        if audio.size(0) != 1:
            audio = audio.mean(dim=0, keepdim=True)
        if loaded_sr != sampling_rate:
            audio = audio_functional.resample(audio, loaded_sr, sampling_rate)
        return audio.clip_(-1, 1)

    xtts_module.load_audio = _load_audio


class MsingiSautiEngine(BaseTTSEngine):
    name = "msingi"
    ram_gb = 3.5

    def __init__(self):
        super().__init__()
        self.weights_dir = WEIGHTS_DIR / "msingi-sauti"
        self.weights_dir.mkdir(parents=True, exist_ok=True)
        self.custom_checkpoint = os.getenv("MSINGI_CHECKPOINT_PATH", "")
        self.language_override = os.getenv("MSINGI_LANGUAGE", "auto").strip().lower()
        self.last_warning: str | None = None

    def load(self) -> None:
        if self.is_loaded:
            return
        try:
            from TTS.api import TTS
        except ImportError as e:
            raise RuntimeError(f"coqui TTS not installed: {e}")

        _patch_xtts_audio_loader()

        if self.custom_checkpoint and Path(self.custom_checkpoint).exists():
            self.model = TTS(model_path=self.custom_checkpoint, config_path=None, gpu=False)
        else:
            self.model = TTS(MODEL_NAME, gpu=False)
        self._loaded = True

    def unload(self) -> None:
        self.model = None
        self._loaded = False
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def _model_languages(self) -> set[str]:
        """Read supported language codes from whichever Coqui API is available."""
        languages = getattr(self.model, "languages", None)
        if not languages:
            synthesizer = getattr(self.model, "synthesizer", None)
            tts_model = getattr(synthesizer, "tts_model", None)
            config = getattr(tts_model, "config", None)
            languages = getattr(config, "languages", None)
        if not languages:
            return set()
        try:
            return {str(code).lower() for code in languages}
        except TypeError:
            return set()

    def _resolve_language(self) -> str:
        """Pick a language code XTTS can actually tokenize.

        Stock XTTS-v2 supports 17 languages but *not* Swahili. A real Msingi
        checkpoint may add ``sw``; if it does, use it. Otherwise fall back to
        a supported language token so voice cloning still produces audio.
        """
        if self.language_override and self.language_override != "auto":
            return self.language_override

        languages = self._model_languages()
        if "sw" in languages:
            return "sw"
        # English is present in every XTTS-v2 build and gives stable Swahili
        # orthography tokenization for the base multilingual model.
        for fallback in ("en", "es", "fr", "de", "it", "pt"):
            if fallback in languages:
                if fallback != "en":
                    self.last_warning = (
                        "Msingi is using the base XTTS model (Swahili language token unavailable); "
                        "cloned voice was still applied. Set MSINGI_CHECKPOINT_PATH to a Swahili-aware "
                        "checkpoint for native Swahili pronunciation."
                    )
                return fallback
        return "en"

    def synthesize(
        self,
        text: str,
        reference_audio_path=None,
        output_path=None,
        speaking_rate=None,
    ) -> str:
        self.ensure_loaded()
        self.last_warning = None
        if output_path is None:
            output_path = str(Path(__file__).resolve().parents[3] / "temp_audio" / "msingi_out.wav")

        language = self._resolve_language()
        if language == "en" and "sw" not in self._model_languages():
            self.last_warning = (
                "Msingi used the base XTTS model (Swahili language token unavailable); "
                "your voice sample was still cloned. Set MSINGI_CHECKPOINT_PATH to a "
                "Swahili-aware checkpoint for native Swahili pronunciation."
            )

        kwargs = dict(
            text=text,
            language=language,
            file_path=output_path,
            # Router already chunks long text; avoid Coqui's sentence segmenter
            # which has no 'sw' key in stock XTTS and raises KeyError: 'sw'.
            split_sentences=False,
        )

        if reference_audio_path:
            kwargs["speaker_wav"] = reference_audio_path
        else:
            speakers = getattr(self.model, "speakers", None) or []
            if not speakers:
                raise RuntimeError(
                    "Swahili Voice Clone needs an uploaded voice sample. "
                    "Add a short, clear Swahili recording and try again."
                )
            kwargs["speaker"] = list(speakers)[0]

        self.model.tts_to_file(**kwargs)
        return output_path
