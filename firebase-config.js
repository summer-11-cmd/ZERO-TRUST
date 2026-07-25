/* ==========================================================================
   ZGUARD — Industrial Single-Device Firebase RTDB Client & State Bus
   ========================================================================== */

// Default / Stored Credentials Key in localStorage
const STORAGE_KEY = "zguard_firebase_credentials";

// Global State Bus for Single-Device ZGuard Dashboard
window.ZGUARD_STATE = {
    credentialsConfigured: false,
    deviceId: "ESP32-01",
    connectionStatus: "waiting", // "waiting" | "live" | "offline"
    live: null,
    rfidLogs: [],
    securityEvents: [],
    aiIncidents: [],
    
    // Live Computed Metrics
    healthScore: 100,
    isiScore: 100,
    isiAuthRatio: 100,
    isiFaultScore: 100,
    safeToOperate: true,
    unauthorizedToday: 0,
    onlineDevices: 0,
    
    // LLM Configured Flag
    llmConfigured: false
};

// Subscribers for UI updates
window.ZGUARD_SUBSCRIBERS = [];

function subscribeZGuardState(callback) {
    window.ZGUARD_SUBSCRIBERS.push(callback);
}

function notifySubscribers() {
    computeLiveMetrics();
    computeIsiScore();
    window.ZGUARD_SUBSCRIBERS.forEach(cb => cb(window.ZGUARD_STATE));
}

/**
 * Normalizes telemetry payloads written by ESP32 (e.g. /zguard, /live, /devices/ESP32-01)
 */
function normalizeLiveData(raw) {
    if (!raw || typeof raw !== 'object') return null;

    // Handle nested zguard object, live object, or direct object
    const data = raw.zguard || raw.live || raw["ESP32-01"] || raw;

    // Extract Motor Status ("Running", "RUNNING", "Stopped", "STOPPED")
    const rawMotor = (data["motor status"] || data.motorStatus || data.motor_status || "STOPPED").toString().toUpperCase();
    const motorStatus = (rawMotor === "RUNNING" || rawMotor === "ON") ? "RUNNING" : (rawMotor === "STOPPED" || rawMotor === "OFF" ? "STOPPED" : rawMotor);

    // Extract Relay Status
    const rawRelay = (data["relay status"] || data.relayStatus || data.relay_status || "ON").toString().toUpperCase();
    const relayStatus = (rawRelay === "OFF" || rawRelay === "CUT" || rawRelay === "DISABLED") ? "OFF" : "ON";

    // Extract Decision & Safe to Operate Flag
    const decisionStr = (data.decision || "").toString().toUpperCase();
    const isiVal = Number(data.isi ?? data.ISI ?? data.isi_score ?? data.isiScore ?? 100);
    const safeToOperate = (decisionStr === "SAFE TO OPERATE") || (data.safe_to_operate === true) || (data.safeToOperate === true) || (isiVal >= 70 && relayStatus !== "OFF");

    // Extract Health & Trust Score
    const healthScore = Number(data.healthScore ?? data["health score"] ?? data.trustScore ?? data["trust score"] ?? 100);

    // Set last_seen timestamp
    const lastSeen = data.last_seen || data.timestamp || Date.now();

    return {
        motor_status: motorStatus,
        relay_status: relayStatus,
        isi_score: isiVal,
        safe_to_operate: safeToOperate,
        decision: safeToOperate ? "SAFE TO OPERATE" : "UNSAFE TO OPERATE",
        health_score: healthScore,
        rfid_status: data.rfidStatus || data["Rfid status"] || "VALID",
        tamper_status: data.tamperStatus || data["Tamper status"] || "SAFE",
        last_seen: lastSeen
    };
}

/**
 * Recomputes System Health Score & Unauthorized Scans Today
 */
function computeLiveMetrics() {
    const live = window.ZGUARD_STATE.live;
    const rfidLogs = window.ZGUARD_STATE.rfidLogs;
    const secEvents = window.ZGUARD_STATE.securityEvents;

    // 1. Online Device Count
    window.ZGUARD_STATE.onlineDevices = (window.ZGUARD_STATE.connectionStatus === "live") ? 1 : 0;

    // 2. Compute Today's Unauthorized Scans Count
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();

    let unauthCount = 0;
    if (rfidLogs && rfidLogs.length) {
        rfidLogs.forEach(log => {
            const logTime = log.timestamp || 0;
            if (log.status === "UNAUTHORIZED" && logTime >= todayMs) {
                unauthCount++;
            }
        });
    }
    window.ZGUARD_STATE.unauthorizedToday = unauthCount;

    // 3. Health Score
    if (live && typeof live.health_score === 'number') {
        window.ZGUARD_STATE.healthScore = live.health_score;
    }
}

