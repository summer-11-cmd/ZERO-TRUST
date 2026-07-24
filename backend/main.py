"""
ZGuard Python AI Security & Threat Analysis Watcher Service
- Single physical device watcher (/devices/{id})
- Listens to real-time Firebase telemetry and RFID audit logs
- Evaluates relay interlocks and heartbeat status thresholds
- Provides advisory LLM threat synthesis on unauthorized RFID burst windows
- Serves protected local HTTP config API on http://localhost:5000 to hot-reload LLM API key in .env
- Dispatches SMTP Email and optional Twilio SMS alerts matching format:
  ⚠️ ALERT
  {event_type}
  Device: {device_id}
  Time: {time}
  {action_taken}
"""

import os
import time
import json
import smtplib
from email.mime.text import MIMEText
from datetime import datetime
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

import firebase_admin
from firebase_admin import credentials, db
import requests
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

FIREBASE_SERVICE_ACCOUNT_PATH = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "serviceAccountKey.json")
FIREBASE_DB_URL = os.getenv("FIREBASE_DB_URL", "https://zguard-iot-default-rtdb.firebaseio.com")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")

# Email Alert Credentials
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
ALERT_EMAIL_TO = os.getenv("ALERT_EMAIL_TO", "")

# Optional Twilio SMS Credentials
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.getenv("TWILIO_FROM_NUMBER", "")
ALERT_SMS_TO = os.getenv("ALERT_SMS_TO", "")

# In-memory tracking for debouncing and burst detection
device_unauth_scans = {}  # { device_id: [timestamps] }
last_alert_time = {}      # { f"{device_id}_{event_type}": timestamp }

ALERT_COOLDOWN_SEC = 60

def init_firebase():
    """Initialize Firebase Admin SDK"""
    if not firebase_admin._apps:
        if os.path.exists(FIREBASE_SERVICE_ACCOUNT_PATH):
            cred = credentials.Certificate(FIREBASE_SERVICE_ACCOUNT_PATH)
            firebase_admin.initialize_app(cred, {'databaseURL': FIREBASE_DB_URL})
            print(f"[ZGuard Backend] Firebase Admin SDK initialized with {FIREBASE_SERVICE_ACCOUNT_PATH}")
        else:
            print(f"[ZGuard Backend] Note: '{FIREBASE_SERVICE_ACCOUNT_PATH}' not present. Using default DB URL listener.")
            firebase_admin.initialize_app(options={'databaseURL': FIREBASE_DB_URL})

def update_env_llm_key(new_key):
    """Updates or appends LLM_API_KEY in the backend .env file"""
    global LLM_API_KEY
    LLM_API_KEY = new_key.strip()
    
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    lines = []
    found = False
    
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("LLM_API_KEY="):
                    lines.append(f"LLM_API_KEY={LLM_API_KEY}\n")
                    found = True
                else:
                    lines.append(line)
    
    if not found:
        lines.append(f"\nLLM_API_KEY={LLM_API_KEY}\n")
        
    with open(env_path, "w", encoding="utf-8") as f:
        f.writelines(lines)
        
    print(f"[ZGuard Backend] Hot-reloaded LLM_API_KEY in .env file (Length: {len(LLM_API_KEY)})")

