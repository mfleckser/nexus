"""Read cache shared by the services, with its keys in one place.

The pattern for every entity: reads go through get_or_load(key, loader);
every write calls invalidate(...) with each key whose data it can change,
including other entities' keys affected by FK on-delete actions (e.g.
deleting a project nulls tasks.project_id, so it invalidates TASKS).

Event windows are the one exception: they are keyed by arbitrary
(start, end) ranges, so event_service memoizes get_events and clears every
window at once with cache.delete_memoized(get_events)."""

from flask_caching import Cache

cache = Cache()

TASKS = "tasks:all"
PROJECTS = "projects:all"


def project_notes(project_id: str) -> str:
    return f"projects:{project_id}:notes"


def project_features(project_id: str) -> str:
    return f"projects:{project_id}:features"


def get_or_load(key: str, loader):
    """Cached value for key, calling loader() to fill it on a miss."""
    value = cache.get(key)
    if value is None:
        value = loader()
        cache.set(key, value)
    return value


def invalidate(*keys: str):
    # Not cache.delete_many: Flask-Caching's version stops at the first key
    # that isn't cached (unless CACHE_IGNORE_ERRORS is set).
    for key in keys:
        cache.delete(key)
