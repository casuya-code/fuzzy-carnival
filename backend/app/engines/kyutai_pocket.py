import os
from pathlib import Path
import numpy as np
from app.config import WEIGHTS_DIR, HF_TOKEN
from app.engines.base import BaseTTSEngine


class KyutaiPocketEngine(BaseTTSEngine):
    name = "kyutai"
    ram_gb = 1.0

    def __init__(self):
        super().__init__()
        self.weights_dir = WEIGHTS_DIR / "kyutai"
        self.weights_dir.mkdir(parents=True, exist_ok=True)
        self.sample_rate = 24000
        self._voice_cache: dict = {}  # content-hash -> voice state (slow to compute)

    def load(self) -> None:
        if self.is_loaded:
            return
        if HF_TOKEN:
            os.environ.setdefault("HF_TOKEN", HF_TOKEN)
        from pocket_tts import TTSModel

        self.model = TTSModel.load_model("english")
        self.sample_rate = getattr(self.model, "sample_rate", 24000)
        self._loaded = True

    def unload(self) -> None:
        self.model = None
        self._loaded = False

    def synthesize(
        self,
        text: str,
        reference_audio_path=None,
        output_path=None,
        speaking_rate=None,
    ) -> str:
        self.ensure_loaded()
        import scipy.io.wavfile

        if output_path is None:
            output_path = str(Path(__file__).resolve().parents[3] / "temp_audio" / "kyutai_out.wav")

        import copy
        if reference_audio_path:
            import hashlib
            with open(reference_audio_path, "rb") as f:
                content_hash = hashlib.md5(f.read()).hexdigest()
            if content_hash in self._voice_cache:
                voice_state = copy.deepcopy(self._voice_cache[content_hash])
            else:
                voice_state = self.model.get_state_for_audio_prompt(reference_audio_path)
                if len(self._voice_cache) >= 4:
                    self._voice_cache.pop(next(iter(self._voice_cache)))
                self._voice_cache[content_hash] = copy.deepcopy(voice_state)
        else:
            # Cache default voice so no-ref generations are instant
            if "__default_alba__" in self._voice_cache:
                voice_state = copy.deepcopy(self._voice_cache["__default_alba__"])
            else:
                voice_state = self.model.get_state_for_audio_prompt("alba")
                self._voice_cache["__default_alba__"] = copy.deepcopy(voice_state)

        audio = self.model.generate_audio(voice_state, text)
        arr = audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio)
        scipy.io.wavfile.write(output_path, self.sample_rate, arr)
        return output_path