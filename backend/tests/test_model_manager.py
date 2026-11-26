"""RAM-aware model eviction keeps frequently used engines warm."""

import app.services.model_manager as mm


class FakeEngine:
    def __init__(self, name: str, ram_gb: float):
        self.name = name
        self.ram_gb = ram_gb
        self.load_count = 0
        self.unload_count = 0

    @property
    def is_loaded(self):
        return self.load_count > self.unload_count

    def ensure_loaded(self):
        self.load_count += 1

    def unload(self):
        self.unload_count += 1


def _manager(monkeypatch, ram_gb: float):
    manager = mm.ModelManager()
    manager.engines = {
        "kyutai": FakeEngine("kyutai", 1.0),
        "mms": FakeEngine("mms", 0.5),
        "msingi": FakeEngine("msingi", 3.5),
        "azure": FakeEngine("azure", 0.0),
    }
    manager._disabled = set()
    manager._loaded = set()
    manager._last_used = {}
    monkeypatch.setattr(mm, "MAX_RAM_GB", ram_gb)
    return manager


def test_heavy_engine_does_not_evict_when_budget_allows(monkeypatch):
    manager = _manager(monkeypatch, 7.0)
    manager.get("kyutai")
    manager.get("mms")
    manager.get("msingi")
    assert manager.loaded_models() == ["kyutai", "mms", "msingi"]


def test_lru_eviction_only_when_budget_is_exceeded(monkeypatch):
    manager = _manager(monkeypatch, 3.0)
    manager.get("kyutai")
    manager.get("mms")
    # kyutai + msingi = 4.5 > 3.0; oldest local engine (kyutai) goes first.
    manager.get("msingi")
    assert "msingi" in manager._loaded
    assert "kyutai" not in manager._loaded
    assert manager.engines["kyutai"].unload_count == 1


def test_cloud_engine_never_evicts_local_models(monkeypatch):
    manager = _manager(monkeypatch, 0.1)
    manager.get("kyutai")
    manager.get("azure")
    assert "kyutai" in manager._loaded
    assert "azure" in manager._loaded
