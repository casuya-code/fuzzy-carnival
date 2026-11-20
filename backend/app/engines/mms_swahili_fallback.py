import os
import torch
from pathlib import Path
from app.config import WEIGHTS_DIR, HF_TOKEN
from app.engines.base import BaseTTSEngine

MODEL_ID = "facebook/mms-tts-swh"


class MmsSwahiliFallbackEngine(BaseTTSEngine):
    name = "mms"
    ram_gb = 0.5

    def __init__(self):
        super().__init__()
        self.weights_dir = WEIGHTS_DIR / "mms"
        self.weights_dir.mkdir(parents=True, exist_ok=True)

    def load(self) -> None:
        if self.is_loaded:
            return
        try:
            from transformers import VitsModel, AutoTokenizer
        except ImportError as e:
            raise RuntimeError(f"transformers not installed: {e}")

        if HF_TOKEN:
            os.environ.setdefault("HF_TOKEN", HF_TOKEN)

        self.tokenizer = AutoTokenizer.from_pretrained(
            MODEL_ID, cache_dir=str(self.weights_dir), token=HF_TOKEN or None
        )
        self.model = VitsModel.from_pretrained(
            MODEL_ID, cache_dir=str(self.weights_dir), token=HF_TOKEN or None
        )
        if torch.cuda.is_available():
            self.model = self.model.to("cuda")
        self.model.eval()
        self._loaded = True

    def unload(self) -> None:
        self.model = None
        self.tokenizer = None
        self._loaded = False
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def synthesize(
        self,
        text: str,
        reference_audio_path=None,
        output_path=None,
    ) -> str:
        self.ensure_loaded()
        import numpy as np
        from scipy.io import wavfile

        if output_path is None:
            output_path = str(Path(__file__).resolve().parents[3] / "temp_audio" / "mms_out.wav")

        inputs = self.tokenizer(text, return_tensors="pt")
        if torch.cuda.is_available():
            inputs = {k: v.to("cuda") for k, v in inputs.items()}

        with torch.no_grad():
            output = self.model(**inputs).waveform

        w = output.detach().cpu().numpy()
        if w.ndim > 1:
            w = np.squeeze(w)
        if w.dtype not in (np.float32, np.float64, np.int16, np.int32):
            w = w.astype(np.float32)
        wavfile.write(output_path, self.model.config.sampling_rate, w)
        return output_path