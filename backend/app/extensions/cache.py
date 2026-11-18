"""Read cache shared by the services, with its keys in one place.

The pattern for every entity: reads go through get_or_load(key, loader);
every write calls invalidate(...) with each key whose data it can change,
including other entities' keys affected by FK on-delete actions (e.g.
deleting a project nulls tasks.project_id, so it invalidates TASKS).

Reads keyed by arbitrary arguments (event windows: any (start, end) range)
form a family: each one's key comes from family_key(FAMILY, *args), and
invalidate(FAMILY) drops every member at once."""

from flask_caching import Cache

cache = Cache()

TASKS = "tasks:all"
PROJECTS = "projects:all"
EVENTS = "events:window"  # a family, keyed by (start, end)


def project_notes(project_id: str) -> str:
    return f"projects:{project_id}:notes"


def project_features(project_id: str) -> str:
    return f"projects:{project_id}:features"


# Per-key (or per-family) write generation. A load that started before an
# invalidate must not put its (pre-write) rows back into the cache once the
# write has cleared it.
_generations: dict[str, int] = {}
# Keys stored per family, so invalidate(family) can delete them (dead
# entries would otherwise count toward SimpleCache's threshold until the TTL).
_members: dict[str, set[str]] = {}


def family_key(family: str, *args) -> str:
    """Key of one member of a family of reads. It embeds the family's current
    generation, so after invalidate(family) no read can reach an older member,
    even one a read that overlapped the write stores late."""
    return f"{family}@{_generations.get(family, 0)}:" + ":".join(map(str, args))


def get_or_load(key: str, loader, family: str = None):
    """Cached value for key, calling loader() to fill it on a miss. Pass the
    `family` a family_key belongs to."""
    value = cache.get(key)
    if value is None:
        generation = _generations.get(family or key, 0)
        value = loader()
        if _generations.get(family or key, 0) == generation:
            cache.set(key, value)
            if family:
                _members.setdefault(family, set()).add(key)
    return value


def invalidate(*keys: str):
    # Not cache.delete_many: Flask-Caching's version stops at the first key
    # that isn't cached (unless CACHE_IGNORE_ERRORS is set).
    for key in keys:
        _generations[key] = _generations.get(key, 0) + 1
        cache.delete(key)
        for member in _members.pop(key, ()):
            cache.delete(member)
