/* ==========================================================================
   ZGUARD — Industrial Single-Device Security Dashboard UI Controller
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    initNavigationTabs();
    initSetupForm();
    initRfidLogFilters();
    initMobileNav();

    // Initialize 3D Device Twin Canvas Panel
    init3DDeviceTwin('deviceTwinContainer');

    // Initialize Firebase Client & Subscribe to State Bus
    initFirebaseClient();
    subscribeZGuardState(renderZGuardUI);
});

/* ==========================================================================
   1. Tab Navigation Controller
   ========================================================================== */
function initNavigationTabs() {
    const tabBtns = document.querySelectorAll('.nav-tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.tab;

            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            const targetPane = document.getElementById(targetId);
            if (targetPane) targetPane.classList.add('active');
        });
    });
}

/* ==========================================================================
   2. Device Setup Credentials Form Controller
   ========================================================================== */
function initSetupForm() {
    const form = document.getElementById('setupForm');
    const apiKeyInput = document.getElementById('cfgApiKey');
    const dbUrlInput = document.getElementById('cfgDbUrl');
    const projectIdInput = document.getElementById('cfgProjectId');
    const deviceIdInput = document.getElementById('cfgDeviceId');

    // Auto-fill stored credentials if existing in localStorage
    const stored = getStoredCredentials();
    if (stored) {
        if (apiKeyInput) apiKeyInput.value = stored.apiKey || "";
        if (dbUrlInput) dbUrlInput.value = stored.databaseURL || "";
        if (projectIdInput) projectIdInput.value = stored.projectId || "";
        if (deviceIdInput) deviceIdInput.value = stored.deviceId || "ESP32-01";
    }

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const apiKey = apiKeyInput.value.trim();
            const dbUrl = dbUrlInput.value.trim();
            const projectId = projectIdInput.value.trim();
            const deviceId = deviceIdInput.value.trim() || "ESP32-01";

            if (!apiKey || !dbUrl) {
                alert("Please enter a valid Firebase API Key and Database URL.");
                return;
            }

            saveFirebaseCredentials(apiKey, dbUrl, projectId, deviceId);
            alert(`Firebase credentials saved! Listening to target device: ${deviceId}`);
        });
    }
}

/* ==========================================================================
   3. Realtime UI Renderer & State Subscriber
   ========================================================================== */
