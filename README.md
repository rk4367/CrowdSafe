<div align="center">

# 🛡️ CrowdSafe — AI-Powered Crowd Intelligence Platform

**Real-time crowd monitoring, fire/smoke detection, and missing-person search for mass public events.**

[Features](#-key-features) • [Architecture](#-system-architecture) • [AI Models](#-ai--computer-vision-models) • [API Docs](#-api-endpoints) • [Setup](#-setup-instructions) • [Workflows](#-core-workflows)

</div>

---

## 📌 Project Overview

CrowdSafe is a production-oriented **full-stack crowd intelligence platform** that integrates live CCTV analytics, AI computer vision, and role-based dashboards to help **authorities and citizens collaborate** during high-density public events.

The system continuously processes CCTV feeds using three parallel AI pipelines:
- **Crowd density estimation** (PyTorch `LightweightCrowdNet`)
- **Fire and smoke detection** (YOLO via Ultralytics)
- **Missing-person face recognition** (InsightFace + ONNX Runtime)

Results are streamed in real-time to dual dashboards — one for citizens, one for authorities — through Firestore `onSnapshot` listeners with no manual refresh required.

### Real-World Context

Mass public events like the **Kumbh Mela** (attending 400+ million people), stadium concerts, political rallies, and pilgrimages create critical crowd management challenges. Traditional manual CCTV monitoring is reactive and error-prone:

- A crowd density spike can turn into a fatal stampede within seconds
- Missing persons at large events are nearly impossible to locate manually
- Fire/smoke incidents go undetected until smoke is visible to human operators
- There is no structured communication channel between citizens and authorities

CrowdSafe was designed to solve exactly these problems using computer vision tightly integrated with a real-time web platform.

---

## 🚨 Problem Statement

| Problem | Impact |
|---|---|
| **Crowd overcrowding** | Surges become stampedes when density exceeds safe thresholds — Kumbh Mela 2013 stampede killed 36 people |
| **No real-time density awareness** | Authorities react to disasters instead of preventing them |
| **Fire/smoke detection lag** | Human operators miss early CCTV indicators before fire spreads |
| **Missing persons** | No systematic, scalable method to search for specific people across cameras at large events |
| **Citizen-authority disconnect** | Citizens have no structured channel to report emergencies or track case status |
| **Alert fragmentation** | Alerts exist in isolation — no lifecycle management (create → publish → resolve) |

---

## 💡 Proposed Solution

CrowdSafe addresses these problems through four integrated subsystems:

1. **Continuous CCTV Processing Pipeline** — Daemon threads process all camera streams in parallel at configurable intervals, running crowd, fire, and face-recognition inference on every frame.

2. **Tiered Alert Lifecycle** — Authorities manage alerts from creation through publication to resolution. Citizens see only published, active alerts — not internal drafts.

3. **Managed Missing-Person Workflow** — A structured 8-step lifecycle from citizen report submission to authority-confirmed match, with face scanning against all active CCTV streams.

4. **Real-Time Role-Based Dashboards** — Firestore `onSnapshot` listeners power both dashboards so every backend Firestore write is reflected instantly on the UI without polling.

---

## 🌍 Use Cases

| Scenario | How CrowdSafe Helps |
|---|---|
| **Kumbh Mela / religious gatherings** | Monitor crowd density across hundreds of camera feeds; trigger alerts when density reaches "critical" (400+ persons per frame) |
| **IPL celebrations / stadium events** | Detect early fire/smoke before evacuation becomes impossible; manage case for missing child in the crowd |
| **Public transport hubs** | Monitor platform density and prevent overcrowding before boarding |
| **Smart city infrastructure** | Centralized monitoring of fixed cameras across multiple city zones |
| **Political rallies / protests** | Real-time situational awareness for police/emergency services |

---

## 🛠️ Tech Stack

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| React | 18.2 | UI framework |
| Vite | 7.x | Build tool + dev server |
| React Router | 6.20 | Client-side routing + RBAC guards |
| Firebase Web SDK | 10.7 | Auth + Firestore real-time listeners |
| React Leaflet + OpenStreetMap | 4.2 | Interactive CCTV camera map |
| Chart.js + react-chartjs-2 | 4.4 | Crowd analytics charts |
| Framer Motion | 12.x | Page + component animations |
| Lucide React | 0.562 | Icon system |
| Tailwind CSS | 3.3 | Utility-first styling |
| Axios | 1.6 | HTTP client with JWT interceptor |

### Backend
| Technology | Version | Purpose |
|---|---|---|
| Flask | 3.0 | REST API server |
| Flask-CORS | 4.0 | Cross-origin request handling |
| Firebase Admin SDK | 6.2 | Token verification + Firestore admin writes |
| Gunicorn | 21.2 | Production WSGI server |
| python-dotenv | 1.0 | Environment config |
| Cloudinary | 1.36 | CCTV frame and evidence image storage |

### AI / Computer Vision
| Technology | Purpose |
|---|---|
| PyTorch 2.0+ | Custom `LightweightCrowdNet` density estimation model |
| Ultralytics YOLO | Fire/smoke detection (`best.pt` custom-trained weights) |
| InsightFace 0.7+ | Face embedding extraction + recognition |
| ONNX Runtime 1.15+ | Optimized InsightFace inference engine |
| OpenCV 4.8 | Frame capture, preprocessing, BGR/RGB conversion |
| NumPy | Density map computation + cosine similarity |

### Infrastructure
| Technology | Purpose |
|---|---|
| Firebase Firestore | Primary database + real-time pub/sub |
| Firebase Authentication | Email/Password auth + JWT token issuance |
| Cloudinary CDN | Image storage for CCTV evidence and missing-person photos |
| Vercel | Frontend deployment |
| Gunicorn / Render / Railway | Backend hosting |

---

## 🧱 System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CCTV Infrastructure                          │
│           IP Cameras / MJPEG Streams / HTTP Streams                  │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ Stream URLs
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Flask Backend (app.py)                            │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              Background Daemon Threads                        │  │
│  │                                                              │  │
│  │  Thread 1: process_all_cameras_continuously()                │  │
│  │    └── ThreadPoolExecutor (4 workers default)                │  │
│  │         └── Per camera: capture → crowd detection            │  │
│  │                       → fire/smoke detection                 │  │
│  │                       → Firestore update                     │  │
│  │                                                              │  │
│  │  Thread 2: scan_missing_persons_continuously()               │  │
│  │    └── ThreadPoolExecutor (4 workers default)                │  │
│  │         └── Per (person × camera): capture → face recog      │  │
│  │                                  → notification upsert       │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────────────────────┐                   │
│  │  REST API Blueprints                         │                   │
│  │  /api/auth   /api/cctv   /api/alerts         │                   │
│  │  /api/missing                                │                   │
│  └─────────────────────────────────────────────┘                   │
└──────────────────┬──────────────────────────────────────────────────┘
                   │ Admin SDK reads/writes
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Google Firestore                              │
│  collections: users │ cctv_cameras │ alerts │ missing_persons        │
│               notifications                                          │
└──────────────────┬──────────────────────────────────────────────────┘
                   │ onSnapshot listeners
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    React Frontend (Vite)                              │
│                                                                     │
│  ┌─────────────────────────┐  ┌──────────────────────────────────┐  │
│  │   Citizen Dashboard      │  │    Authority Dashboard            │  │
│  │  • Live Crowd Map        │  │   • CCTV Management               │  │
│  │  • Public Alerts Panel   │  │   • Alerts Management             │  │
│  │  • Missing Person Report │  │   • Missing Person Management     │  │
│  │  • My Reports History    │  │   • Analytics Dashboard           │  │
│  └─────────────────────────┘  └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
API Request:
  Browser → Axios (+ Bearer token) → Flask → verify_id_token() → Firestore

Background Pipeline:
  CCTV Stream → OpenCV frame capture
              → LightweightCrowdNet → count + level → Firestore cctv_cameras
              → FireSmokeDetector (YOLO) → fire/smoke → Firestore alerts
              → InsightFace recognizer → cosine match → Firestore notifications

Real-Time UI Update:
  Firestore write → onSnapshot listener → React state → DOM re-render
```

### Background Processing Logic

The backend runs **two independent daemon threads** from startup:

| Thread | Interval | Purpose |
|---|---|---|
| `process_all_cameras_continuously` | `CROWD_PROCESSING_INTERVAL` (default 20s) | Crowd + fire/smoke on ALL cameras |
| `scan_missing_persons_continuously` | `MISSING_PERSON_SCAN_INTERVAL` (default 10s) | Face search on ACTIVE cameras for SEARCHING persons |

Key optimizations:
- **Frame caching**: The missing-person scanner caches captured frames per camera for 5 seconds to avoid redundant stream connections when multiple persons need to be searched against the same camera.
- **City-scoped search**: The scanner filters cameras by city, matching against the `last_seen_city` of each missing person.
- **Conditional face recognition**: The crowd processing thread skips face recognition entirely unless at least one `search_active=true` missing-person document exists.
- **Quota-aware backoff**: Both threads implement exponential backoff with jitter on Firestore `ResourceExhausted` / 429 errors to prevent quota hot-loops.
- **Meaningful-change guard**: Firestore writes are skipped if none of the tracked fields (`status`, `count`, `crowd_level`, etc.) have changed.

---

## 📁 Folder Structure

```
CrowdSafe/
│
├── backend/                          # Flask API server
│   ├── app.py                        # Entry point: Flask init, blueprint registration,
│   │                                 #   background threads (crowd + face scan)
│   ├── requirements.txt              # Python dependencies
│   ├── .env                          # Backend environment variables (not committed)
│   │
│   ├── middleware/
│   │   ├── auth.py                   # @require_auth decorator: verifies Firebase ID token
│   │   └── roles.py                  # @require_role('authority') decorator
│   │
│   ├── routes/
│   │   ├── auth.py                   # POST /api/auth/register, /verify
│   │   ├── alerts.py                 # GET list, POST create, PUT publish/resolve
│   │   ├── cctv.py                   # Camera CRUD + stream testing + frame processing
│   │   │                             #   (largest file: 57 KB — core pipeline logic)
│   │   └── missing.py                # Full missing-person lifecycle: 15+ endpoints
│   │
│   ├── models/
│   │   ├── crowd_detection.py        # LightweightCrowdNet (PyTorch) + CrowdDetector class
│   │   ├── face_recognition.py       # InsightFace recognizer, embedding DB, cosine matching
│   │   ├── fire_smoke_detector.py    # YOLO-based fire/smoke detector (FireSmokeDetector)
│   │   ├── fire_detection.py         # Thin compatibility wrapper → fire_smoke_detector.py
│   │   └── ip_camera.py              # MJPEG stream reader utility class
│   │
│   ├── utils/
│   │   ├── firebase.py               # Firebase Admin init, get_firestore(), role helpers,
│   │   │                             #   @with_firestore_retry decorator
│   │   ├── images.py                 # Cloudinary upload helpers (frames, crops)
│   │   └── time.py                   # utc_now() — timezone-safe UTC datetime helper
│   │
│   ├── data/
│   │   ├── face_database.pkl         # Serialized face embedding DB (runtime-generated)
│   │   ├── mall_shanghai_finetuned.pth  # Crowd density model weights
│   │   └── fire/
│   │       └── best.pt               # YOLO fire/smoke model weights
│   │
│   └── scripts/                      # Utility scripts (DB seeding etc.)
│
├── frontend/                         # React + Vite SPA
│   ├── index.html
│   ├── vite.config.js                # Vite config + /api proxy → Flask
│   ├── package.json
│   ├── .env                          # VITE_* Firebase + API keys (not committed)
│   │
│   └── src/
│       ├── main.jsx                  # React bootstrap
│       ├── App.jsx                   # Router: public routes + ProtectedRoute guards
│       │
│       ├── config/
│       │   └── firebase.js           # Firebase app init, loginUser(), registerUser(),
│       │                             #   logoutUser(), auth/db exports
│       │
│       ├── hooks/
│       │   └── useAuth.js            # onAuthStateChanged + Firestore role lookup hook
│       │
│       ├── services/
│       │   └── api.js                # Axios instance + all backend API wrapper functions
│       │
│       ├── pages/
│       │   ├── Home.jsx              # Landing page (unauthenticated)
│       │   ├── Login.jsx             # Portal toggle (Citizen/Authority) + role validation
│       │   ├── Register.jsx          # Role card selector + registration form
│       │   ├── CitizenDashboard.jsx  # Citizen portal: map, alerts, missing reports
│       │   ├── AuthorityDashboard.jsx # Authority portal: CCTV, alerts, case management
│       │   └── Unauthorized.jsx      # 403 page with role-aware redirect
│       │
│       ├── components/
│       │   ├── common/
│       │   │   ├── ProtectedRoute.jsx  # Auth + role guard component
│       │   │   ├── BrandLogo.jsx
│       │   │   └── MyAccount.jsx
│       │   │
│       │   ├── citizen/
│       │   │   ├── CrowdMap.jsx        # Leaflet map with camera markers + density colors
│       │   │   ├── AlertsPanel.jsx     # Live published alerts for citizens
│       │   │   ├── MissingPersonReport.jsx    # Report submission form
│       │   │   ├── MissingPersonFound.jsx     # Citizen notify-found action
│       │   │   └── MissingPersonHistory.jsx   # Citizen's own submitted cases
│       │   │
│       │   └── authority/
│       │       ├── CCTVManagement.jsx          # Add/edit/delete cameras + map
│       │       ├── AlertsManagement.jsx        # Create/publish/resolve alerts
│       │       ├── MissingPersonManagement.jsx # Accept/inform/confirm/rescan cases
│       │       └── Analytics.jsx               # Crowd trend charts
│       │
│       └── utils/
│           ├── time.js               # IST datetime formatting helper
│           └── firebaseListeners.js  # Generic onSnapshot unsubscribe wrapper
│
├── firebase/
│   └── firestore.rules               # Firestore security rules (role-gated per collection)
│
└── README.md
```

---

## 🔐 Authentication & RBAC

### Authentication Flow

```
1. User registers (POST /api/auth/register)
   └── Firebase Auth creates account
   └── Firestore users/{uid} doc created with role field

2. User logs in (Firebase client SDK signInWithEmailAndPassword)
   └── Firebase returns ID token (JWT, 1-hour TTL)
   └── Role validated from Firestore users/{uid}.role
   └── Portal enforcement: citizen token rejected on authority portal (and vice versa)

3. Frontend API call (Axios interceptor)
   └── Fetches fresh ID token via getIdToken()
   └── Injects: Authorization: Bearer <idToken>

4. Flask API (middleware/auth.py)
   └── firebase_admin.auth.verify_id_token(token)
   └── Looks up Firestore users/{uid} for role
   └── @require_role('authority') raises 403 for citizen callers
```

### Role System

| Role | Access |
|---|---|
| `citizen` | Read crowd map, view published alerts, submit/track missing person reports, receive found notifications |
| `authority` | Everything citizens see + CCTV management, all alerts (published + unpublished), missing person case management, analytics |

### Frontend Guards (three layers)

```jsx
// Layer 1 — Login portal enforcement (Login.jsx)
// User's Firestore role must match selected portal tab
if (userRole !== portal) {
  await logoutUser();  // immediately sign out
  setError("Access denied...");
}

// Layer 2 — Route guard (App.jsx + ProtectedRoute.jsx)
<Route path="/authority/dashboard/*" element={
  <ProtectedRoute requiredRole="authority">
    <AuthorityDashboard />
  </ProtectedRoute>
} />

// Layer 3 — Firestore rules (firebase/firestore.rules)
match /alerts/{alertId} {
  allow read: if isAuthenticated() && (isAuthority() || resource.data.published == true);
  allow create, update, delete: if isAuthority();
}
```

### Backend Guards (middleware)

```python
@alerts_bp.route('/create', methods=['POST'])
@require_auth        # Validates Firebase ID token → 401 if missing/invalid
@require_role('authority')  # Checks Firestore role → 403 if citizen
def create_alert():
    ...
```

---

## 📡 API Endpoints

**Base URL:** `http://localhost:5000`
**Auth:** All `/api/*` endpoints require `Authorization: Bearer <firebase-id-token>`

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | API health check |

### Auth (`/api/auth`)

| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | None | Create Firebase Auth user + Firestore profile |
| `POST` | `/api/auth/verify` | Any | Validate token, return merged user metadata |

**Register body:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "Jane Doe",
  "role": "citizen"
}
```

### Alerts (`/api/alerts`)

| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/api/alerts/list` | Any | Citizens: published+active only. Authorities: all |
| `POST` | `/api/alerts/create` | Authority | Create alert (type: crowd/fire/smoke/emergency/general) |
| `PUT` | `/api/alerts/publish/<id>` | Authority | Set `published=true` — makes visible to citizens |
| `PUT` | `/api/alerts/resolve/<id>` | Authority | Set `status=RESOLVED`, remove from public view |

