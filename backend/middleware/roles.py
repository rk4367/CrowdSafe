"""
Role-Based Access Control Middleware
Enforces role-based permissions for endpoints
"""

from functools import wraps
from flask import request, jsonify
from utils.firebase import get_user_role

def require_role(*allowed_roles):
    """
    Decorator to require specific role(s) for an endpoint
    
    Usage:
        @require_auth
        @require_role('authority')
        def authority_only_endpoint():
            pass
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # Get user ID from request (set by require_auth)
            if not hasattr(request, 'user'):
                return jsonify({'error': 'Authentication required'}), 401
            
            uid = request.user.get('uid')
            
            # Get user role
            user_role = get_user_role(uid)
            
            if not user_role:
                return jsonify({'error': 'User role not found'}), 403
            
            # Check if user has required role
            if user_role not in allowed_roles:
                return jsonify({'error': 'Insufficient permissions'}), 403
            
            # Attach role to request
            request.user['role'] = user_role
            
            return f(*args, **kwargs)
        
        return decorated_function
    return decorator

