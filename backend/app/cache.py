"""Thread-sicherer In-Memory-Cache mit Ablaufzeit (TTL)."""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Any, Callable

_MISSING = object()


class TTLCache:
    def __init__(self, max_items: int = 2048) -> None:
        self._data: OrderedDict[Any, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()
        self._max = max_items

    def get(self, key: Any) -> Any:
        with self._lock:
            item = self._data.get(key)
            if item is None:
                return _MISSING
            expires, value = item
            if expires < time.monotonic():
                del self._data[key]
                return _MISSING
            self._data.move_to_end(key)
            return value

    def set(self, key: Any, value: Any, ttl: float) -> None:
        with self._lock:
            self._data[key] = (time.monotonic() + ttl, value)
            self._data.move_to_end(key)
            while len(self._data) > self._max:
                self._data.popitem(last=False)

    def get_or_set(self, key: Any, ttl: float, factory: Callable[[], Any]) -> Any:
        value = self.get(key)
        if value is _MISSING:
            value = factory()
            self.set(key, value, ttl)
        return value

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


cache = TTLCache()