### CCTV (`/api/cctv`)

| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/api/cctv/list` | Any (auth) | All cameras with latest state |
| `POST` | `/api/cctv/add` | Authority | Add camera; auto-checks stream accessibility |
| `PUT` | `/api/cctv/update/<id>` | Authority | Partial update of camera fields |
| `DELETE` | `/api/cctv/delete/<id>` | Authority | Remove camera |
| `POST` | `/api/cctv/test-stream` | Authority | One-shot frame capture + full pipeline test |
| `POST` | `/api/cctv/process/<id>` | Authority | On-demand process a single camera |
| `GET` | `/api/cctv/status/<id>` | Any (auth) | Get camera status (optional stream check) |
| `POST` | `/api/cctv/check-status/<id>` | Authority | Dynamic health check + crowd update |
| `POST` | `/api/cctv/check-all-status` | Authority | Batch health check for all cameras |

### Missing Persons (`/api/missing`)

| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/api/missing/list` | Any (auth) | List cases, optional `?status=` filter |
| `POST` | `/api/missing/report` | Any (auth) | Submit report (multipart: photo + metadata) |
| `PUT` | `/api/missing/update-status/<id>` | Authority | Legacy status update |
| `GET` | `/api/missing/notifications` | Any (auth) | Authorities: all detections. Citizens: own only |
| `PUT` | `/api/missing/notifications/<id>/read` | Any (auth) | Mark notification read |
| `PUT` | `/api/missing/cases/<id>/accept` | Authority | Approve case → `search_active=true` |
| `PUT` | `/api/missing/cases/<id>/authority/confirm-match` | Authority | Final confirmation → stop search |
| `PUT` | `/api/missing/cases/<id>/authority/rescan` | Authority | Restart scan cycle |
| `PUT` | `/api/missing/detections/<id>/inform-citizen` | Authority | Share detection with reporting citizen |
| `PUT` | `/api/missing/cases/<id>/citizen/confirm-found` | Citizen | Confirm detected person is their relative |
| `PUT` | `/api/missing/cases/<id>/citizen/rescan` | Citizen | Request new scan cycle |
| `PUT` | `/api/missing/detections/<id>/confirm` | Authority | Legacy confirm endpoint |
| `POST` | `/api/missing/debug/test-face-detection` | Authority | Diagnostic face detection test |
| `GET` | `/api/missing/debug/face-recognition-status` | Authority | Face recognition system status |