function renderZGuardUI(state) {
    const statusPill = document.getElementById('globalStatusPill');
    const statusText = document.getElementById('connectionStatusText');
    const targetDeviceTag = document.getElementById('targetDeviceTag');
    const footerDevId = document.getElementById('footerDevId');
    const monConnIndicator = document.getElementById('monConnIndicator');

    if (targetDeviceTag) targetDeviceTag.textContent = state.deviceId;
    if (footerDevId) footerDevId.textContent = state.deviceId;

    // A. Connection State Handling
    if (state.connectionStatus === "waiting") {
        if (statusPill) statusPill.className = "badge-pill";
        if (statusText) statusText.textContent = `Waiting for ${state.deviceId} connection...`;
        if (monConnIndicator) monConnIndicator.textContent = `Waiting for ${state.deviceId} connection...`;
    } 
    else if (state.connectionStatus === "live") {
        if (statusPill) statusPill.className = "badge-pill status-live";
        if (statusText) statusText.textContent = `Live (${state.deviceId} Connected)`;
        if (monConnIndicator) {
            monConnIndicator.textContent = `LIVE TELEMETRY (${state.deviceId})`;
            monConnIndicator.className = "connection-state-indicator text-emerald";
        }
    } 
    else if (state.connectionStatus === "offline") {
        if (statusPill) statusPill.className = "badge-pill status-offline";
        if (statusText) statusText.textContent = `Offline (${state.deviceId} Stale >10s)`;
        if (monConnIndicator) {
            monConnIndicator.textContent = `DEVICE OFFLINE (${state.deviceId})`;
            monConnIndicator.className = "connection-state-indicator text-amber";
        }
    }

    // B. Overview Page Metrics
    const ovHealth = document.getElementById('overviewHealthScore');
    const ovOnline = document.getElementById('overviewOnlineDevices');
    const ovTrusted = document.getElementById('overviewTrustedDevices');
    const ovUnauth = document.getElementById('overviewUnauthCount');

    if (ovHealth) ovHealth.textContent = `${state.healthScore} %`;
    if (ovOnline) ovOnline.textContent = `${state.onlineDevices} / 1`;
    if (ovTrusted) ovTrusted.textContent = `${state.trustedDevices}`;
    if (ovUnauth) ovUnauth.textContent = `${state.unauthorizedToday}`;

    // C. 3D Twin Sidebar & Risk Ring
    const twinDevId = document.getElementById('twinDevId');
    const twinVolts = document.getElementById('twinVolts');
    const twinCurrent = document.getElementById('twinCurrent');
    const twinRelay = document.getElementById('twinRelay');
    const twinMotor = document.getElementById('twinMotor');
    const twinLastSeen = document.getElementById('twinLastSeen');
    const twinRiskBadge = document.getElementById('twinRiskBadge');

    if (twinDevId) twinDevId.textContent = state.deviceId;
    if (state.live) {
        if (twinVolts) twinVolts.textContent = `${state.live.voltage || '--'} V`;
        if (twinCurrent) twinCurrent.textContent = `${state.live.current || '--'} A`;
        if (twinRelay) twinRelay.textContent = state.live.relay_status || '--';
        if (twinMotor) twinMotor.textContent = state.live.motor_status || '--';
        if (twinLastSeen) {
            const timeStr = state.live.last_seen ? new Date(state.live.last_seen).toLocaleTimeString() : '--';
            twinLastSeen.textContent = timeStr;
        }
    }

    // D. Monitoring Panel Telemetry & Remote Control Buttons
    const monVoltage = document.getElementById('monVoltage');
    const monCurrent = document.getElementById('monCurrent');
    const monRelay = document.getElementById('monRelay');
    const monMotor = document.getElementById('monMotor');
    const btnCutRelayMain = document.getElementById('btnCutRelayMain');
    const btnEnableRelayMain = document.getElementById('btnEnableRelayMain');

    if (state.live) {
        if (monVoltage) monVoltage.textContent = `${state.live.voltage || '--'} V`;
        if (monCurrent) monCurrent.textContent = `${state.live.current || '--'} A`;
        if (monRelay) {
            monRelay.textContent = state.live.relay_status || '--';
            monRelay.className = state.live.relay_status === "ON" ? "mini-value text-emerald" : "mini-value text-rose";
        }
        if (monMotor) {
            monMotor.textContent = state.live.motor_status || '--';
            monMotor.className = state.live.motor_status === "RUNNING" ? "mini-value text-emerald" : "mini-value text-dim";
        }
    }

    if (btnCutRelayMain) {
        btnCutRelayMain.onclick = () => sendDeviceCommand("DISABLE_RELAY");
    }
    if (btnEnableRelayMain) {
        btnEnableRelayMain.onclick = () => sendDeviceCommand("ENABLE_RELAY");
    }

    // E. Render RFID Logs & Filters
    renderFilteredRfidLogs(state.rfidLogs);

    // F. Render Fault Detection Status
    renderFaultDetection(state);

    // G. Render AI Agents & Event Stream
    renderAiAgents(state);
}

/* ==========================================================================
   4. Real-time RFID Log Table Renderer with Search & Status Filters
   ========================================================================== */
function initRfidLogFilters() {
    const searchInput = document.getElementById('filterSearch');
    const dateInput = document.getElementById('filterDate');
    const statusSelect = document.getElementById('filterStatus');
    const resetBtn = document.getElementById('btnResetFilters');

    if (searchInput) searchInput.addEventListener('input', () => renderFilteredRfidLogs(window.ZGUARD_STATE.rfidLogs));
    if (dateInput) dateInput.addEventListener('change', () => renderFilteredRfidLogs(window.ZGUARD_STATE.rfidLogs));
    if (statusSelect) statusSelect.addEventListener('change', () => renderFilteredRfidLogs(window.ZGUARD_STATE.rfidLogs));
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = "";
            if (dateInput) dateInput.value = "";
            if (statusSelect) statusSelect.value = "ALL";
            renderFilteredRfidLogs(window.ZGUARD_STATE.rfidLogs);
        });
    }
}

