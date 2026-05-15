import os
import sys
from typing import Iterable

import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore


TARGET_COLLECTIONS = [
    "missing_detections",
    "missing_persons",
    "notifications",
    "alerts",
]


def _init_admin():
    if firebase_admin._apps:
        return

    # Prefer backend/.env provided path, else fall back to repo root file.
    cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH")
    if not cred_path:
        here = os.path.dirname(os.path.abspath(__file__))
        cred_path = os.path.abspath(os.path.join(here, "..", "..", "firebase-credentials.json"))

    if not os.path.exists(cred_path):
        raise FileNotFoundError(
            f"Firebase credentials not found at {cred_path}. "
            f"Set FIREBASE_CREDENTIALS_PATH or place firebase-credentials.json in project root."
        )

    firebase_admin.initialize_app(credentials.Certificate(cred_path))


def _chunked(it: Iterable, size: int):
    chunk = []
    for x in it:
        chunk.append(x)
        if len(chunk) >= size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def delete_collection(db: firestore.Client, name: str, batch_size: int = 450) -> int:
    """
    Firestore batch limit is 500 operations; keep below to be safe.
    Returns number of deleted docs.
    """
    deleted_total = 0
    while True:
        docs = list(db.collection(name).limit(batch_size).stream())
        if not docs:
            break

        batch = db.batch()
        for d in docs:
            batch.delete(d.reference)
        batch.commit()

        deleted_total += len(docs)
        print(f"[{name}] deleted {len(docs)} (total {deleted_total})")
    return deleted_total


def main():
    _init_admin()
    db = firestore.client()

    print("Purging Firestore collections:")
    for c in TARGET_COLLECTIONS:
        print(f" - {c}")
    print("")

    deleted_all = 0
    for c in TARGET_COLLECTIONS:
        deleted = delete_collection(db, c)
        deleted_all += deleted

    print("")
    print(f"Done. Deleted {deleted_all} documents across {len(TARGET_COLLECTIONS)} collections.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(1)
    except Exception as e:
        print(f"\nError: {e}")
        sys.exit(1)

