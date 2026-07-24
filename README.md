# ZGuard — Single-Device Industrial IoT Zero Trust Security Dashboard

ZGuard is an industrial-grade Zero Trust security monitoring platform for single physical IoT/IIoT devices (e.g., ESP32 hardware gateways). It provides real-time telemetry inspection, 3D digital twin visualization, zero-trust RFID access logging, threshold fault detection, and automated AI threat analysis.

![ZGuard Topology](zguard_hero_network.jpg)

---

## 🌟 Key Architecture & Scope

- **Single Physical Device Scope**: Dedicated monitoring and remote control for exactly one hardware gateway (`ESP32-01`).
- **Firebase Realtime Database as Live Data Layer**: Direct client-side reading using Firebase Web SDK — no custom WebSocket or SQL server required.
- **3D Digital Twin**: Built with Three.js rendering an isometric node representation with dynamic risk glow rings (Green = Healthy, Amber = Warning, Red = Critical) and particle tamper burst animations.
- **Zero Trust Edge Enforcement**: ESP32 checks RFID scans against a local hardware whitelist before pushing audit logs to Firebase.
- **Autonomous AI Watcher Service**: Python backend (`backend/main.py`) watches RFID log streams for unauthorized bursts (≥3 scans in 60s), invokes LLM analysis, dispatches sub-second `DISABLE_RELAY` commands, and sends debounced Email/SMS notifications.

---

## 📁 Repository Structure

```
ZERO-TRUST/
├── index.html                   # Dashboard UI shell & live tab panels
├── styles.css                   # Cyber-security dark theme & 3D panel styling
├── app.js                       # Dashboard UI controller & tab navigation
├── firebase-config.js           # Firebase RTDB Web SDK client & state bus
├── device-twin-3d.js            # Three.js 3D Device Twin component
├── zguard_hero_network.jpg      # Network topology graphic
├── firmware/
│   ├── platformio.ini           # PlatformIO project configuration
│   ├── include/
│   │   └── secrets.h.example    # WiFi & Firebase credentials template
│   └── src/
│       └── main.cpp             # ESP32 C++ firmware source
└── backend/
    ├── main.py                  # Python AI watcher service & LLM threat engine
    ├── requirements.txt         # Python dependencies (firebase-admin, requests, etc.)
    └── .env.example             # Backend environment credentials template
```

---

## 🚀 Quick Start Guide

### 1. Dashboard Web UI Setup

1. Open `index.html` in any standard web browser (or serve via any static web server).
2. Click on the **Device Setup & Control** tab.
3. Enter your Firebase project credentials:
   - **Firebase API Key**
   - **Database URL** (e.g., `https://your-project-default-rtdb.firebaseio.com`)
   - **Project ID**
   - **Device ID** (default: `ESP32-01`)
4. Click **Save Credentials & Connect**. Credentials are stored locally in your browser (`localStorage`).
5. The dashboard will automatically connect and listen to real-time streams at `/devices/ESP32-01/live`, `/rfid_log`, `/security_events`, `/ai_incidents`, and `/commands/latest`.

---

### 2. ESP32 Firmware Setup (Arduino / PlatformIO)

1. Navigate to the `firmware/` directory.
2. Copy `firmware/include/secrets.h.example` to `firmware/include/secrets.h`:
   ```cpp
   #define WIFI_SSID "YOUR_WIFI_SSID"
   #define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
   #define FIREBASE_API_KEY "YOUR_FIREBASE_API_KEY"
   #define FIREBASE_DATABASE_URL "https://your-project-default-rtdb.firebaseio.com"
   ```
3. Connect your ESP32 hardware (MFRC522 RFID on SPI pins, Relay on GPIO 26, Motor Drive on GPIO 27, ADC sensors on pins 34 & 35).
4. Build and flash the firmware using PlatformIO or Arduino IDE with the `mobizt/Firebase-ESP-Client` library.

---

### 3. Python AI Security Watcher Service

1. Navigate to the `backend/` directory:
   ```bash
   cd backend
   ```
2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Copy `.env.example` to `.env`:
   ```env
   FIREBASE_SERVICE_ACCOUNT_PATH=serviceAccountKey.json
   FIREBASE_DB_URL=https://your-project-default-rtdb.firebaseio.com
   LLM_API_KEY=your_openai_or_anthropic_api_key
   SMTP_USER=alerts@company.com
   SMTP_PASS=your_app_password
   ALERT_EMAIL_TO=ciso@company.com
   ```
4. Place your Firebase Admin Service Account JSON file as `serviceAccountKey.json` in the `backend/` directory.
5. Run the watcher service:
   ```bash
   python main.py
   ```

---

## 🔒 Firebase Realtime Database Schema

```
/devices/{device_id}/live
    voltage: number
    current: number
    relay_status: "ON" | "OFF"
    motor_status: "RUNNING" | "STOPPED"
    rfid_last_uid: string
    rfid_last_status: "AUTHORIZED" | "UNAUTHORIZED"
    online: boolean
    last_seen: timestamp (server time)

/devices/{device_id}/rfid_log/{push_id}
    uid: string
    status: "AUTHORIZED" | "UNAUTHORIZED"
    user_name: string
    timestamp: timestamp

/devices/{device_id}/security_events/{push_id}
    type: "unauthorized_rfid_burst" | "voltage_fault" | "device_offline"
    severity: "warning" | "critical"
    risk_score: number
    reason: string
    recommendation: string
    timestamp: timestamp

/devices/{device_id}/ai_incidents/{push_id}
    agent: "security" | "predictive_maintenance"
    payload: object
    timestamp: timestamp

/devices/{device_id}/commands/latest
    cmd: "DISABLE_RELAY" | "ENABLE_RELAY"
    issued_at: timestamp
```

---

## 📜 License

© 2026 ZGuard Inc. All rights reserved. Industrial IoT Security Infrastructure.