---

## 🔄 Core Workflows

### 1. Missing Person Lifecycle (8-Step)

```
Step 1 — Citizen submits report
  POST /api/missing/report
  → Photo uploaded to Cloudinary
  → Face embedding extracted via InsightFace (if face detected)
  → Stored in missing_persons/{id} with:
      status = "searching"
      search_active = false   ← NOT scanning yet

Step 2 — Authority reviews case
  Authority sees new case in MissingPersonManagement dashboard
  (Firestore onSnapshot triggers instant UI update)

Step 3 — Authority accepts case
  PUT /api/missing/cases/{id}/accept
  → search_active = true
  → Background scanner now includes this person in face-search cycles

Step 4 — Background scanner detects match
  scan_missing_persons_continuously() thread:
  → Captures frames from active cameras in person's last_seen_city
  → Runs InsightFace on frame
  → Cosine similarity match against registered embedding
  → If confidence ≥ threshold AND NOT already confirmed:
      Upserts notifications/missing_person_detected_{person_id}
      (one stable document per person — no duplicate spam)

Step 5 — Authority reviews detection
  Authority sees detection notification in dashboard
  Can view camera location, confidence score, bounding box

Step 6 — Authority informs citizen
  PUT /api/missing/detections/{id}/inform-citizen
  → visible_to_citizen = true
  → Citizen can now see detection in their notification panel

Step 7 — Citizen responds
  Option A: Confirm found
    PUT /api/missing/cases/{id}/citizen/confirm-found
    → status = "CONFIRMED_BY_CITIZEN"
  Option B: Wrong person — request rescan
    PUT /api/missing/cases/{id}/citizen/rescan
    → status = "RESCAN_REQUESTED"

Step 8 — Authority final confirmation
  PUT /api/missing/cases/{id}/authority/confirm-match
  → status = "MATCH_CONFIRMED"
  → search_active = false  ← Scanning permanently stopped
```

