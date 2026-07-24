/* ==========================================================================
   ZGUARD - Firebase Realtime Database Client & Real-time Hooks
   ========================================================================== */

// Default Firebase Configuration Placeholder (User can update or inject via window.FIREBASE_CONFIG)
const defaultFirebaseConfig = {
    apiKey: "AIzaSyYOUR_API_KEY_HERE",
    authDomain: "zguard-iot.firebaseapp.com",
    databaseURL: "https://zguard-iot-default-rtdb.firebaseio.com",
    projectId: "zguard-iot",
    storageBucket: "zguard-iot.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abcdef123456"
};

// Global State Bus for Firebase Data
window.ZGUARD_STATE = {
    deviceId: "ESP32-01",
    connectionStatus: "waiting", // "waiting" | "live" | "offline"
    live: null,
    rfidLogs: [],
    securityEvents: [],
    aiIncidents: [],
    latestCommand: null,
    listeners: []
};

// State Change Subscribers
window.ZGUARD_SUBSCRIBERS = [];

function subscribeZGuardState(callback) {
    window.ZGUARD_SUBSCRIBERS.push(callback);
}

function notifySubscribers() {
    window.ZGUARD_SUBSCRIBERS.forEach(cb => cb(window.ZGUARD_STATE));
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
 * Initialize Firebase RTDB connection or fallback simulator
 */
function initFirebaseClient() {
    const config = window.FIREBASE_CONFIG || defaultFirebaseConfig;
    
    // Check if Firebase JS SDK is loaded via script tag
    if (window.firebase && window.firebase.database) {
        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(config);
            }
            const db = firebase.database();
            const deviceId = window.ZGUARD_STATE.deviceId;

            console.log(`[ZGuard Firebase] Subscribing to /devices/${deviceId}...`);

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
                
                // Trigger 3D Particle Burst on new security event
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

            // Periodically re-evaluate staleness every 3 seconds
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
            console.warn("[ZGuard Firebase] Initializing Firebase SDK failed or credentials invalid, using Demo Simulator:", err);
        }
    }

    // Fallback Demo Live Simulator if Firebase SDK is awaiting user credentials
    initDemoLiveSimulator();
}

/**
 * Send command to Firebase RTDB: /devices/{deviceId}/commands/latest
 */
function sendDeviceCommand(cmdType) {
    const deviceId = window.ZGUARD_STATE.deviceId;
    const payload = {
        cmd: cmdType, // "DISABLE_RELAY" | "ENABLE_RELAY"
        issued_at: Date.now()
    };

    if (window.firebase && window.firebase.apps.length) {
        firebase.database().ref(`/devices/${deviceId}/commands/latest`).set(payload);
    } else {
        console.log(`[ZGuard Command Demo] Sent command to ${deviceId}:`, payload);
        if (window.ZGUARD_STATE.live) {
            window.ZGUARD_STATE.live.relay_status = (cmdType === "DISABLE_RELAY") ? "OFF" : "ON";
            window.ZGUARD_STATE.latestCommand = payload;
            notifySubscribers();
        }
    }
}

/**
 * Demo Realtime Simulator to showcase live state & 3D particle bursts before Firebase credentials are inputted
 */
function initDemoLiveSimulator() {
    console.log("[ZGuard Simulator] Running Demo Simulator for ESP32-01...");
    
    // Initial State: Waiting for connection
    window.ZGUARD_STATE.connectionStatus = "waiting";
    notifySubscribers();

    // After 2.5 seconds: ESP32-01 comes online
    setTimeout(() => {
        window.ZGUARD_STATE.connectionStatus = "live";
        window.ZGUARD_STATE.live = {
            voltage: 228.4,
            current: 4.12,
            relay_status: "ON",
            motor_status: "RUNNING",
            rfid_last_uid: "A3-89-F1-02",
            rfid_last_status: "AUTHORIZED",
            online: true,
            last_seen: Date.now()
        };

        window.ZGUARD_STATE.rfidLogs = [
            { id: "log-1", uid: "A3-89-F1-02", status: "AUTHORIZED", user_name: "Operator Sarah", timestamp: Date.now() - 120000 },
            { id: "log-2", uid: "FF-44-12-88", status: "UNAUTHORIZED", user_name: null, timestamp: Date.now() - 300000 },
            { id: "log-3", uid: "8C-12-99-B0", status: "AUTHORIZED", user_name: "Tech Lead Alex", timestamp: Date.now() - 600000 }
        ];

        window.ZGUARD_STATE.securityEvents = [
            {
                id: "sec-1",
                type: "unauthorized_rfid_burst",
                severity: "warning",
                risk_score: 42,
                reason: "Multiple unauthorized RFID scans detected in 60s window.",
                recommendation: "Monitor zone closely or issue DISABLE_RELAY.",
                timestamp: Date.now() - 180000
            }
        ];

        notifySubscribers();
    }, 2500);

    // Heartbeat simulator every 2 seconds
    setInterval(() => {
        if (window.ZGUARD_STATE.live && window.ZGUARD_STATE.connectionStatus === "live") {
            window.ZGUARD_STATE.live.last_seen = Date.now();
            window.ZGUARD_STATE.live.voltage = (220 + Math.random() * 12).toFixed(1);
            window.ZGUARD_STATE.live.current = (3.8 + Math.random() * 0.8).toFixed(2);
            notifySubscribers();
        }
    }, 2000);
}
