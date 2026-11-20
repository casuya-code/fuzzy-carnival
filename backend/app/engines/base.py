from abc import ABC, abstractmethod
from typing import Optional


class BaseTTSEngine(ABC):
    """Shared abstract base for all TTS engines."""

    name: str = "base"
    ram_gb: float = 1.0

    def __init__(self):
        self._loaded = False
        self.model = None

    @property
    def is_loaded(self) -> bool:
        return self._loaded and self.model is not None

    @abstractmethod
    def load(self) -> None:
        """Load model weights into memory."""
        ...

    @abstractmethod
    def unload(self) -> None:
        """Release model weights from memory."""
        ...

    @abstractmethod
    def synthesize(
        self,
        text: str,
        reference_audio_path: Optional[str] = None,
        output_path: Optional[str] = None,
    ) -> str:
        """Synthesize speech and return path to output audio file."""
        ...

    def ensure_loaded(self) -> None:
        if not self.is_loaded:
            self.load()