### 2. Crowd Monitoring Flow

```
Every CROWD_PROCESSING_INTERVAL seconds (default: 20s):

1. Background thread fetches all cctv_cameras from Firestore
2. Checks if any missing_persons.search_active == true
   → If yes: enable_face_recognition = True (passed to worker)
   → If no: face recognition skipped (performance optimization)
3. ThreadPoolExecutor dispatches cameras in parallel (default: 4 workers)
4. Per camera:
   a. Stream health check (skipped if updated < 5 seconds ago)
   b. OpenCV frame capture from MJPEG/HTTP stream
   c. LightweightCrowdNet inference → count + density level
   d. If enable_face_recognition: InsightFace scan (targeted recognition)
   e. FireSmokeDetector (YOLO) inference → fire/smoke counts
   f. If fire or smoke detected: upload frame to Cloudinary → create/update alert doc
   g. Update cctv_cameras/{id} ONLY if tracked fields changed (meaningful-change guard)
5. Firestore writes trigger onSnapshot → dashboards update instantly
```

### 3. Fire/Smoke Detection and Alert Flow

```
1. YOLO inference on captured frame
   → Separate confidence thresholds: FIRE_CONF, SMOKE_CONF (default: 0.20)
   → Class name normalization: "flame", "flames" → "fire"; "smokes" → "smoke"

2. If fire_count > 0 or smoke_count > 0:
   a. Frame encoded and uploaded to Cloudinary as evidence image
   b. Alert document created/updated in Firestore alerts/ collection:
      type: "fire" or "smoke"
      severity: "critical"
      status: "ACTIVE"
      published: false       ← Internal only until authority publishes
      image_url: <cloudinary url>
      camera_id, location, latitude, longitude

3. Authority sees alert immediately via onSnapshot
4. Authority publishes alert → published: true
5. Citizens see alert in their AlertsPanel
6. Authority resolves → resolved: true, published: false
```

### 4. Real-Time Notification Flow

```
Backend writes Firestore document
         ↓
Firestore propagates change (WebSocket/SSE internally)
         ↓
Frontend onSnapshot callback fires
         ↓
React setState() called with new data
         ↓
Component re-renders — user sees update in < 1 second
```

**Citizen Dashboard listens to:**
- `cctv_cameras` (for crowd map pin colors and density values)
- `alerts` where `published==true AND status=="ACTIVE"` (public alerts panel)
- `missing_persons` for their own reported cases (status transitions)
- `notifications` where `user_id == uid` (detection notifications)

**Authority Dashboard listens to:**
- `cctv_cameras` (all cameras, all fields)
- `alerts` (all alerts — published and unpublished)
- `missing_persons` (all cases)
- `notifications` (all detection notifications)

---

## 🧠 AI / Computer Vision Models

### 1. Crowd Density Estimation — `LightweightCrowdNet`

**Architecture:** Custom MobileNet-inspired PyTorch CNN with depthwise separable convolutions.

```
Input (BGR frame)
  → BGR→RGB conversion (OpenCV)
  → Resize to 256×256
  → Normalize to [0.0, 1.0]
  → Tensor [1, 3, 256, 256]
  → Feature extractor (Conv2d + DepthwiseSeparable blocks × 6)
  → Density head (1×1 convolutions → single-channel density map)
  → Count = sum(density_map)    ← Total people in frame estimate
```

**Density Levels:**

| Count | Level | Color on Map |
|---|---|---|
| 0–100 | `low` | 🟢 Green |
| 101–250 | `medium` | 🟡 Yellow |
| 251–400 | `high` | 🟠 Orange |
| 400+ | `critical` | 🔴 Red |

**Model weights:** `backend/data/mall_shanghai_finetuned.pth`
Fine-tuned on Mall Dataset + ShanghaiTech Dataset — urban crowd scenes.

**GPU support:** Auto-detects CUDA; falls back to CPU. cuDNN benchmark mode enabled for consistent input sizes.

