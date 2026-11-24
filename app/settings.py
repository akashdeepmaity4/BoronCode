"""Tiny JSON settings store (no dependency, no schema framework).

Only two keys matter today -- ``git_path`` and ``shell_path`` -- but the file is
kept generic so the AI hub or future panels can persist preferences here too.
"""

import json
import os
import threading

from .paths import SETTINGS_DIR

SETTINGS_FILE = os.path.join(SETTINGS_DIR, 'settings.json')

_lock = threading.Lock()
_cache = None


def load_settings():
    """Return the settings dict, reading from disk once and caching it."""
    global _cache
    with _lock:
        if _cache is not None:
            return dict(_cache)
        data = {}
        try:
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as handle:
                parsed = json.load(handle)
            if isinstance(parsed, dict):
                data = parsed
        except (OSError, ValueError):
            data = {}
        _cache = data
        return dict(data)


def update_settings(patch):
    """Merge ``patch`` into the stored settings and persist them."""
    global _cache
    if not isinstance(patch, dict):
        return load_settings()
    with _lock:
        current = dict(_cache or {})
        for key, value in patch.items():
            if value in (None, ''):
                current.pop(key, None)
            else:
                current[key] = value
        _cache = current
        try:
            os.makedirs(SETTINGS_DIR, exist_ok=True)
            with open(SETTINGS_FILE, 'w', encoding='utf-8') as handle:
                json.dump(current, handle, indent=2, sort_keys=True)
        except OSError:
            pass
        return dict(current)


def get_setting(key, default=''):
    value = load_settings().get(key)
    return default if value is None else value
