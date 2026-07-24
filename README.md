# ZGuard — Single-Device Industrial IoT Zero Trust Security Dashboard

ZGuard is a light, professional, industrial-grade Zero Trust security monitoring platform for single physical IoT/IIoT devices (e.g., ESP32 hardware gateways). It provides real-time telemetry inspection, animated 3D digital twin visualization, an Industrial Security Index (ISI) score, zero-trust RFID access logging, threshold fault detection, and advisory AI threat analysis.

![ZGuard Topology](zguard_hero_network.jpg)

---

## 🌟 Key Architecture & Scope

- **Single Physical Device Scope**: Dedicated monitoring for exactly one hardware gateway (`ESP32-01`).
- **Clean Professional Light Theme**: Built with white/slate card systems, Inter typography, left-aligned card metrics, right-aligned numerical table columns, and restrained semantic status colors.
- **Industrial Security Index (ISI)**: Prominent 0–100% composite score card evaluating zero-trust authorization ratio and active fault severity.
- **3D Digital Twin with Animated DC Motor**: Built with Three.js rendering an isometric board representation with a DC Motor rotor that spins continuously while `motor_status === "RUNNING"` and stays stationary when `"STOPPED"`.
- **Firebase Realtime Database as Live Data Layer**: Direct client-side reading using Firebase Web SDK — no custom WebSocket or SQL server required.
- **Backend API Key Management**: Built-in Settings modal allowing operators to enter an LLM API Key, which is sent securely to a local Python API endpoint (`http://localhost:5000/api/config/llm-key`) to update the server-side `.env` file and hot-reload in memory.
- **Advisory AI Threat Watcher**: Python backend (`backend/main.py`) watches RFID log streams for unauthorized bursts (≥3 scans in 60s), invokes LLM analysis, and dispatches debounced Email/SMS notifications.

---

## 📁 Repository Structure

```
ZERO-TRUST/
├── index.html                   # Dashboard UI shell & live tab panels (Light Theme)
├── styles.css                   # Professional light industrial CSS styling
├── app.js                       # Dashboard UI controller, ISI score rendering, settings modal
├── firebase-config.js           # Firebase RTDB Web SDK client & state bus
├── device-twin-3d.js            # Three.js 3D Device Twin component with DC Motor animation
├── zguard_hero_network.jpg      # Network topology graphic
├── firmware/
│   ├── platformio.ini           # PlatformIO project configuration
│   ├── include/
│   │   └── secrets.h.example    # WiFi & Firebase credentials template
│   └── src/
│       └── main.cpp             # ESP32 C++ firmware source
└── backend/
    ├── main.py                  # Python AI watcher service & HTTP config API server
    ├── requirements.txt         # Python dependencies
    └── .env.example             # Backend environment credentials template
```

---

## 🚀 Quick Start Guide

### 1. Dashboard Web UI Setup

1. Open `index.html` in any standard web browser (or serve via any static web server).
2. Click on the **Device Setup & Live Telemetry** tab.
3. Enter your Firebase project credentials:
   - **Firebase API Key**
   - **Database URL** (e.g., `https://your-project-default-rtdb.firebaseio.com`)
   - **Project ID**
   - **Device ID** (default: `ESP32-01`)
4. Click **Save Credentials & Connect**. Credentials are stored locally in your browser (`localStorage`).
5. Click **Settings** in the header to enter your OpenAI LLM API Key for real-time AI security analysis.

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
3. Connect your ESP32 hardware (MFRC522 RFID on SPI pins, Relay on GPIO 26, Motor Drive on GPIO 27).
4. Build and flash the firmware using PlatformIO or Arduino IDE with the `mobizt/Firebase-ESP-Client` library.

---

### 3. Python AI Security Watcher & Config Server

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
4. Run the watcher service and API server:
   ```bash
   python main.py
   ```

---

## 🔒 Firebase Realtime Database Schema

```
/devices/{device_id}/live
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
    type: "unauthorized_rfid_burst" | "device_offline"
    severity: "warning" | "critical"
    risk_score: number
    reason: string
    recommendation: string
    timestamp: timestamp

/devices/{device_id}/ai_incidents/{push_id}
    agent: "security" | "predictive_maintenance"
    payload: object
    timestamp: timestamp
```

---

## 📜 License

© 2026 ZGuard Inc. All rights reserved. Industrial IoT Security Infrastructure.