/**
 * Computes ISI — Industrial Security Index (0-100%)
 */
function computeIsiScore() {
    const rfidLogs = window.ZGUARD_STATE.rfidLogs || [];
    const connectionStatus = window.ZGUARD_STATE.connectionStatus;
    const live = window.ZGUARD_STATE.live;

    if (!live || connectionStatus !== "live") {
        return;
    }

    if (typeof live.isi_score === 'number') {
        window.ZGUARD_STATE.isiScore = Math.max(0, Math.min(100, live.isi_score));
        window.ZGUARD_STATE.safeToOperate = Boolean(live.safe_to_operate);
        return;
    }

    let authRatio = 100;
    if (rfidLogs.length > 0) {
        const authScans = rfidLogs.filter(l => l.status === "AUTHORIZED").length;
        authRatio = Math.round((authScans / rfidLogs.length) * 100);
    }
    window.ZGUARD_STATE.isiAuthRatio = authRatio;

    let faultScore = 100;
    if (live.relay_status === "OFF") faultScore -= 30;
    if (window.ZGUARD_STATE.unauthorizedToday > 0) faultScore -= Math.min(40, window.ZGUARD_STATE.unauthorizedToday * 10);
    window.ZGUARD_STATE.isiFaultScore = Math.max(0, faultScore);

    const composite = Math.round((authRatio * 0.6) + (window.ZGUARD_STATE.isiFaultScore * 0.4));
    window.ZGUARD_STATE.isiScore = Math.max(0, Math.min(100, composite));
    window.ZGUARD_STATE.safeToOperate = (window.ZGUARD_STATE.isiScore >= 70 && live.relay_status !== "OFF");
}

/**
 * Evaluates last_seen timestamp staleness (> 15s)
 */
function evaluateConnectionStatus(liveData) {
    if (!liveData) {
        return "waiting";
    }
    const now = Date.now();
    const lastSeenTime = typeof liveData.last_seen === 'number' ? liveData.last_seen : new Date(liveData.last_seen).getTime();
    const diffSeconds = (now - lastSeenTime) / 1000;

    if (diffSeconds > 15) {
        return "offline";
    }
    return "live";
}

const DEFAULT_CREDENTIALS = {
    apiKey: "AIzaSyBqiX3X0IP20UZrL-hAuBKbRH8jkq2HnLY",
    databaseURL: "https://z-guard-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "z-guard",
    deviceId: "ESP32-01"
};

/**
 * Load credentials from localStorage or fallback to default
 */
function getStoredCredentials() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed.databaseURL && !parsed.databaseURL.includes("your-app")) {
                return parsed;
            }
        }
    } catch (e) {
        console.warn("[ZGuard Creds] Reading localStorage failed:", e);
    }
    return DEFAULT_CREDENTIALS;
}

/**
 * Save user's Firebase project credentials to localStorage & initialize RTDB
 */
