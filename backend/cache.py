"""In-memory cache with TTL for expensive database queries."""
import time
import hashlib

_cache = {}


def cache_key(*args):
    """Generate a cache key from arguments."""
    return hashlib.md5(str(args).encode()).hexdigest()


def get_cached(key, ttl=60):
    if key in _cache:
        val, ts = _cache[key]
        if time.time() - ts < ttl:
            return val
        del _cache[key]
    return None


def set_cached(key, value, ttl=60):
    _cache[key] = (value, time.time())
    # Evict expired entries if cache grows large
    if len(_cache) > 200:
        now = time.time()
        expired = [k for k, (_, ts) in _cache.items() if now - ts > 300]
        for k in expired:
            _cache.pop(k, None)
    return value


def invalidate(prefix=""):
    """Clear cache entries matching prefix."""
    if not prefix:
        _cache.clear()
    else:
        keys = [k for k in _cache if k.startswith(prefix)]
        for k in keys:
            _cache.pop(k, None)
