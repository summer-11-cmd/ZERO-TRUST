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

    // 3. Compute Live Health Score (100 Base)
    if (!live || window.ZGUARD_STATE.connectionStatus !== "live") {
        window.ZGUARD_STATE.healthScore = 0;
        return;
    }

    let score = 100;
    if (live.relay_status === "OFF") score -= 15;
    score -= (unauthCount * 5);

    if (secEvents && secEvents.length) {
        secEvents.forEach(ev => {
            if (ev.severity === "critical") score -= 25;
            else if (ev.severity === "warning") score -= 10;
        });
    }

    window.ZGUARD_STATE.healthScore = Math.max(0, Math.min(100, score));
}

/**
 * Computes ISI — Industrial Security Index (0-100%)
 * Composite score combining Zero-Trust Auth Ratio (60%) and Fault Status (40%)
 */
function computeIsiScore() {
    const rfidLogs = window.ZGUARD_STATE.rfidLogs || [];
    const connectionStatus = window.ZGUARD_STATE.connectionStatus;
    const live = window.ZGUARD_STATE.live;

    if (!live || connectionStatus !== "live") {
        window.ZGUARD_STATE.isiScore = 0;
        window.ZGUARD_STATE.isiAuthRatio = 0;
        window.ZGUARD_STATE.isiFaultScore = 0;
        window.ZGUARD_STATE.safeToOperate = false;
        return;
    }

    // Check if Firebase RTDB live node has server-evaluated isi_score & safe_to_operate
    if (typeof live.isi_score === 'number' && typeof live.safe_to_operate !== 'undefined') {
        window.ZGUARD_STATE.isiScore = Math.max(0, Math.min(100, live.isi_score));
        window.ZGUARD_STATE.safeToOperate = Boolean(live.safe_to_operate);
        return;
    }

    // 1. Zero-Trust Auth Ratio Component
    let authRatio = 100;
    if (rfidLogs.length > 0) {
        const authScans = rfidLogs.filter(l => l.status === "AUTHORIZED").length;
        authRatio = Math.round((authScans / rfidLogs.length) * 100);
    }
    window.ZGUARD_STATE.isiAuthRatio = authRatio;

    // 2. Fault Severity Component
    let faultScore = 100;
    if (live.relay_status === "OFF") faultScore -= 30;
    if (window.ZGUARD_STATE.unauthorizedToday > 0) faultScore -= Math.min(40, window.ZGUARD_STATE.unauthorizedToday * 10);
    window.ZGUARD_STATE.isiFaultScore = Math.max(0, faultScore);

    // 3. Composite ISI Score (60% Auth Ratio + 40% Fault Score)
    const composite = Math.round((authRatio * 0.6) + (window.ZGUARD_STATE.isiFaultScore * 0.4));
    window.ZGUARD_STATE.isiScore = Math.max(0, Math.min(100, composite));

    // 4. Safe To Operate Flag (ISI >= 70 & Relay != OFF)
    window.ZGUARD_STATE.safeToOperate = (window.ZGUARD_STATE.isiScore >= 70 && live.relay_status !== "OFF");
}

/**
 * Evaluates last_seen timestamp staleness (> 10s)
 */
function evaluateConnectionStatus(liveData) {
    if (!liveData || !liveData.last_seen) {
        return "waiting";
    }
    const now = Date.now();
    const lastSeenTime = typeof liveData.last_seen === 'number' ? liveData.last_seen : new Date(liveData.last_seen).getTime();
    const diffSeconds = (now - lastSeenTime) / 1000;

    if (diffSeconds > 10) {
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
        if (stored) return JSON.parse(stored);
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
        console.log("[ZGuard Firebase] No credentials configured. Waiting for user setup.");
        window.ZGUARD_STATE.credentialsConfigured = false;
        window.ZGUARD_STATE.connectionStatus = "waiting";
        notifySubscribers();
        return;
    }

    window.ZGUARD_STATE.credentialsConfigured = true;
    window.ZGUARD_STATE.deviceId = creds.deviceId || "ESP32-01";

    const config = {
        apiKey: creds.apiKey,
        authDomain: `${creds.projectId || 'zguard-iot'}.firebaseapp.com`,
        databaseURL: creds.databaseURL,
        projectId: creds.projectId || "zguard-iot"
    };

    if (window.firebase && window.firebase.database) {
        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(config);
            }
            const db = firebase.database();
            const deviceId = window.ZGUARD_STATE.deviceId;

            console.log(`[ZGuard RTDB] Listening to /devices/${deviceId}...`);

            // Listen to /devices/{deviceId}/live
            db.ref(`/devices/${deviceId}/live`).on('value', (snapshot) => {
                const data = snapshot.val();
                window.ZGUARD_STATE.live = data;
                window.ZGUARD_STATE.connectionStatus = evaluateConnectionStatus(data);
                notifySubscribers();
            });

            // Listen to /devices/{deviceId}/rfid_log (limit to last 50)
            db.ref(`/devices/${deviceId}/rfid_log`).limitToLast(50).on('value', (snapshot) => {
                const logs = [];
                snapshot.forEach(child => {
                    logs.unshift({ id: child.key, ...child.val() });
                });
                window.ZGUARD_STATE.rfidLogs = logs;
                notifySubscribers();
            });

            // Listen to /devices/{deviceId}/security_events (limit to last 50)
            db.ref(`/devices/${deviceId}/security_events`).limitToLast(50).on('value', (snapshot) => {
                const events = [];
                snapshot.forEach(child => {
                    events.unshift({ id: child.key, ...child.val() });
                });
                window.ZGUARD_STATE.securityEvents = events;
                if (window.triggerSecurityParticleBurst) {
                    window.triggerSecurityParticleBurst();
                }
                notifySubscribers();
            });

            // Listen to /devices/{deviceId}/ai_incidents
            db.ref(`/devices/${deviceId}/ai_incidents`).limitToLast(20).on('value', (snapshot) => {
                const incidents = [];
                snapshot.forEach(child => {
                    incidents.unshift({ id: child.key, ...child.val() });
                });
                window.ZGUARD_STATE.aiIncidents = incidents;
                notifySubscribers();
            });

            // Periodically check connection staleness every 3s
            setInterval(() => {
                if (window.ZGUARD_STATE.live) {
                    const newStatus = evaluateConnectionStatus(window.ZGUARD_STATE.live);
                    if (newStatus !== window.ZGUARD_STATE.connectionStatus) {
                        window.ZGUARD_STATE.connectionStatus = newStatus;
                        notifySubscribers();
                    }
                }
            }, 3000);

            return;
        } catch (err) {
            console.error("[ZGuard RTDB Error] Failed to initialize Firebase SDK:", err);
        }
    } else {
        console.warn("[ZGuard RTDB] Firebase JS SDK not found on window object.");
    }
}
