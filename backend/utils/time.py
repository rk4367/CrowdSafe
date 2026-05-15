from datetime import datetime

import pytz


def utc_now() -> datetime:
    # Enforced global standard: timezone-aware UTC only
    return datetime.now(pytz.utc)


def to_utc_iso(dt: datetime) -> str:
    if dt is None:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=pytz.utc)
    return dt.astimezone(pytz.utc).isoformat().replace("+00:00", "Z")

