"""
Authentication Routes
Handles user registration and token verification
"""

from flask import Blueprint, request, jsonify
from utils.firebase import verify_token, get_user_role, create_user_record, get_firestore
from firebase_admin import auth

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/register', methods=['POST'])
def register():
    """
    Register new user with role
    
    Request Body:
        {
            "email": "user@example.com",
            "password": "password123",
            "name": "User Name",
            "role": "citizen" or "authority"
        }
    """
    try:
        data = request.get_json()
        
        # Validate input
        required_fields = ['email', 'password', 'name', 'role']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing field: {field}'}), 400
        
        email = data['email']
        password = data['password']
        name = data['name']
        role = data['role']
        
        # Validate role
        if role not in ['citizen', 'authority']:
            return jsonify({'error': 'Invalid role. Must be "citizen" or "authority"'}), 400
        
        # Create user in Firebase Auth
        try:
            user = auth.create_user(
                email=email,
                password=password,
                display_name=name
            )
        except Exception as e:
            return jsonify({'error': f'Failed to create user: {str(e)}'}), 400
        
        # Create user record in Firestore
        try:
            create_user_record(user.uid, email, name, role)
        except Exception as e:
            # Rollback: delete auth user if Firestore creation fails
            auth.delete_user(user.uid)
            return jsonify({'error': f'Failed to create user record: {str(e)}'}), 500
        
        return jsonify({
            'success': True,
            'user': {
                'uid': user.uid,
                'email': user.email,
                'name': name,
                'role': role
            }
        }), 201
        
    except Exception as e:
        return jsonify({'error': f'Registration failed: {str(e)}'}), 500

@auth_bp.route('/verify', methods=['POST'])
def verify():
    """
    Verify token and return user data
    
    Headers:
        Authorization: Bearer <token>
    """
    try:
        # Get token from Authorization header
        auth_header = request.headers.get('Authorization')
        
        if not auth_header:
            return jsonify({'error': 'No authorization header'}), 401
        
        # Extract token
        try:
            token = auth_header.split('Bearer ')[1]
        except IndexError:
            return jsonify({'error': 'Invalid authorization header format'}), 401
        
        # Verify token
        decoded_token = verify_token(token)
        
        if not decoded_token:
            return jsonify({'error': 'Invalid or expired token'}), 401
        
        uid = decoded_token.get('uid')
        
        # Get user role from Firestore
        role = get_user_role(uid)
        
        if not role:
            return jsonify({'error': 'User role not found'}), 404
        
        # Get additional user data from Firestore
        db = get_firestore()
        user_doc = db.collection('users').document(uid).get()
        
        user_data = {
            'uid': uid,
            'email': decoded_token.get('email'),
            'role': role
        }
        
        if user_doc.exists:
            user_data.update(user_doc.to_dict())
        
        return jsonify({
            'success': True,
            'user': user_data
        }), 200
        
    except Exception as e:
        return jsonify({'error': f'Verification failed: {str(e)}'}), 500