**Limitations:**
- Density map model does not produce per-person bounding boxes (indirect count estimation)
- Accuracy depends on scene similarity to training domain (mall/urban crowds)
- Partial occlusion and fisheye camera distortion reduce accuracy
- Does not distinguish between standing vs. moving crowds

---

### 2. Fire & Smoke Detection — YOLO (Ultralytics)

**Model:** Custom-trained YOLOv8 weights (`backend/data/fire/best.pt`).

```
Input (BGR frame, captured by OpenCV)
  → YOLO predict() — imgsz=384 (configurable via FIRE_SMOKE_IMGSZ)
  → Per detection box:
      - Normalize class name: "flame"/"flames" → "fire", "smokes" → "smoke"
      - Apply class-specific threshold: FIRE_CONF or SMOKE_CONF
      - Filter boxes below threshold
  → Return: { fire: int, smoke: int, boxes: [{bbox, label, conf}] }
```

**Confidence thresholds:** Default 0.20 for both (configurable via env). Lower threshold ensures early detection but may increase false positives.

**Limitations:**
- Small or distant flames may be missed at lower resolutions
- Heavy steam/vapor can trigger smoke false positives
- Night vision / infrared cameras require separate model variants

---

### 3. Missing-Person Face Recognition — InsightFace + ONNX

**Architecture:** Two-stage pipeline.

**Stage 1 — Face Detection:**
InsightFace `FaceAnalysis` runs detection on the frame, returning face bounding boxes.

**Stage 2 — Embedding Extraction & Matching:**
```
Detected face region
  → InsightFace ArcFace model → 512-dimensional normalized embedding
  → Cosine similarity against stored embedding for target person
  → If similarity ≥ threshold (default 0.5):
      → Match found
      → confidence = similarity score
      → detection_status = "detected" (conf > 0.7) or "possible_match"
```

**Embedding Storage:**
- Runtime: local `backend/data/face_database.pkl` (pickle, reloaded each scan cycle)
- Optional: per-case `face_embedding` field in Firestore `missing_persons/{id}`

**Targeted Recognition:**
The scanner passes `target_person_id` and `target_embedding` to `detect_and_recognize()`. Only embeddings matching the specific searched person are returned — other faces in frame are ignored, minimizing false positive cross-contamination.

**Auto-registration:**
If a person's embedding is not found in the local DB at scan time (e.g., after server restart), the scanner automatically re-downloads their photo from Cloudinary, re-extracts the embedding, and registers them before continuing.

**Notification Deduplication:**
The system upserts a single stable document per person (`notifications/missing_person_detected_{person_id}`) rather than creating new documents on each detection. Already-confirmed detections are skipped entirely.

**Limitations:**
- Photo quality and face angle at submission time significantly affect matching accuracy
- Low-resolution CCTV streams (< 480p) reduce face detection reliability
- InsightFace requires ONNX Runtime; optional install (backend degrades gracefully without it)
- Cosine similarity threshold may need tuning per deployment environment

---

## ⚡ Real-Time System

### Firestore `onSnapshot` Pattern

All real-time updates use a consistent pattern throughout the frontend:

```js
// Example: Authority watching all cameras
useEffect(() => {
  const q = query(collection(db, 'cctv_cameras'));
  const unsubscribe = onSnapshot(q, (snapshot) => {
    const cameras = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    setCameras(cameras);
  });
  return unsubscribe; // cleanup on unmount
}, []);
```

### Update Latency

Backend writes to Firestore → Frontend receives snapshot update typically in **< 500ms** under normal network conditions.

### What Updates in Real-Time

| Dashboard | Collection | Trigger |
|---|---|---|
| Citizen: Crowd Map | `cctv_cameras` | Background crowd worker writes count/level |
| Citizen: Alerts Panel | `alerts` | Authority publishes/resolves |
| Citizen: Case Status | `missing_persons` | Authority accepts/confirms |
| Citizen: Notifications | `notifications` | Detection + authority informs |
| Authority: CCTV Panel | `cctv_cameras` | Background worker every 20s |
| Authority: Alert Board | `alerts` | Any alert create/update |
| Authority: Cases | `missing_persons` | Report submission + status changes |
| Authority: Detections | `notifications` | Face scan matches |

---

## ⚙️ Setup Instructions

### Prerequisites

- Python 3.10+
- Node.js 18+ and npm
- Firebase project with **Email/Password Auth** enabled and **Firestore** in Native mode
- Firebase service account JSON (download from Firebase Console → Project Settings → Service Accounts)
- Cloudinary account (free tier works for development)
- *(Optional)* NVIDIA GPU with CUDA for faster AI inference

### Backend Setup

```bash
# 1. Create and activate virtual environment
cd backend
python -m venv venv

# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# Note: InsightFace on Windows requires Visual C++ Build Tools
# Download: https://visualstudio.microsoft.com/visual-cpp-build-tools/
# Install "C++ build tools" workload, then: pip install insightface

# 3. Configure environment
cp .env.example .env   # or create manually (see below)

# 4. Place model weights
# backend/data/mall_shanghai_finetuned.pth   ← crowd model
# backend/data/fire/best.pt                  ← fire/smoke YOLO model

# 5. Add Firebase credentials
# Edit backend/.env and paste your Firebase service account details

# 6. Start server
python app.py
# Server runs at http://localhost:5000
```

### Frontend Setup

```bash
cd frontend
npm install
# Configure environment (see below)
npm run dev
# Dev server at http://localhost:5173
```

### Environment Variables

**`backend/.env`**
```env
# Firebase Admin SDK (Direct credentials instead of JSON file)
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_PRIVATE_KEY_ID=your_private_key_id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...
FIREBASE_CLIENT_ID=your_client_id
FIREBASE_CLIENT_CERT_URL=https://...

# Flask
SECRET_KEY=your-flask-secret-key

# CORS
CORS_ORIGINS=http://localhost:5173

# Flask
FLASK_ENV=development
FLASK_PORT=5000

# Cloudinary
CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
# OR use individual keys:
# CLOUDINARY_CLOUD_NAME=...
# CLOUDINARY_API_KEY=...
# CLOUDINARY_API_SECRET=...

# Background processing
CROWD_PROCESSING_INTERVAL=20       # seconds between crowd detection cycles
CROWD_PROCESSING_WORKERS=4         # parallel threads for camera processing
MISSING_PERSON_SCAN_INTERVAL=10    # seconds between face scan cycles
MISSING_PERSON_SCAN_WORKERS=4      # parallel threads for face scanning

# AI model thresholds
FIRE_CONF=0.20                     # fire detection confidence threshold
SMOKE_CONF=0.20                    # smoke detection confidence threshold
FIRE_SMOKE_MODEL_PATH=             # optional: custom path to YOLO weights
CROWD_DETECTION_INPUT_SIZE=256     # inference resolution (pixels)
```

