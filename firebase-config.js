/* ==========================================================================
   ZGUARD — Industrial Single-Device Firebase RTDB Client & Realtime Engine
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
    latestCommand: null,
    
    // Live Computed Metrics
    healthScore: 100,
    unauthorizedToday: 0,
    trustedDevices: 1,
    onlineDevices: 0
};

// Subscribers for UI updates
window.ZGUARD_SUBSCRIBERS = [];

function subscribeZGuardState(callback) {
    window.ZGUARD_SUBSCRIBERS.push(callback);
}

function notifySubscribers() {
    // Recompute Live Health Metrics from Real Data
    computeLiveMetrics();
    window.ZGUARD_SUBSCRIBERS.forEach(cb => cb(window.ZGUARD_STATE));
}

/**
 * Recomputes System Health Score & Unauthorized Attempts Today from real Firebase state
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
        window.ZGUARD_STATE.healthScore = 0; // 0 if no device connected / offline
        return;
    }

    let score = 100;
    const voltage = parseFloat(live.voltage) || 220;
    const current = parseFloat(live.current) || 4.0;

    // Deduct for voltage/current anomalies
    if (voltage > 245 || voltage < 205) score -= 15;
    if (current > 7.0) score -= 20;
    if (live.relay_status === "OFF") score -= 10;

    // Deduct for unauthorized scans
    score -= (unauthCount * 5);

    // Deduct for active critical security events
    if (secEvents && secEvents.length) {
        secEvents.forEach(ev => {
            if (ev.severity === "critical") score -= 25;
            else if (ev.severity === "warning") score -= 10;
        });
    }

    window.ZGUARD_STATE.healthScore = Math.max(0, Math.min(100, score));
}

/**
 * Checks if the last_seen timestamp is stale (> 10 seconds old)
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

/**
 * Load credentials from localStorage
 */
function getStoredCredentials() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) return JSON.parse(stored);
    } catch (e) {
        console.warn("[ZGuard Creds] Reading localStorage failed:", e);
    }
    return null;
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
 * Initialize Firebase RTDB connection using user's configured credentials
 */
function initFirebaseClient() {
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

            console.log(`[ZGuard RTDB] Connected to /devices/${deviceId}...`);

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

            // Listen to /devices/{deviceId}/commands/latest
            db.ref(`/devices/${deviceId}/commands/latest`).on('value', (snapshot) => {
                window.ZGUARD_STATE.latestCommand = snapshot.val();
                notifySubscribers();
            });

            // Periodically check staleness every 3s
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

/**
 * Dispatch hardware control command: /devices/{deviceId}/commands/latest
 */
function sendDeviceCommand(cmdType) {
    const deviceId = window.ZGUARD_STATE.deviceId;
    const payload = {
        cmd: cmdType, // "DISABLE_RELAY" | "ENABLE_RELAY"
        issued_at: Date.now()
    };

    if (window.firebase && window.firebase.apps && window.firebase.apps.length) {
        firebase.database().ref(`/devices/${deviceId}/commands/latest`).set(payload);
        console.log(`[ZGuard Command Dispatch] Pushed ${cmdType} to /devices/${deviceId}/commands/latest`);
    } else {
        console.warn("[ZGuard Command] Firebase connection not active. Cannot send command.");
    }
}