function saveFirebaseCredentials(apiKey, dbUrl, projectId, deviceId) {
    const creds = {
        apiKey: apiKey.trim(),
        databaseURL: dbUrl.trim(),
        projectId: projectId.trim(),
        deviceId: (deviceId || "ESP32-01").trim()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
    window.ZGUARD_STATE.deviceId = creds.deviceId;
    window.ZGUARD_STATE.credentialsConfigured = true;
    initFirebaseClient();
}

/**
 * Query Python Backend to check if LLM API Key is configured in .env
 */
function checkBackendLlmStatus() {
    fetch('http://localhost:5000/api/config/status')
        .then(res => res.json())
        .then(data => {
            if (data && typeof data.llm_configured === 'boolean') {
                window.ZGUARD_STATE.llmConfigured = data.llm_configured;
                notifySubscribers();
            }
        })
        .catch(err => {
            console.log("[ZGuard Config Check] Local Python backend API server not reachable on localhost:5000.");
        });
}

/**
 * Initialize Firebase RTDB connection using user's configured credentials
 */
function initFirebaseClient() {
    checkBackendLlmStatus();

    const creds = getStoredCredentials();
    if (!creds || !creds.apiKey || !creds.databaseURL) {
        console.log("[ZGuard Firebase] Waiting for user setup.");
        window.ZGUARD_STATE.credentialsConfigured = false;
        window.ZGUARD_STATE.connectionStatus = "waiting";
        notifySubscribers();
        return;
    }

    window.ZGUARD_STATE.credentialsConfigured = true;
    window.ZGUARD_STATE.deviceId = creds.deviceId || "ESP32-01";

    const config = {
        apiKey: creds.apiKey,
        authDomain: `${creds.projectId || 'z-guard'}.firebaseapp.com`,
        databaseURL: creds.databaseURL,
        projectId: creds.projectId || "z-guard"
    };

    if (window.firebase && window.firebase.database) {
        try {
            if (firebase.apps.length > 0) {
                firebase.app().delete().then(() => startFirebaseListeners(config)).catch(() => startFirebaseListeners(config));
            } else {
                startFirebaseListeners(config);
            }
        } catch (e) {
            console.error("[ZGuard RTDB Error]", e);
        }
    }
}

function startFirebaseListeners(config) {
    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(config);
        }
        const db = firebase.database();
        const deviceId = window.ZGUARD_STATE.deviceId;

        console.log(`[ZGuard RTDB] Connected to ${config.databaseURL}. Subscribing to RTDB telemetry...`);

        // Handler function for live snapshot updates
        const handleLiveSnapshot = (snapshot) => {
            const val = snapshot.val();
            if (val) {
                console.log("[ZGuard Realtime Telemetry Received]", val);
                const normalized = normalizeLiveData(val);
                if (normalized) {
                    window.ZGUARD_STATE.live = normalized;
                    window.ZGUARD_STATE.connectionStatus = "live";
                    window.ZGUARD_STATE.safeToOperate = normalized.safe_to_operate;
                    window.ZGUARD_STATE.isiScore = normalized.isi_score;
                    window.ZGUARD_STATE.healthScore = normalized.health_score;
                    notifySubscribers();
                }
            }
        };

        // Subscribe to root /, /zguard, /devices/{deviceId}/live, /live
        db.ref(`/zguard`).on('value', handleLiveSnapshot);
        db.ref(`/devices/${deviceId}/live`).on('value', handleLiveSnapshot);
        db.ref(`/live`).on('value', handleLiveSnapshot);
        db.ref(`/`).on('value', handleLiveSnapshot);

        // Handler function for rfid_log updates
        const handleRfidSnapshot = (snapshot) => {
            const val = snapshot.val();
            if (!val) return;
            const logs = [];
            if (Array.isArray(val)) {
                val.forEach((item, idx) => logs.unshift({ id: idx, ...item }));
            } else if (typeof val === 'object') {
                Object.keys(val).forEach(key => logs.unshift({ id: key, ...val[key] }));
            }
            window.ZGUARD_STATE.rfidLogs = logs;
            notifySubscribers();
        };

        db.ref(`/devices/${deviceId}/rfid_log`).limitToLast(50).on('value', handleRfidSnapshot);
        db.ref(`/zguard/rfid_log`).limitToLast(50).on('value', handleRfidSnapshot);
        db.ref(`/rfid_log`).limitToLast(50).on('value', handleRfidSnapshot);

        // Handler function for security_events
        const handleSecuritySnapshot = (snapshot) => {
            const val = snapshot.val();
            if (!val) return;
            const events = [];
            if (typeof val === 'object') {
                Object.keys(val).forEach(key => events.unshift({ id: key, ...val[key] }));
            }
            window.ZGUARD_STATE.securityEvents = events;
            if (window.triggerSecurityParticleBurst) {
                window.triggerSecurityParticleBurst();
            }
            notifySubscribers();
        };

        db.ref(`/devices/${deviceId}/security_events`).limitToLast(50).on('value', handleSecuritySnapshot);
        db.ref(`/zguard/security_events`).limitToLast(50).on('value', handleSecuritySnapshot);

        // Handler function for ai_incidents
        const handleAiSnapshot = (snapshot) => {
            const val = snapshot.val();
            if (!val) return;
            const incidents = [];
            if (typeof val === 'object') {
                Object.keys(val).forEach(key => incidents.unshift({ id: key, ...val[key] }));
            }
            window.ZGUARD_STATE.aiIncidents = incidents;
            notifySubscribers();
        };

        db.ref(`/devices/${deviceId}/ai_incidents`).limitToLast(20).on('value', handleAiSnapshot);
        db.ref(`/zguard/ai_incidents`).limitToLast(20).on('value', handleAiSnapshot);

        // Connection heartbeat monitor
        setInterval(() => {
            if (window.ZGUARD_STATE.live) {
                const newStatus = evaluateConnectionStatus(window.ZGUARD_STATE.live);
                if (newStatus !== window.ZGUARD_STATE.connectionStatus) {
                    window.ZGUARD_STATE.connectionStatus = newStatus;
                    notifySubscribers();
                }
            }
        }, 5000);

    } catch (e) {
        console.error("[ZGuard Listener Error]", e);
    }
}