# --- Local Protected HTTP Config API Handler ---
class ConfigApiHandler(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/config/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
            payload = json.dumps({"llm_configured": bool(LLM_API_KEY.strip())})
            self.wfile.write(payload.encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/api/config/llm-key":
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode("utf-8"))
                api_key = data.get("api_key", "").strip()
                if api_key:
                    update_env_llm_key(api_key)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self._send_cors_headers()
                    self.end_headers()
                    res = json.dumps({"status": "success", "configured": True})
                    self.wfile.write(res.encode("utf-8"))
                else:
                    self.send_response(400)
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(b'{"status": "error", "message": "API key cannot be empty"}')
            except Exception as e:
                self.send_response(500)
                self._send_cors_headers()
                self.end_headers()
                res = json.dumps({"status": "error", "message": str(e)})
                self.wfile.write(res.encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        return # Silent HTTP logging

def start_config_api_server():
    """Runs lightweight local HTTP config API server on localhost:5000"""
    try:
        server = HTTPServer(("localhost", 5000), ConfigApiHandler)
        print("[ZGuard Backend API] Local Config Server running on http://localhost:5000")
        server.serve_forever()
    except Exception as err:
        print(f"[ZGuard Backend API Error] {err}")

def call_llm_security_analysis(device_id, recent_scans):
    """
    Calls LLM API for advisory security incident evaluation.
    Wrapped in try/except with a safe rule-based fallback.
    """
    try:
        if LLM_API_KEY:
            prompt = f"Analyze these unauthorized RFID scans on industrial IoT Device '{device_id}': {json.dumps(recent_scans)}. Output valid JSON with keys: risk_score (1-100), reason, recommendation."
            headers = {"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"}
            payload = {
                "model": "gpt-3.5-turbo",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2
            }
            res = requests.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload, timeout=8)
            if res.status_code == 200:
                content = res.json()['choices'][0]['message']['content']
                parsed = json.loads(content)
                return {
                    "risk_score": parsed.get("risk_score", 85),
                    "reason": parsed.get("reason", "Multiple unauthorized RFID burst scans detected."),
                    "recommendation": parsed.get("recommendation", "Advisory: Inspect edge gateway card reader.")
                }
    except Exception as e:
        print(f"[ZGuard LLM Fallback] {e}")

    # Deterministic Rule-Based Fallback
    scan_count = len(recent_scans)
    risk = min(98, 50 + scan_count * 15)
    return {
        "risk_score": risk,
        "reason": f"Zero Trust Violation: {scan_count} unauthorized RFID access attempts within 60 seconds.",
        "recommendation": "Advisory: Notify site security lead to verify operator credentials."
    }

def send_critical_alert(device_id, event_type, action_taken):
    """
    Dispatches Alert matching exact required format:
    ⚠️ ALERT
    {event_type}
    Device: {device_id}
    Time: {time}
    {action_taken}
    """
    key = f"{device_id}_{event_type}"
    now = time.time()
    if key in last_alert_time and (now - last_alert_time[key]) < ALERT_COOLDOWN_SEC:
        print(f"[Alert Debounced] Cooldown active for {key}")
        return

    last_alert_time[key] = now
    formatted_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    alert_text = f"""⚠️ ALERT
{event_type}
Device: {device_id}
Time: {formatted_time}
{action_taken}"""

    print(f"\n==================== CRITICAL SECURITY ALERT ====================\n{alert_text}\n=================================================================\n")

    # 1. SMTP Email Alert
    if SMTP_USER and SMTP_PASS and ALERT_EMAIL_TO:
        try:
            msg = MIMEText(alert_text)
            msg['Subject'] = f"⚠️ ALERT: {event_type} on {device_id}"
            msg['From'] = SMTP_USER
            msg['To'] = ALERT_EMAIL_TO

            with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
                server.starttls()
                server.login(SMTP_USER, SMTP_PASS)
                server.send_message(msg)
            print(f"[Email Alert] Dispatched to {ALERT_EMAIL_TO}")
        except Exception as err:
            print(f"[Email Alert Error] {err}")

    # 2. Twilio SMS Alert (Optional)
    if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER and ALERT_SMS_TO:
        try:
            url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
            auth = (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
            data = {
                "From": TWILIO_FROM_NUMBER,
                "To": ALERT_SMS_TO,
                "Body": alert_text
            }
            res = requests.post(url, data=data, auth=auth, timeout=8)
            if res.status_code in [200, 201]:
                print(f"[Twilio SMS Alert] Dispatched to {ALERT_SMS_TO}")
            else:
                print(f"[Twilio SMS Error] HTTP {res.status_code}: {res.text}")
        except Exception as err:
            print(f"[Twilio SMS Error] {err}")

def monitor_live_telemetry_loop():
    """Continuous background loop evaluating live relay state and heartbeat staleness"""
    while True:
        try:
            time.sleep(4)
            devices_ref = db.reference("/devices").get()
            if devices_ref and isinstance(devices_ref, dict):
                now_ms = time.time() * 1000
                for dev_id, dev_data in devices_ref.items():
                    live = dev_data.get("live", {})
                    if not live:
                        continue

                    relay_status = str(live.get("relay_status", "ON")).upper()
                    last_seen = live.get("last_seen", now_ms)
                    
                    if isinstance(last_seen, str):
                        try:
                            last_seen_ms = datetime.fromisoformat(last_seen).timestamp() * 1000
                        except Exception:
                            last_seen_ms = now_ms
                    else:
                        last_seen_ms = float(last_seen)

                    # Device Offline Trigger (last_seen > 10s)
                    stale_sec = (now_ms - last_seen_ms) / 1000.0
                    if stale_sec > 10:
                        send_critical_alert(dev_id, "Device Connection Offline", f"Action: Gateway heartbeat stale for {int(stale_sec)}s.")

                    # Relay Cut Trigger
                    if relay_status == "OFF":
                        send_critical_alert(dev_id, "Relay Circuit Open / Disabled", "Action: Hardware interlock trip logged.")

        except Exception as err:
            print(f"[Telemetry Loop Error] {err}")

def handle_rfid_event(event):
    """Callback triggered whenever RFID scan log data changes in RTDB"""
    try:
        data = event.data
        if not data or not isinstance(data, dict):
            return

        path_parts = event.path.strip("/").split("/")
        device_id = path_parts[1] if len(path_parts) > 1 else "ESP32-01"

        status = data.get("status", "")
        uid = data.get("uid", "")

        if status == "UNAUTHORIZED":
            now = time.time()
            if device_id not in device_unauth_scans:
                device_unauth_scans[device_id] = []

            device_unauth_scans[device_id].append({"uid": uid, "timestamp": now})
            device_unauth_scans[device_id] = [s for s in device_unauth_scans[device_id] if (now - s["timestamp"]) <= 60]

            scan_count = len(device_unauth_scans[device_id])
            print(f"[ZGuard Watcher] Unauthorized RFID scan on {device_id} (Scan #{scan_count} in 60s)")

            action_str = f"Action: Unauthorized card scan (UID: {uid}). Advisory risk logged."
            if scan_count >= 3:
                analysis = call_llm_security_analysis(device_id, device_unauth_scans[device_id])
                
                sec_event = {
                    "type": "unauthorized_rfid_burst",
                    "severity": "critical" if analysis["risk_score"] > 70 else "warning",
                    "risk_score": analysis["risk_score"],
                    "reason": analysis["reason"],
                    "recommendation": analysis["recommendation"],
                    "timestamp": {".sv": "timestamp"}
                }

                ai_incident = {
                    "agent": "security",
                    "payload": {
                        "unauthorized_scans": scan_count,
                        "risk_score": analysis["risk_score"],
                        "summary": analysis["reason"]
                    },
                    "timestamp": {".sv": "timestamp"}
                }

                db.reference(f"/devices/{device_id}/security_events").push(sec_event)
                db.reference(f"/devices/{device_id}/ai_incidents").push(ai_incident)

                # Advisory output only — no remote command actuation
                send_critical_alert(device_id, "Unauthorized RFID Burst Scan", action_str)
                device_unauth_scans[device_id] = []
            else:
                send_critical_alert(device_id, "Unauthorized RFID Scan", action_str)

    except Exception as e:
        print(f"[ZGuard Watcher Error] {e}")

def start_watcher():
    """Start listening to Firebase streams and local config API server"""
    init_firebase()
    print("[ZGuard Watcher Service] Started live monitoring on /devices...")

    # Start local Config API server thread
    api_thread = threading.Thread(target=start_config_api_server, daemon=True)
    api_thread.start()

    # Start live telemetry loop thread
    telem_thread = threading.Thread(target=monitor_live_telemetry_loop, daemon=True)
    telem_thread.start()

    # Listen to RFID logs
    try:
        db.reference("/devices").listen(handle_rfid_event)
    except Exception as e:
        print(f"[ZGuard Stream Listener] {e}")

if __name__ == "__main__":
    start_watcher()
    while True:
        time.sleep(1)