**`frontend/.env`**
```env
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
VITE_API_URL=http://localhost:5000
```

### Firebase Setup

1. Enable Email/Password authentication in Firebase Console → Authentication → Sign-in methods
2. Create Firestore database in Native mode (any region)
3. Deploy security rules:
```bash
firebase deploy --only firestore:rules
# or manually copy firebase/firestore.rules into Firebase Console
```
4. Ensure `users/{uid}` documents contain `role: "citizen"` or `role: "authority"` — set during registration via `/api/auth/register`

### Run Commands

```bash
# Terminal 1 — Backend
cd backend && venv\Scripts\activate && python app.py

# Terminal 2 — Frontend
cd frontend && npm run dev
```

---

## 🚀 Deployment

### Frontend — Vercel

1. Connect `frontend/` directory as a Vercel project
2. Set build command: `npm run build`; output directory: `dist`
3. Add all `VITE_*` environment variables in Vercel dashboard
4. Set `VITE_API_URL` to your deployed backend URL
5. No `vercel.json` rewrite needed (Vite SPA routing handled by index.html fallback)

### Backend — Production Server

```bash
# Using Gunicorn (included in requirements.txt)
gunicorn app:app --workers 4 --bind 0.0.0.0:5000

# Recommended platforms: Render, Railway, Fly.io, Azure App Service, AWS EC2
```

**Production checklist:**
- Set `FLASK_ENV=production`
- Update `CORS_ORIGINS` to your production frontend domain
- Inject Firebase service account securely (environment variable or secret manager — do NOT commit credentials)
- Configure Cloudinary with production account credentials
- Ensure model weight files (`mall_shanghai_finetuned.pth`, `best.pt`) are accessible on the server

---

## 🗃️ Firestore Data Model

