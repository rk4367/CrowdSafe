"""
Authentication Middleware
Handles Firebase token verification and user authentication
"""

from functools import wraps
from flask import request, jsonify
from utils.firebase import verify_token, get_user_role

def require_auth(f):
    """
    Decorator to require authentication for an endpoint
    
    Usage:
        @require_auth
        def my_endpoint():
            # Access request.user for user info
            pass
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Get token from Authorization header
        auth_header = request.headers.get('Authorization')
        
        if not auth_header:
            return jsonify({'error': 'No authorization header'}), 401
        
        # Extract token (format: "Bearer <token>")
        try:
            token = auth_header.split('Bearer ')[1]
        except IndexError:
            return jsonify({'error': 'Invalid authorization header format'}), 401
        
        # Verify token
        decoded_token = verify_token(token)
        
        if not decoded_token:
            return jsonify({'error': 'Invalid or expired token'}), 401
        
        # Attach user info to request
        request.user = {
            'uid': decoded_token.get('uid'),
            'email': decoded_token.get('email')
        }
        
        return f(*args, **kwargs)
    
    return decorated_function

