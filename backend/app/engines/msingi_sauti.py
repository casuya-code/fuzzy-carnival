import os
from pathlib import Path
from app.config import WEIGHTS_DIR, HF_TOKEN
from app.engines.base import BaseTTSEngine

# Msingi-AI Sauti: East African Swahili fine-tune of XTTS-v2
MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"


class MsingiSautiEngine(BaseTTSEngine):
    name = "msingi"
    ram_gb = 3.5

    def __init__(self):
        super().__init__()
        self.weights_dir = WEIGHTS_DIR / "msingi-sauti"
        self.weights_dir.mkdir(parents=True, exist_ok=True)
        self.custom_checkpoint = os.getenv("MSINGI_CHECKPOINT_PATH", "")

    def load(self) -> None:
        if self.is_loaded:
            return
        try:
            from TTS.api import TTS
        except ImportError as e:
            raise RuntimeError(f"coqui TTS not installed: {e}")

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

    def synthesize(
        self,
        text: str,
        reference_audio_path=None,
        output_path=None,
    ) -> str:
        self.ensure_loaded()
        if output_path is None:
            output_path = str(Path(__file__).resolve().parents[3] / "temp_audio" / "msingi_out.wav")

        if reference_audio_path:
            self.model.tts_to_file(
                text=text,
                speaker_wav=reference_audio_path,
                language="sw",
                file_path=output_path,
            )
        else:
            # Fall back to a default speaker if no reference provided
            self.model.tts_to_file(
                text=text,
                language="sw",
                file_path=output_path,
            )
        return output_path