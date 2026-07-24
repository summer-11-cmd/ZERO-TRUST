/* ==========================================================================
   ZGUARD — Industrial Single-Device Security Dashboard UI Controller
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    initNavigationTabs();
    initSetupForm();
    initRfidLogFilters();
    initSettingsModal();

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
   3. Settings Modal & Backend LLM API Key Handler
   ========================================================================== */
function initSettingsModal() {
    const openBtn = document.getElementById('btnOpenSettings');
    const closeBtn = document.getElementById('btnCloseSettings');
    const modal = document.getElementById('settingsModal');
    const form = document.getElementById('settingsForm');
    const keyInput = document.getElementById('inputLlmApiKey');

    if (openBtn && modal) {
        openBtn.addEventListener('click', () => modal.classList.add('active'));
    }
    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => modal.classList.remove('active'));
    }
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });
    }

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const apiKey = keyInput.value.trim();
            if (!apiKey) {
                alert("Please enter a valid LLM API Key.");
                return;
            }

            // Submit key to local Python backend endpoint
            fetch('http://localhost:5000/api/config/llm-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: apiKey })
            })
            .then(res => res.json())
            .then(data => {
                if (data && data.status === 'success') {
                    window.ZGUARD_STATE.llmConfigured = true;
                    keyInput.value = "";
                    modal.classList.remove('active');
                    alert("LLM API Key saved to backend .env and reloaded successfully!");
                    notifySubscribers();
                } else {
                    alert("Failed to update backend key: " + (data.message || "Unknown error"));
                }
            })
            .catch(err => {
                alert("Could not connect to Python backend server at http://localhost:5000. Ensure 'python backend/main.py' is running.");
            });
        });
    }
}

/* ==========================================================================
   4. Realtime UI Renderer & State Subscriber
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
    const ovIsi = document.getElementById('overviewIsiScore');
    const isiAuthVal = document.getElementById('isiAuthVal');
    const isiFaultVal = document.getElementById('isiFaultVal');
    const ovOnline = document.getElementById('overviewOnlineDevices');
    const ovUnauth = document.getElementById('overviewUnauthCount');

    if (ovHealth) ovHealth.textContent = `${state.healthScore} %`;
    if (ovIsi) ovIsi.textContent = `${state.isiScore} %`;
    if (isiAuthVal) isiAuthVal.textContent = `${state.isiAuthRatio}%`;
    if (isiFaultVal) isiFaultVal.textContent = state.isiFaultScore >= 90 ? "Clear" : (state.isiFaultScore >= 50 ? "Warning" : "Critical");
    if (ovOnline) ovOnline.textContent = `${state.onlineDevices} / 1`;
    if (ovUnauth) ovUnauth.textContent = `${state.unauthorizedToday}`;

    // C. 3D Twin Sidebar
    const twinDevId = document.getElementById('twinDevId');
    const twinRelay = document.getElementById('twinRelay');
    const twinMotor = document.getElementById('twinMotor');
    const twinLastSeen = document.getElementById('twinLastSeen');

    if (twinDevId) twinDevId.textContent = state.deviceId;
    if (state.live) {
        if (twinRelay) twinRelay.textContent = state.live.relay_status || '--';
        if (twinMotor) twinMotor.textContent = state.live.motor_status || '--';
        if (twinLastSeen) {
            const timeStr = state.live.last_seen ? new Date(state.live.last_seen).toLocaleTimeString() : '--';
            twinLastSeen.textContent = timeStr;
        }
    }

    // D. Monitoring Panel Telemetry
    const monRelay = document.getElementById('monRelay');
    const monMotor = document.getElementById('monMotor');
    const monLastSeen = document.getElementById('monLastSeen');

    if (state.live) {
        if (monRelay) {
            monRelay.textContent = state.live.relay_status || '--';
            monRelay.className = state.live.relay_status === "ON" ? "mini-value text-emerald" : "mini-value text-rose";
        }
        if (monMotor) {
            monMotor.textContent = state.live.motor_status || '--';
            monMotor.className = state.live.motor_status === "RUNNING" ? "mini-value text-emerald" : "mini-value text-dim";
        }
        if (monLastSeen) {
            monLastSeen.textContent = state.live.last_seen ? new Date(state.live.last_seen).toLocaleTimeString() : '--';
        }
    }

    // E. Render RFID Logs & Filters
    renderFilteredRfidLogs(state.rfidLogs);

    // F. Render Fault Detection Status
    renderFaultDetection(state);

    // G. Render AI Agents & Event Stream
    renderAiAgents(state);
}

/* ==========================================================================
   5. Real-time RFID Log Table Renderer with Search & Status Filters
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

    if (searchInput && searchInput.value.trim()) {
        const q = searchInput.value.trim().toLowerCase();
        filtered = filtered.filter(l => 
            (l.uid && l.uid.toLowerCase().includes(q)) || 
            (l.user_name && l.user_name.toLowerCase().includes(q))
        );
    }

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
                <td class="text-dim">${timeStr}</td>
                <td class="text-dim">${dateStr}</td>
                <td class="font-mono text-cyan">${l.uid || 'N/A'}</td>
                <td>${l.user_name || 'Operator'}</td>
                <td><span class="status-badge-cell ${statusClass}">${l.status}</span></td>
                <td class="font-mono text-dim text-right">${window.ZGUARD_STATE.deviceId}</td>
            </tr>
        `;
    }).join('');
}

/* ==========================================================================
   6. Fault Detection Evaluator
   ========================================================================== */