function renderFilteredRfidLogs(logs) {
    const tableBody = document.getElementById('rfidTableBody');
    const badge = document.getElementById('rfidLogCountBadge');
    const searchInput = document.getElementById('filterSearch');
    const dateInput = document.getElementById('filterDate');
    const statusSelect = document.getElementById('filterStatus');

    if (!tableBody) return;

    let filtered = logs || [];

    // Filter by Search Query (UID or User Name)
    if (searchInput && searchInput.value.trim()) {
        const q = searchInput.value.trim().toLowerCase();
        filtered = filtered.filter(l => 
            (l.uid && l.uid.toLowerCase().includes(q)) || 
            (l.user_name && l.user_name.toLowerCase().includes(q))
        );
    }

    // Filter by Date (YYYY-MM-DD)
    if (dateInput && dateInput.value) {
        const targetDateStr = dateInput.value;
        filtered = filtered.filter(l => {
            if (!l.timestamp) return false;
            const logDate = new Date(l.timestamp);
            const yyyy = logDate.getFullYear();
            const mm = String(logDate.getMonth() + 1).padStart(2, '0');
            const dd = String(logDate.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}` === targetDateStr;
        });
    }

    // Filter by Status (AUTHORIZED / UNAUTHORIZED)
    if (statusSelect && statusSelect.value !== "ALL") {
        filtered = filtered.filter(l => l.status === statusSelect.value);
    }

    if (badge) badge.textContent = `${filtered.length} Logs`;

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No matching RFID scan logs found.</td></tr>`;
        return;
    }

    tableBody.innerHTML = filtered.map(l => {
        const timeObj = l.timestamp ? new Date(l.timestamp) : new Date();
        const timeStr = timeObj.toLocaleTimeString();
        const dateStr = timeObj.toLocaleDateString();
        const statusClass = l.status === "AUTHORIZED" ? "authorized" : "unauthorized";

        return `
            <tr>
                <td class="font-mono text-dim">${timeStr}</td>
                <td class="font-mono text-dim">${dateStr}</td>
                <td class="font-mono text-cyan">${l.uid || 'N/A'}</td>
                <td>${l.user_name || 'Operator'}</td>
                <td><span class="status-badge-cell ${statusClass}">${l.status}</span></td>
                <td class="font-mono text-dim">${window.ZGUARD_STATE.deviceId}</td>
            </tr>
        `;
    }).join('');
}

/* ==========================================================================
   5. Fault Detection Renderer
   ========================================================================== */
function renderFaultDetection(state) {
    const overallStatus = document.getElementById('faultOverallStatus');
    const vStatus = document.getElementById('faultVoltageStatus');
    const cStatus = document.getElementById('faultCurrentStatus');
    const rfidBurstStatus = document.getElementById('faultRfidBurstStatus');
    const offStatus = document.getElementById('faultOfflineStatus');

    const live = state.live;
    let isFault = false;

    // 1. Connection Status Check
    if (state.connectionStatus === "offline") {
        if (offStatus) { offStatus.textContent = "ALARM: Device Offline (>10s Stale)"; offStatus.className = "fault-status text-rose"; }
        isFault = true;
    } else if (state.connectionStatus === "live") {
        if (offStatus) { offStatus.textContent = "Normal (Heartbeat Active)"; offStatus.className = "fault-status text-emerald"; }
    } else {
        if (offStatus) { offStatus.textContent = "Waiting for Connection"; offStatus.className = "fault-status text-amber"; }
    }

    // 2. Voltage Check (>245V)
    if (live && live.voltage) {
        const v = parseFloat(live.voltage);
        if (v > 245) {
            if (vStatus) { vStatus.textContent = `CRITICAL SPIKE: ${v}V (>245V Max)`; vStatus.className = "fault-status text-rose"; }
            isFault = true;
        } else {
            if (vStatus) { vStatus.textContent = `Normal (${v}V Baseline)`; vStatus.className = "fault-status text-emerald"; }
        }
    }

    // 3. Current Check (>7.0A)
    if (live && live.current) {
        const c = parseFloat(live.current);
        if (c > 7.0) {
            if (cStatus) { cStatus.textContent = `OVERLOAD: ${c}A (>7.0A Max)`; cStatus.className = "fault-status text-rose"; }
            isFault = true;
        } else {
            if (cStatus) { cStatus.textContent = `Normal (${c}A Load)`; cStatus.className = "fault-status text-emerald"; }
        }
    }

    // 4. RFID Burst Check
    if (state.unauthorizedToday >= 3) {
        if (rfidBurstStatus) { rfidBurstStatus.textContent = `WARNING: ${state.unauthorizedToday} Unauthorized Scans Detected`; rfidBurstStatus.className = "fault-status text-amber"; }
    } else {
        if (rfidBurstStatus) { rfidBurstStatus.textContent = "Clear (0 Unauthorized Bursts)"; rfidBurstStatus.className = "fault-status text-emerald"; }
    }

    // Overall Status
    if (overallStatus) {
        if (isFault) {
            overallStatus.textContent = "SYSTEM STATUS: ALARM FAULT ACTIVE";
            overallStatus.className = "overall-health-status text-rose";
        } else {
            overallStatus.textContent = "SYSTEM STATUS: HEALTHY";
            overallStatus.className = "overall-health-status text-emerald";
        }
    }
}

/* ==========================================================================
   6. AI Threat Agents & Event Stream Renderer
   ========================================================================== */
function renderAiAgents(state) {
    const secRisk = document.getElementById('aiSecurityRiskScore');
    const secReason = document.getElementById('aiSecurityReason');
    const secRec = document.getElementById('aiSecurityRec');

    const pmConf = document.getElementById('aiPmConfidence');
    const pmSummary = document.getElementById('aiPmSummary');

    const streamBox = document.getElementById('aiTimelineStream');

    const secEvents = state.securityEvents || [];
    const aiIncidents = state.aiIncidents || [];

    // Security Agent Latest Event
    if (secEvents.length > 0) {
        const latestSec = secEvents[0]; // Recent incident
        if (secRisk) secRisk.textContent = `${latestSec.risk_score || 85} %`;
        if (secReason) secReason.textContent = latestSec.reason || "Unauthorized access attempts detected.";
        if (secRec) secRec.textContent = latestSec.recommendation || "Lock down hardware relay output.";
    } else {
        if (secRisk) secRisk.textContent = "0 %";
        if (secReason) secReason.textContent = "No unauthorized access bursts detected.";
        if (secRec) secRec.textContent = "Zero Trust security status nominal.";
    }

    // Combine all events into AI Event Stream
    const allEvents = [...secEvents, ...aiIncidents].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (!streamBox) return;

    if (allEvents.length === 0) {
        streamBox.innerHTML = `<div class="text-muted text-center">No security incidents or AI events logged yet.</div>`;
        return;
    }

    streamBox.innerHTML = allEvents.map(ev => {
        const timeStr = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : 'Just now';
        const type = ev.type || ev.agent || 'AI Event';
        const isCritical = ev.severity === "critical";
        const colorClass = isCritical ? "text-rose" : "text-cyan";

        return `
            <div class="agent-output-box">
                <div class="event-top-row">
                    <span class="agent-out-lbl ${colorClass}">${type}</span>
                    <span class="font-mono text-dim">${timeStr}</span>
                </div>
                <p class="agent-out-text">${ev.reason || (ev.payload ? JSON.stringify(ev.payload) : 'AI Analysis Event')}</p>
            </div>
        `;
    }).join('');
}

/* Mobile Nav Drawer */
function initMobileNav() {
    const btn = document.getElementById('mobileMenuBtn');
    const nav = document.getElementById('mainTabNav');
    if (btn && nav) {
        btn.addEventListener('click', () => nav.classList.toggle('active'));
    }
}