### `users/{uid}`
```json
{
  "uid": "firebase-uid",
  "email": "user@example.com",
  "name": "Jane Doe",
  "role": "citizen",
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

### `cctv_cameras/{camera_id}`
```json
{
  "name": "Gate A Camera",
  "stream_url": "http://ip:port/stream",
  "ip_address": "192.168.1.100",
  "location_name": "Main Entrance",
  "city": "Mumbai",
  "latitude": 19.0760,
  "longitude": 72.8777,
  "status": "active",
  "count": 217,
  "crowd_level": "medium",
  "faces_detected": 12,
  "missing_persons_detected": 0,
  "last_error": null,
  "last_updated": "2024-01-01T12:00:00Z"
}
```

### `alerts/{alert_id}`
```json
{
  "type": "fire",
  "severity": "critical",
  "message": "Fire detected near Gate B",
  "camera_id": "cam_001",
  "location_name": "Gate B",
  "latitude": 19.076,
  "longitude": 72.877,
  "image_url": "https://res.cloudinary.com/...",
  "status": "ACTIVE",
  "published": true,
  "resolved": false,
  "created_at": "2024-01-01T12:00:00Z",
  "published_at": "2024-01-01T12:01:00Z",
  "created_by": "authority-uid"
}
```

### `missing_persons/{person_id}`
```json
{
  "name": "Ravi Kumar",
  "age": 45,
  "gender": "Male",
  "description": "Blue shirt, grey trousers",
  "photo_url": "https://res.cloudinary.com/...",
  "last_seen_location": "Sector 4 Gate",
  "last_seen_city": "Prayagraj",
  "contact_phone": "+91-9999999999",
  "reported_by": "citizen-uid",
  "status": "searching",
  "search_active": true,
  "face_embedding": [...],
  "notification_sent": false,
  "created_at": "2024-01-01T10:00:00Z"
}
```

### `notifications/{notification_id}`
```json
{
  "type": "missing_person_detected",
  "person_id": "person_abc",
  "person_name": "Ravi Kumar",
  "camera_id": "cam_001",
  "camera_name": "Gate A Camera",
  "location": {
    "name": "Gate A", "city": "Prayagraj",
    "latitude": 25.4358, "longitude": 81.8463
  },
  "confidence": 0.83,
  "confidence_percentage": 83.0,
  "detection_status": "detected",
  "user_id": "citizen-uid",
  "visible_to_citizen": false,
  "read": false,
  "confirmed": false,
  "detected_at": "2024-01-01T12:30:00Z"
}
```

---

## 🔒 Firestore Security Rules Summary

| Collection | Citizen Read | Authority Read | Citizen Write | Authority Write |
|---|---|---|---|---|
| `users` | ✅ Any authenticated | ✅ | ✅ Own doc only | ✅ Own doc only |
| `cctv_cameras` | ✅ | ✅ | ❌ | ✅ Full CRUD |
| `alerts` | ✅ Published+Active only | ✅ All | ❌ | ✅ Full CRUD |
| `missing_persons` | ✅ | ✅ | ✅ Create only | ✅ Full CRUD |
| `notifications` | ✅ Own only | ✅ All | ✅ Mark read/read_at only | ✅ Full CRUD |

---

## ⚠️ Limitations

| Area | Limitation |
|---|---|
| **Crowd model domain** | `LightweightCrowdNet` was fine-tuned on mall/urban datasets — accuracy may degrade for open-field events or fisheye cameras |
| **Crowd counting method** | Density map summation gives an estimated headcount, not individual bounding boxes; no tracking across frames |
| **Face recognition quality** | Matching accuracy heavily depends on photo quality submitted at report time and CCTV resolution |
| **RTSP browser limitation** | RTSP streams cannot be played directly in browsers; only HTTP/MJPEG stream URLs work in the current frontend |
| **Firestore quotas** | Free tier Firestore limits can cause `ResourceExhausted` errors during intensive background processing (backoff mitigates but doesn't eliminate) |
| **Deployment dependencies** | Model weight files (`*.pth`, `*.pt`) must be separately distributed to production servers — not committed to the repository |
| **InsightFace on Windows** | Requires Visual C++ Build Tools; fails silently and disables the missing-person module without it |
| **False positives** | Low confidence threshold (0.20) for fire/smoke prioritizes recall over precision — some false alerts possible |
| **Single notification per person** | The upsert model means only the latest detection is preserved; multiple concurrent detections for the same person are merged |

---

## 🔮 Future Enhancements

### 1. YOLOv8 Per-Person Detection & Crowd Tracking

**Current limitation:** `LightweightCrowdNet` produces a density map and sums it for an estimated headcount. It cannot detect individual bounding boxes or track movement.

**Proposed upgrade:** Replace with a YOLOv8-nano/small model configured for person detection.
- Each detected person gets a bounding box + unique tracking ID (using ByteTrack or SORT)
- Enables flow direction analysis (detecting crowd convergence vs. dispersal)
- Allows zone-based occupancy counting (e.g., Gate A has 120 people vs. Gate B has 340)
- Trajectory heatmaps can identify bottleneck chokepoints

---

### 2. Edge Computing Deployment

**Current limitation:** Frames are streamed from cameras to a central server for inference, consuming significant bandwidth and adding latency.

**Proposed upgrade:** Deploy lightweight model variants on edge nodes (Raspberry Pi 5, NVIDIA Jetson Orin Nano) physically co-located with camera clusters.
- Crowd and fire/smoke inference runs at the camera — only JSON results are sent to the cloud
- Reduces bandwidth from ~2 MB/frame to ~200 bytes/result
- Enables operation in low-connectivity environments (rural melas, forest events)
- Fleet management via a central edge dashboard

---

### 3. Asynchronous, Queue-Based Event Pipeline

**Current limitation:** Background processing runs as in-process Python daemon threads. If the Flask process crashes or restarts, in-flight processing is lost. Scaling requires running multiple processes.

**Proposed upgrade:** Replace with a distributed task queue.
- **Celery** workers consume tasks from **Redis** or **RabbitMQ**
- Camera processing tasks are published on a schedule; workers scale horizontally
- Failed tasks are retried automatically with backoff
- Dead-letter queue captures persistently failed tasks for investigation
- Separate queues for crowd (low priority) vs. face scan (high priority) vs. fire (critical)

---

### 4. Predictive Crowd Surge Modeling

**Current limitation:** The system reports current crowd density reactively. There is no forecasting.

**Proposed upgrade:** Add a time-series forecasting layer.
- Historical Firestore crowd data ingested into a time-series store (InfluxDB or BigQuery)
- LSTM / Prophet model trained per-camera on temporal patterns (event peaks, daily cycles)
- Predicted density shown on authority dashboard 10–30 minutes ahead
- Automatic pre-emptive alerts: "Camera 4 is predicted to reach CRITICAL in 18 minutes"

---

### 5. Multi-Modal Sensor Fusion

**Current limitation:** CrowdSafe relies entirely on visual CCTV. Cameras are blind in low-light, heavy rain, or smoke-obscured conditions.

**Proposed upgrade:** Integrate complementary IoT sensors.
- **Thermal cameras** — detect body heat for headcount in dark/smoke environments
- **Acoustic sensors** — detect crowd noise spikes, stampede sounds, screams
- **CO₂ / PM2.5 sensors** — detect fire by air quality degradation before visual smoke appears
- **Pressure mats** — footfall counting at entrances without camera blind spots

---

### 6. Mobile Citizen App (React Native)

**Current limitation:** Citizens access CrowdSafe via a browser-only SPA. On-the-ground reporting requires stable mobile web.

**Proposed upgrade:** A dedicated React Native app.
- Push notifications for published alerts and missing-person found confirmations
- Native camera integration for higher-quality missing-person photos
- Offline-first report drafting (sync when connectivity returns)
- Geolocation-aware alert filtering (show alerts near current location)

---

### 7. Automated Testing & Observability

**Current gap:** No automated test suite; debugging relies on server logs.

**Proposed additions:**

| Layer | Tool | Coverage |
|---|---|---|
| AI model unit tests | `pytest` + OpenCV test fixtures | Verify crowd/fire/face inference output shapes and thresholds |
| API contract tests | Postman collection + Newman CI | Assert all 25+ endpoints return correct status codes and response schemas |
| Lifecycle integration tests | `pytest` + Firebase emulator | Run full missing-person 8-step lifecycle against emulated Firestore |
| Structured logging | `python-json-logger` | Machine-parseable logs for every background thread cycle |
| Metrics | Prometheus + Grafana | Requests/sec, inference latency, detection confidence distributions |
| Distributed tracing | OpenTelemetry | Trace a frame from CCTV capture through inference to Firestore write |

---

### 8. Immutable Case Audit Trail

**Current limitation:** Missing-person case status transitions overwrite existing fields — there is no history of who changed what and when.

**Proposed upgrade:** Append-only event log per case.
- Each status transition creates a new document in `missing_persons/{id}/events/{timestamp}`
- Fields: `action`, `actor_uid`, `actor_role`, `previous_status`, `new_status`, `timestamp`
- Authority dashboard shows full case timeline
- Complies with evidence chain-of-custody requirements for law enforcement

---

## 👥 User Roles Summary

### Citizen
- View live crowd density map (colored camera pins by density level)
- Read published safety alerts
- Submit missing-person reports with photo
- Track status of their submitted cases
- Receive and respond to face-detection notifications
- Confirm/request-rescan detected persons

### Authority
- Everything citizens can see
- Add, edit, delete CCTV cameras; view stream health
- Create, publish, and resolve alerts (manually or from AI detections)
- Accept missing-person cases to start face scanning
- Review AI detections, inform citizens, or trigger rescans
- Perform final match confirmation to close cases
- Access crowd analytics and trends

---

## 🎬 Real-World Scenarios

The following scenarios walk through exactly how CrowdSafe operates end-to-end in realistic deployment environments.

---

### Scenario 1 — Kumbh Mela: Stampede Prevention at a River Ghat

> **Location:** Prayagraj, Uttar Pradesh, India  
> **Event:** Kumbh Mela main bathing day (estimated 10 million pilgrims)
> **Setup:** 40 IP cameras deployed across 8 ghats; 12 authority officers monitoring the CrowdSafe dashboard

**T+00:00** — Pilgrims begin arriving at Ghat 3 as the auspicious bath window opens. The CrowdSafe background thread processes 40 cameras every 20 seconds. `LightweightCrowdNet` reports Ghat 3 Camera 2 at count=187, level=`medium`.

**T+04:00** — The crowd at Ghat 3 doubles as buses arrive. Camera 2 reports count=290, level=`high`. Firestore updates instantly. The authority dashboard map pin for Camera 2 turns **orange**. The monitoring officer sees the change in real time without refreshing.

**T+06:20** — Count reaches 415: level=`critical`. The backend's meaningful-change guard detects the transition and writes to Firestore. The officer is automatically alerted by the now-**red** pin on the live map.

**T+06:45** — The authority officer creates a manual crowd alert:
```
POST /api/alerts/create
{ type: "crowd", severity: "critical", location_name: "Ghat 3",
  message: "Critical crowd density — divert incoming pilgrims to Ghat 5" }
