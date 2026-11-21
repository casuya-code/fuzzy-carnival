"""Memory guard: keeps light engines warm and swaps heavy engines out.

Only one heavy engine (Msingi / XTTS) is kept loaded at a time so the
Railway $5 container stays under its RAM budget.
"""

import gc
import threading

from app.config import (
    ENABLE_AFRISPEECH,
    ENABLE_AZURE,
    ENABLE_ELEVENLABS,
    ENABLE_KYUTAI,
    ENABLE_MMS,
    ENABLE_MSINGI,
    HEAVY_ENGINE_RAM_GB,
    KYUTAI_WARM,
    MAX_RAM_GB,
    WARM_MMS,
)
from app.engines.afrispeech_pocket import AfriSpeechPocketEngine
from app.engines.azure_swahili import AzureSwahiliEngine
from app.engines.base import BaseTTSEngine
from app.engines.elevenlabs import ElevenLabsEngine
from app.engines.kyutai_pocket import KyutaiPocketEngine
from app.engines.mms_swahili_fallback import MmsSwahiliFallbackEngine
from app.engines.msingi_sauti import MsingiSautiEngine

CLOUD_ENGINES = {"azure", "elevenlabs"}


class ModelManager:
    def __init__(self):
        factories: dict[str, tuple[type[BaseTTSEngine], bool]] = {
            "kyutai": (KyutaiPocketEngine, ENABLE_KYUTAI),
            "afrispeech": (AfriSpeechPocketEngine, ENABLE_AFRISPEECH),
            "msingi": (MsingiSautiEngine, ENABLE_MSINGI),
            "mms": (MmsSwahiliFallbackEngine, ENABLE_MMS),
            "azure": (AzureSwahiliEngine, ENABLE_AZURE),
            "elevenlabs": (ElevenLabsEngine, ENABLE_ELEVENLABS),
        }
        self.engines: dict[str, BaseTTSEngine] = {
            name: factory() for name, (factory, enabled) in factories.items() if enabled
        }
        self._disabled = {name for name, (_, enabled) in factories.items() if not enabled}
        self._loaded: set[str] = set()
        self._lock = threading.RLock()
        # Unload other engines before loading one heavier than this budget slice.
        self._heavy_ram_gb = min(HEAVY_ENGINE_RAM_GB, MAX_RAM_GB)
        self._warmup_status: dict[str, str] = {}
        self._warmup_errors: dict[str, str] = {}

    def get(self, name: str) -> BaseTTSEngine:
        with self._lock:
            if name in self._disabled:
                raise ValueError(f"Engine '{name}' is disabled in this deployment")
            if name not in self.engines:
                raise ValueError(f"Unknown engine: {name}")
            engine = self.engines[name]

            # Cloud engines use 0 local RAM; never evict local models for them.
            # If requesting a heavy local model, unload other local engines to free RAM.
            if name not in CLOUD_ENGINES and engine.ram_gb >= self._heavy_ram_gb:
                for other_name in list(self._loaded):
                    if other_name != name and other_name not in CLOUD_ENGINES:
                        self._unload(other_name)

            engine.ensure_loaded()
            self._loaded.add(name)
            return engine

    def warm_async(self) -> None:
        """Warm small default engines in a background thread (non-blocking)."""

        def _warm():
            for name, enabled, should_warm in (
                ("kyutai", ENABLE_KYUTAI, KYUTAI_WARM),
                ("mms", ENABLE_MMS, WARM_MMS),
            ):
                if not enabled or not should_warm:
                    continue
                self._warmup_status[name] = "warming"
                try:
                    self.get(name)
                    self._warmup_status[name] = "ready"
                    self._warmup_errors.pop(name, None)
                except Exception as e:
                    self._warmup_status[name] = "failed"
                    self._warmup_errors[name] = str(e)

        threading.Thread(target=_warm, daemon=True).start()

    def warmup_status(self) -> dict[str, dict[str, str]]:
        with self._lock:
            out: dict[str, dict[str, str]] = {}
            for name, status in self._warmup_status.items():
                item = {"status": status}
                if name in self._warmup_errors:
                    item["error"] = self._warmup_errors[name]
                out[name] = item
            return out

    def _unload(self, name: str) -> None:
        try:
            self.engines[name].unload()
        except Exception:
            pass
        self._loaded.discard(name)
        gc.collect()
        # Best-effort CUDA cleanup only when torch is available (local GPU setups).
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def loaded_models(self) -> list[str]:
        return sorted(self._loaded)
