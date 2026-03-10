"""Simple in-memory cache with TTL for expensive database queries."""
import time

_cache = {}


def get_cached(key, ttl=60):
    """Get value from cache if not expired."""
    if key in _cache:
        val, ts = _cache[key]
        if time.time() - ts < ttl:
            return val
    return None


def set_cached(key, value, ttl=60):
    """Set value in cache."""
    _cache[key] = (value, time.time())
    # Clean old entries periodically
    if len(_cache) > 100:
        now = time.time()
        expired = [k for k, (_, ts) in _cache.items() if now - ts > 300]
        for k in expired:
            _cache.pop(k, None)
    return value
