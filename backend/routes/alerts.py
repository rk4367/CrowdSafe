"""
Alert Management Routes
Handles alert creation, publishing, and resolution
"""

from flask import Blueprint, request, jsonify
from middleware.auth import require_auth
from middleware.roles import require_role
from utils.firebase import get_firestore, get_user_role
from utils.time import utc_now, to_utc_iso
from google.cloud.firestore import FieldFilter

alerts_bp = Blueprint('alerts', __name__)

@alerts_bp.route('/list', methods=['GET'])
@require_auth
def list_alerts():
    """
    List alerts
    - Citizens see only published alerts
    - Authorities see all alerts
    """
    try:
        # Get user role from Firestore
        uid = request.user.get('uid')
        user_role = get_user_role(uid)
        
        db = get_firestore()
        alerts_ref = db.collection('alerts')
        
        # Citizens only see published and active alerts
        if user_role == 'citizen':
            alerts_query = alerts_ref.where(filter=FieldFilter('published', '==', True)).where(filter=FieldFilter('status', '==', 'ACTIVE'))
        else:
            # Authorities see all alerts
            alerts_query = alerts_ref
        
        alerts = alerts_query.order_by('created_at', direction='DESCENDING').limit(50).stream()
        
        alert_list = []
        for alert in alerts:
            alert_data = alert.to_dict()
            alert_data['id'] = alert.id
            
            # Convert timestamps for JSON (always UTC ISO)
            if 'created_at' in alert_data and hasattr(alert_data['created_at'], 'tzinfo'):
                alert_data['created_at'] = to_utc_iso(alert_data['created_at'])
            if 'published_at' in alert_data and hasattr(alert_data['published_at'], 'tzinfo'):
                alert_data['published_at'] = to_utc_iso(alert_data['published_at'])
            if 'resolved_at' in alert_data and hasattr(alert_data['resolved_at'], 'tzinfo'):
                alert_data['resolved_at'] = to_utc_iso(alert_data['resolved_at'])
            
            alert_list.append(alert_data)
        
        return jsonify({
            'success': True,
            'data': {'alerts': alert_list},
            'error': None
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'data': None, 'error': f'Failed to list alerts: {str(e)}'}), 500

@alerts_bp.route('/create', methods=['POST'])
@require_auth
@require_role('authority')
def create_alert():
    """
    Create new alert (Authority only)
    
    Request Body:
        {
            "type": "crowd" | "fire" | "smoke" | "emergency" | "general",
            "severity": "info" | "warning" | "critical",
            "camera_id": "camera_id (optional)",
            "location_name": "Location Name",
            "latitude": 22.5726,
            "longitude": 88.3639,
            "message": "Alert message"
        }
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'data': None, 'error': 'Request body is empty'}), 400
        
        # Validate required fields
        required_fields = ['type', 'severity', 'message', 'location_name', 'latitude', 'longitude']
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'data': None, 'error': f'Missing field: {field}'}), 400
        
        # Validate type and severity
        valid_types = ['crowd', 'fire', 'smoke', 'emergency', 'general']
        valid_severities = ['info', 'warning', 'critical']
        
        if data['type'] not in valid_types:
            return jsonify({'success': False, 'data': None, 'error': f'Invalid type. Must be one of: {valid_types}'}), 400
        
        if data['severity'] not in valid_severities:
            return jsonify({'success': False, 'data': None, 'error': f'Invalid severity. Must be one of: {valid_severities}'}), 400
        
        # Prepare alert data
        alert_data = {
            'type': data['type'],
            'severity': data['severity'],
            'camera_id': data.get('camera_id', ''),
            'location_name': data['location_name'],
            'location': data['location_name'],
            'latitude': float(data['latitude']),
            'longitude': float(data['longitude']),
            'message': data['message'],
            'image_url': data.get('image_url', ''),
            'status': 'ACTIVE',
            'resolved': False,
            'published': False,  # Alerts are not published by default
            'created_at': utc_now(),
            'created_by': request.user.get('uid')
        }
        
        # Save to Firestore
        db = get_firestore()
        alert_ref = db.collection('alerts').document()
        alert_ref.set(alert_data)
        
        return jsonify({
            'success': True,
            'data': {'alert_id': alert_ref.id},
            'error': None
        }), 201
        
    except Exception as e:
        return jsonify({'success': False, 'data': None, 'error': f'Failed to create alert: {str(e)}'}), 500

@alerts_bp.route('/publish/<alert_id>', methods=['PUT'])
@require_auth
@require_role('authority')
def publish_alert(alert_id):
    """Publish alert to make it visible to citizens (Authority only)"""
    try:
        db = get_firestore()
        alert_ref = db.collection('alerts').document(alert_id)
        alert_doc = alert_ref.get()
        
        if not alert_doc.exists:
            return jsonify({'success': False, 'data': None, 'error': 'Alert not found'}), 404
        
        # Update alert
        alert_ref.update({
            'published': True,
            'status': 'ACTIVE',
            'resolved': False,
            'published_at': utc_now()
        })
        
        return jsonify({
            'success': True,
            'data': {'message': 'Alert published successfully'},
            'error': None
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'data': None, 'error': f'Failed to publish alert: {str(e)}'}), 500

@alerts_bp.route('/resolve/<alert_id>', methods=['PUT'])
@require_auth
@require_role('authority')
def resolve_alert(alert_id):
    """Resolve alert (Authority only)"""
    try:
        db = get_firestore()
        alert_ref = db.collection('alerts').document(alert_id)
        alert_doc = alert_ref.get()
        
        if not alert_doc.exists:
            return jsonify({'success': False, 'data': None, 'error': 'Alert not found'}), 404
        
        # Update alert
        alert_ref.update({
            'status': 'RESOLVED',
            'published': False,
            'resolved': True,
            'resolved_at': utc_now()
        })
        
        return jsonify({
            'success': True,
            'data': {'message': 'Alert resolved successfully'},
            'error': None
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'data': None, 'error': f'Failed to resolve alert: {str(e)}'}), 500

