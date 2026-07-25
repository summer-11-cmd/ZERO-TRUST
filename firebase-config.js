/* ==========================================================================
   ZGUARD — Single-Device Firebase RTDB Client & State Bus
   ========================================================================== */

// Default Credentials Key in localStorage
const STORAGE_KEY = "zguard_firebase_credentials";

// Canonical Region-Specific Database URL
const DEFAULT_CREDENTIALS = {
    apiKey: "AIzaSyBqiX3X0IP20UZrL-hAuBKbRH8jkq2HnLY",
    databaseURL: "https://z-guard-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "z-guard",
    deviceId: "ESP32-01"
};

// Global State Bus for Single-Device ZGuard Dashboard
window.ZGUARD_STATE = {
    credentialsConfigured: false,
    deviceId: "ESP32-01",
    connectionStatus: "waiting", // "waiting" | "live" | "offline"
    live: null,
    rfidLogs: [],
    securityEvents: [],
    aiIncidents: [],
    
    // Live Canonical Metrics
    healthScore: 100,
    isiScore: 100,
    trustScore: 100,
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
    window.ZGUARD_SUBSCRIBERS.forEach(cb => cb(window.ZGUARD_STATE));
}

/**
 * Parses telemetry payloads from /devices/ESP32-01/live, /zguard, /live or /
 */
function parseCanonicalLiveData(raw) {
    if (!raw || typeof raw !== 'object') return null;

    // Support nested zguard, live, ESP32-01 or direct object
    const data = raw.zguard || raw.live || raw["ESP32-01"] || raw;

    const rawMotor = (data.motorStatus || data["motor status"] || data.motor_status || "STOPPED").toString().toUpperCase();
    const motorStatus = (rawMotor === "RUNNING" || rawMotor === "ON") ? "RUNNING" : (rawMotor === "STOPPED" || rawMotor === "OFF" ? "STOPPED" : rawMotor);

    const rawRelay = (data.relayStatus || data["relay status"] || data.relay_status || "ON").toString().toUpperCase();
    const relayStatus = (rawRelay === "OFF" || rawRelay === "CUT" || rawRelay === "DISABLED") ? "OFF" : "ON";

    const decision = (data.decision || "ACCESS_DENIED").toString().toUpperCase();
    const rfidStatus = (data.rfidStatus || data["Rfid status"] || "UNKNOWN").toString().toUpperCase();
    const tamperStatus = (data.tamperStatus || data["Tamper status"] || "SAFE").toString().toUpperCase();

    const isi = Number(data.isi ?? data.ISI ?? data.isi_score ?? data.isiScore ?? 100);
    const healthScore = Number(data.healthScore ?? data["health score"] ?? data.trustScore ?? data["trust score"] ?? 100);
    const trustScore = Number(data.trustScore ?? data["trust score"] ?? 100);

    const safeToOperate = (decision === "ACCESS_GRANTED" || decision === "SAFE TO OPERATE") || (data.safe_to_operate === true) || (data.safeToOperate === true) || (isi >= 70 && decision !== "FAULT DETECTED" && relayStatus !== "OFF");
    const lastSeen = data.lastSeen || data.last_seen || data.timestamp || Date.now();

    return {
        healthScore: healthScore,
        isi: isi,
        trustScore: trustScore,
        rfidStatus: rfidStatus,
        tamperStatus: tamperStatus,
        motorStatus: motorStatus,
        decision: decision,
        safeToOperate: safeToOperate,
        relay_status: (safeToOperate) ? "ON" : "OFF",
        motor_status: motorStatus === "RUNNING" ? "RUNNING" : "STOPPED",
        lastSeen: lastSeen
    };
}

/**
 * Recomputes System Health Score & Unauthorized Scans Today
 */
function computeLiveMetrics() {
    const live = window.ZGUARD_STATE.live;
    const rfidLogs = window.ZGUARD_STATE.rfidLogs;

    // 1. Online Device Count
    window.ZGUARD_STATE.onlineDevices = (window.ZGUARD_STATE.connectionStatus === "live") ? 1 : 0;

    // 2. Unauthorized Scans Today Count
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

    if (live) {
        window.ZGUARD_STATE.healthScore = live.healthScore;
        window.ZGUARD_STATE.isiScore = live.isi;
        window.ZGUARD_STATE.trustScore = live.trustScore;
        window.ZGUARD_STATE.safeToOperate = live.safeToOperate;
    }
}

/**
 * Evaluates lastSeen timestamp staleness (> 15s)
 */
function evaluateConnectionStatus(liveData) {
    if (!liveData || !liveData.lastSeen) {
        return "waiting";
    }
    const now = Date.now();
    const lastSeenTime = typeof liveData.lastSeen === 'number' ? liveData.lastSeen : new Date(liveData.lastSeen).getTime();
    const diffSeconds = (now - lastSeenTime) / 1000;

    if (diffSeconds > 15) {
        return "offline";
    }
    return "live";
}

/**
 * Load credentials from localStorage or fallback to default
 */
function getStoredCredentials() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed.databaseURL && parsed.databaseURL.includes("asia-southeast1")) {
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
            console.log("[ZGuard Config Check] Local Python backend server not reachable on localhost:5000.");
        });
}

/**
 * Initialize Firebase RTDB connection
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

        console.log(`[ZGuard RTDB] Listening to ${config.databaseURL}...`);

        const handleLiveSnapshot = (snapshot) => {
            const val = snapshot.val();
            if (val) {
                console.log("[ZGuard Realtime Telemetry Received]", val);
                const canonical = parseCanonicalLiveData(val);
                if (canonical) {
                    window.ZGUARD_STATE.live = canonical;
                    window.ZGUARD_STATE.connectionStatus = evaluateConnectionStatus(canonical);
                    notifySubscribers();
                }
            }
        };

        // Listen to /devices/ESP32-01/live, /zguard, /live, and /
        db.ref(`/devices/${deviceId}/live`).on('value', handleLiveSnapshot);
        db.ref(`/zguard`).on('value', handleLiveSnapshot);
        db.ref(`/live`).on('value', handleLiveSnapshot);
        db.ref(`/`).on('value', handleLiveSnapshot);

        // Listen to rfid_log
        db.ref(`/devices/${deviceId}/rfid_log`).limitToLast(50).on('value', (snapshot) => {
            const val = snapshot.val();
            if (!val) return;
            const logs = [];
            if (typeof val === 'object') {
                Object.keys(val).forEach(key => logs.unshift({ id: key, ...val[key] }));
            }
            window.ZGUARD_STATE.rfidLogs = logs;
            notifySubscribers();
        });
        db.ref(`/zguard/rfid_log`).limitToLast(50).on('value', (snapshot) => {
            const val = snapshot.val();
            if (!val) return;
            const logs = [];
            if (typeof val === 'object') {
                Object.keys(val).forEach(key => logs.unshift({ id: key, ...val[key] }));
            }
            window.ZGUARD_STATE.rfidLogs = logs;
            notifySubscribers();
        });

        // Connection heartbeat monitor
        setInterval(() => {
            if (window.ZGUARD_STATE.live) {
                const newStatus = evaluateConnectionStatus(window.ZGUARD_STATE.live);
                if (newStatus !== window.ZGUARD_STATE.connectionStatus) {
                    window.ZGUARD_STATE.connectionStatus = newStatus;
                    notifySubscribers();
                }
            }
        }, 3000);

    } catch (e) {
        console.error("[ZGuard Listener Error]", e);
    }
}