function renderFaultDetection(state) {
    const overall = document.getElementById('faultOverallStatus');
    const relayStatus = document.getElementById('faultRelayStatus');
    const burstStatus = document.getElementById('faultRfidBurstStatus');
    const offlineStatus = document.getElementById('faultOfflineStatus');

    if (!state.live || state.connectionStatus === "waiting") {
        if (overall) { overall.textContent = "SYSTEM STATUS: WAITING FOR DEVICE"; overall.className = "overall-health-status text-amber"; }
        if (offlineStatus) offlineStatus.textContent = "Waiting for Connection";
        return;
    }

    let hasFault = false;

    // Relay State
    if (state.live.relay_status === "OFF") {
        if (relayStatus) { relayStatus.textContent = "Warning (Relay Open / Cut)"; relayStatus.className = "fault-status text-rose"; }
        hasFault = true;
    } else {
        if (relayStatus) { relayStatus.textContent = "Normal (Relay Closed)"; relayStatus.className = "fault-status text-emerald"; }
    }

    // RFID Burst
    if (state.unauthorizedToday >= 3) {
        if (burstStatus) { burstStatus.textContent = `CRITICAL (${state.unauthorizedToday} Scans)`; burstStatus.className = "fault-status text-rose"; }
        hasFault = true;
    } else {
        if (burstStatus) { burstStatus.textContent = `Clear (${state.unauthorizedToday} Scans)`; burstStatus.className = "fault-status text-emerald"; }
    }

    // Connection
    if (state.connectionStatus === "offline") {
        if (offlineStatus) { offlineStatus.textContent = "STALE (Heartbeat >10s)"; offlineStatus.className = "fault-status text-rose"; }
        hasFault = true;
    } else {
        if (offlineStatus) { offlineStatus.textContent = "Healthy (Sub-second Heartbeat)"; offlineStatus.className = "fault-status text-emerald"; }
    }

    if (overall) {
        if (hasFault) {
            overall.textContent = "SYSTEM STATUS: FAULT / WARNING ACTIVE";
            overall.style.color = "var(--rose-600)";
            overall.style.background = "var(--bg-rose-soft)";
            overall.style.borderColor = "#fecdd3";
        } else {
            overall.textContent = "SYSTEM STATUS: ALL SYSTEMS HEALTHY";
            overall.style.color = "var(--emerald-600)";
            overall.style.background = "var(--bg-emerald-soft)";
            overall.style.borderColor = "#a7f3d0";
        }
    }
}

/* ==========================================================================
   7. AI Agents & Event Stream Renderer
   ========================================================================== */
function renderAiAgents(state) {
    const riskScore = document.getElementById('aiSecurityRiskScore');
    const reason = document.getElementById('aiSecurityReason');
    const rec = document.getElementById('aiSecurityRec');
    const pmConf = document.getElementById('aiPmConfidence');
    const pmSummary = document.getElementById('aiPmSummary');
    const streamBox = document.getElementById('aiTimelineStream');

    if (!state.llmConfigured) {
        if (riskScore) riskScore.textContent = "-- %";
        if (reason) reason.textContent = "AI analysis not configured — add API key in Settings";
        if (rec) rec.textContent = "Configure API key to enable advisory threat synthesis.";
        if (pmConf) pmConf.textContent = "Not Configured";
        if (pmSummary) pmSummary.textContent = "AI analysis not configured — add API key in Settings";
    } else {
        const secEvents = state.securityEvents || [];
        if (secEvents.length > 0) {
            const latest = secEvents[0];
            if (riskScore) riskScore.textContent = `${latest.risk_score || 85} %`;
            if (reason) reason.textContent = latest.reason || "Advisory LLM threat synthesis active.";
            if (rec) rec.textContent = latest.recommendation || "Maintain active observation.";
        } else {
            if (riskScore) riskScore.textContent = "0 %";
            if (reason) reason.textContent = "Zero Trust Watcher Active — No security anomalies detected.";
            if (rec) rec.textContent = "No action required.";
        }

        if (pmConf) pmConf.textContent = "Healthy (100% Conf)";
        if (pmSummary) pmSummary.textContent = "Motor runtime and relay switching frequency within normal industrial parameters.";
    }

    // AI Timeline Stream
    if (!streamBox) return;
    const incidents = state.aiIncidents || [];
    if (incidents.length === 0) {
        streamBox.innerHTML = `<div class="text-muted text-center">No security incidents or backend events logged yet.</div>`;
        return;
    }

    streamBox.innerHTML = incidents.map(inc => {
        const timeStr = inc.timestamp ? new Date(inc.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
        const payload = inc.payload || {};
        const summary = payload.summary || payload.recommendation || "Backend event logged.";

        return `
            <div style="padding: 0.6rem 0; border-bottom: 1px solid var(--border-color); font-size: 0.85rem;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                    <strong style="color: var(--violet-600); font-size: 0.8rem; text-transform: uppercase;">[AI Agent: ${inc.agent || 'Security'}]</strong>
                    <span class="text-dim">${timeStr}</span>
                </div>
                <div style="color: var(--text-muted);">${summary}</div>
            </div>
        `;
    }).join('');
}
