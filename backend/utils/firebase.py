"""
Firebase Admin SDK Utilities
Handles Firebase initialization and common operations
"""

import firebase_admin
from firebase_admin import credentials, firestore, auth
import os
import json
import time
import logging
from functools import wraps
from typing import Callable, Any

logger = logging.getLogger(__name__)

# Global Firebase app instance
_firebase_app = None
_db = None

def initialize_firebase():
    """
    Initialize Firebase Admin SDK.

    Credential resolution order (first match wins):
    1. Individual env vars (FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL, …)
       — recommended for production / CI / GitHub deployments.  No file needed.
    2. FIREBASE_CREDENTIALS_PATH pointing to a local service-account JSON file
       — convenient for local development when you have the file on disk.
    """
    global _firebase_app, _db

    if _firebase_app is not None:
        return _firebase_app

    # ── Option 1: build credentials entirely from environment variables ──────
    private_key = os.getenv('FIREBASE_PRIVATE_KEY')
    client_email = os.getenv('FIREBASE_CLIENT_EMAIL')
    project_id = os.getenv('FIREBASE_PROJECT_ID')

    if private_key and client_email and project_id:
        # The private key is stored in .env with literal \n; restore real newlines.
        private_key = private_key.replace('\\n', '\n')

        cred_dict = {
            "type": "service_account",
            "project_id": project_id,
            "private_key_id": os.getenv('FIREBASE_PRIVATE_KEY_ID', ''),
            "private_key": private_key,
            "client_email": client_email,
            "client_id": os.getenv('FIREBASE_CLIENT_ID', ''),
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_x509_cert_url": os.getenv('FIREBASE_CLIENT_CERT_URL', ''),
            "universe_domain": "googleapis.com",
        }
        cred = credentials.Certificate(cred_dict)
        _firebase_app = firebase_admin.initialize_app(cred)
        _db = firestore.client()
        print("[OK] Firebase credentials loaded from environment variables")
        return _firebase_app

    # ── Option 2: load from a local JSON file (local dev fallback) ───────────
    creds_path = os.getenv('FIREBASE_CREDENTIALS_PATH')

    if not creds_path:
        raise ValueError(
            "Firebase credentials not configured. "
            "Set FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL + FIREBASE_PROJECT_ID "
            "in your .env, or set FIREBASE_CREDENTIALS_PATH to a service-account JSON file."
        )

    # Resolve relative paths from the backend directory
    if not os.path.isabs(creds_path):
        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        creds_path = os.path.normpath(os.path.join(backend_dir, creds_path))

    if not os.path.exists(creds_path):
        raise FileNotFoundError(f"Firebase credentials file not found: {creds_path}")

    cred = credentials.Certificate(creds_path)
    _firebase_app = firebase_admin.initialize_app(cred)
    _db = firestore.client()
    print(f"[OK] Firebase credentials loaded from file: {creds_path}")
    return _firebase_app

def get_firestore() -> Any:
    """Get Firestore database instance"""
    if _db is None:
        initialize_firebase()
    return _db

def verify_token(token):
    """
    Verify Firebase ID token
    
    Args:
        token: Firebase ID token string
        
    Returns:
        Decoded token (dict) if valid, None otherwise
    """
    try:
        if _firebase_app is None:
            initialize_firebase()
        
        decoded_token = auth.verify_id_token(token)
        return decoded_token
    except Exception as e:
        print(f"Token verification error: {e}")
        return None

def get_user_role(uid):
    """
    Get user role from Firestore
    
    Args:
        uid: User ID
        
    Returns:
        User role ('citizen' or 'authority') or None
    """
    try:
        db = get_firestore()
        assert db is not None, "Firestore client is not initialized"
        user_doc = db.collection('users').document(uid).get()
        
        if user_doc.exists:
            return user_doc.to_dict().get('role')
        return None
    except Exception as e:
        print(f"Error getting user role: {e}")
        return None

def retry_firestore_operation(max_retries=3, delay=1.0, backoff=2.0):
    """
    Decorator for retrying Firestore operations with exponential backoff
    
    Args:
        max_retries: Maximum number of retry attempts
        delay: Initial delay between retries in seconds
        backoff: Multiplier for delay on each retry
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            current_delay = delay
            
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_exception = e
                    # Check if it's a retryable error
                    error_str = str(e).lower()
                    is_retryable = any(keyword in error_str for keyword in [
                        'deadline exceeded',
                        'unavailable',
                        'internal error',
                        'resource exhausted',
                        'timeout',
                        'connection'
                    ])
                    
                    if not is_retryable or attempt == max_retries:
                        # Not retryable or max retries reached
                        logger.error(f"Firestore operation failed after {attempt + 1} attempts: {e}")
                        raise
                    
                    logger.warning(f"Firestore operation failed (attempt {attempt + 1}/{max_retries + 1}): {e}. Retrying in {current_delay}s...")
                    time.sleep(current_delay)
                    current_delay *= backoff
            
            # Should never reach here, but just in case
            if last_exception:
                raise last_exception
        
        return wrapper
    return decorator

def create_user_record(uid, email, name, role):
    """
    Create user record in Firestore
    
    Args:
        uid: User ID
        email: User email
        name: User name
        role: User role ('citizen' or 'authority')
    """
    @retry_firestore_operation(max_retries=3)
    def _create_record():
        db = get_firestore()
        assert db is not None, "Firestore client is not initialized"
        user_ref = db.collection('users').document(uid)
        user_ref.set({
            'uid': uid,
            'email': email,
            'name': name,
            'role': role,
            'created_at': firestore.SERVER_TIMESTAMP  # type: ignore[attr-defined]
        })
    
    try:
        _create_record()
    except Exception as e:
        logger.error(f"Error creating user record: {e}")
        raise