```
Alert created with `published: false` — internal only.

**T+07:00** — After confirming with field personnel, the officer publishes the alert:
```
PUT /api/alerts/publish/{alert_id}
```
`published: true` — Firestore write triggers `onSnapshot` on every citizen's AlertsPanel within < 500ms. Citizens at the event see: _"⚠️ Critical crowd density at Ghat 3 — Please proceed to Ghat 5"_.

**T+18:00** — Crowd is diverted. Camera 2 count drops to 210, level=`medium`. Officer resolves the alert:
```
PUT /api/alerts/resolve/{alert_id}
```
Alert disappears from citizens' panels. Map pin returns to yellow.

**Outcome:** A potential stampede is prevented through a combination of AI density detection, real-time authority response, and instant citizen communication — all within an 18-minute window.

---

### Scenario 2 — Stadium Fire: Early Smoke Detection Before Evacuation Becomes Impossible

> **Location:** A 50,000-seat cricket stadium in Mumbai  
> **Event:** IPL final match, 92% capacity  
> **Setup:** 25 cameras covering stands, exits, food courts, and service corridors

**T+00:00** — A cooking stall fire starts in the service corridor behind Stand C. There is no direct human line of sight — only Camera 18, which monitors the service exit.

**T+00:35** — During the background processing cycle, `FireSmokeDetector` (YOLO) processes Camera 18's frame. Confidence for `smoke` class = 0.31, exceeding the 0.20 threshold.

```python
# Backend automatically:
image_url = upload_to_cloudinary(frame)  # evidence image saved
alerts_ref.document(alert_id).set({      # Firestore write
    'type': 'smoke', 'severity': 'critical',
    'camera_id': 'cam_018', 'location_name': 'Service Corridor C',
    'image_url': image_url, 'status': 'ACTIVE', 'published': False
})
```

**T+00:36** — Authority dashboard shows a new critical smoke alert with CCTV evidence image attached. The officer verifies visually from the dashboard — smoke is confirmed real.

**T+01:10** — Officer publishes the alert. All citizens in the stadium see: _"🔥 Smoke detected in Service Corridor C — Exit via Stands A and D"_.

**T+02:00** — Stand C evacuation begins. Fire services are dispatched. The fire is contained before spreading to the main stands.

**T+45:00** — Incident resolved. Officer marks alert resolved. Cloudinary evidence image retained for fire service report.

**Without CrowdSafe:** The corridor fire would have gone undetected until smoke became visible inside the stands (~8–10 minutes later), by which point 50,000 people rushing the same exits simultaneously would have created a secondary crowd emergency.

---

### Scenario 3 — Missing Child at a Public Fair

> **Location:** A state government mela (fair) in Jaipur, Rajasthan  
> **Event:** 3-day fair with approximately 80,000 daily visitors  
> **Setup:** 18 cameras across entry/exit gates, food courts, and main stage area

**T+00:00** — A father, Suresh (citizen account), reports his 7-year-old daughter Priya missing at the fair entrance. He opens CrowdSafe on his phone and submits:
```
POST /api/missing/report
Form: name="Priya", age=7, last_seen_location="East Entrance",
      last_seen_city="Jaipur", photo=<high_res_photo.jpg>, contact_phone="+91-98..."
```
The backend uploads the photo to Cloudinary, runs InsightFace on it, extracts her 512-dimensional embedding, and stores it in `missing_persons / {id}` with `search_active: false`.

**T+01:30** — The authority officer reviewing the case management dashboard sees the new report via `onSnapshot`. She reads the details and clicks **Accept Case**:
```
PUT /api/missing/cases/{priya_id}/accept
→ search_active: true
```

**T+01:31** — The `scan_missing_persons_continuously` background thread picks up Priya's case in its next cycle. It filters for cameras in `city: "Jaipur"` with `status: "active"` — finds 15 cameras. It captures frames from all 15 (with frame caching to avoid double-connects for the same camera). InsightFace runs Priya's embedding against each frame.

**T+08:40** — Camera 7 (Food Court North) frame contains a face that matches at cosine similarity = 0.81 (threshold: 0.50). Detection status: `"detected"`. The system upserts:
```
notifications/missing_person_detected_{priya_id}: {
  camera_id: "cam_007", location: "Food Court North",
  confidence: 0.81, confidence_percentage: 81.0,
  detection_status: "detected", visible_to_citizen: false
}
```

**T+08:41** — The authority officer sees the detection notification on her dashboard instantly. She reviews the bounding box and camera location. Satisfied with the confidence score, she clicks **Inform Citizen**:
```
PUT /api/missing/detections/{notif_id}/inform-citizen
→ visible_to_citizen: true
```

**T+08:42** — Suresh's notification panel updates instantly (Firestore → `onSnapshot`). He sees: _"Priya may have been spotted at Food Court North (81% match). Camera: Camera 7."_

**T+09:15** — Suresh reaches Food Court North and finds Priya. He clicks **Confirm Found**:
```
PUT /api/missing/cases/{priya_id}/citizen/confirm-found
→ status: "CONFIRMED_BY_CITIZEN"
```

**T+09:16** — Authority officer sees the citizen confirmation and does the final sign-off:
```
PUT /api/missing/cases/{priya_id}/authority/confirm-match
→ status: "MATCH_CONFIRMED", search_active: false
```
The background scanner stops searching for Priya. The case is closed in 9 minutes and 16 seconds from authority acceptance.

**Outcome:** Without CrowdSafe, a fair of 80,000 people makes visual search impractical. The automated face-scan across 18 cameras running every 10 seconds reduced the search to under 10 minutes.

---

<div align="center">

**Built for public safety — crowd events, festivals, and smart city monitoring**

</div>
