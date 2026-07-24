/* ==========================================================================
   ZGUARD - Interactive Application Engine & State Sync UI Controller
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    initCanvasMesh();
    initPhasedStepper();
    initGanttTimeline();
    initMetricsCounter();
    initRiskSimulator();
    initDeploymentTabs();
    initCalculatorForm();
    initMobileNav();

    // Initialize 3D Device Twin Component
    init3DDeviceTwin('deviceTwinContainer');

    // Initialize Firebase Client & Subscribe State Bus
    initFirebaseClient();
    subscribeZGuardState(renderZGuardUI);
});

/* ==========================================================================
   1. Realtime UI Sync Engine (Handles Waiting, Live, Offline States)
   ========================================================================== */
function renderZGuardUI(state) {
    const statusPill = document.getElementById('globalStatusPill');
    const statusText = document.getElementById('connectionStatusText');
    const twinStatusDot = document.getElementById('twinStatusDot');
    const twinStatusLabel = document.getElementById('twinStatusLabel');

    const liveVolts = document.getElementById('liveVolts');
    const liveAmps = document.getElementById('liveAmps');
    const liveRelayStatus = document.getElementById('liveRelayStatus');
    const liveMotorStatus = document.getElementById('liveMotorStatus');
    const liveRfidUid = document.getElementById('liveRfidUid');
    const liveRfidStatus = document.getElementById('liveRfidStatus');
    const btnCutRelay = document.getElementById('btnCutRelay');
    const cutRelayBtnText = document.getElementById('cutRelayBtnText');

    // 1. Connection Status State Machine
    if (state.connectionStatus === "waiting") {
        if (statusPill) statusPill.className = "badge-pill";
        if (statusText) statusText.textContent = "Waiting for ESP32-01 connection...";
        if (twinStatusDot) twinStatusDot.style.background = "var(--cyan-400)";
        if (twinStatusLabel) twinStatusLabel.textContent = "WAITING FOR CONNECTION";
    } 
    else if (state.connectionStatus === "live") {
        if (statusPill) statusPill.className = "badge-pill status-live";
        if (statusText) statusText.textContent = "Live (ESP32-01 Connected)";
        if (twinStatusDot) twinStatusDot.style.background = "var(--emerald-400)";
        if (twinStatusLabel) twinStatusLabel.textContent = "LIVE — ONLINE";
    } 
    else if (state.connectionStatus === "offline") {
        if (statusPill) statusPill.className = "badge-pill status-offline";
        if (statusText) statusText.textContent = "Offline (ESP32-01 Stale >10s)";
        if (twinStatusDot) twinStatusDot.style.background = "var(--amber-500)";
        if (twinStatusLabel) twinStatusLabel.textContent = "DEVICE OFFLINE";
    }

    // 2. Render Telemetry Mini-Cards
    if (state.live) {
        if (liveVolts) liveVolts.textContent = `${state.live.voltage} V`;
        if (liveAmps) liveAmps.textContent = `${state.live.current} A`;
        if (liveRelayStatus) {
            liveRelayStatus.textContent = state.live.relay_status || "OFF";
            liveRelayStatus.className = state.live.relay_status === "ON" ? "mini-value text-emerald" : "mini-value text-rose";
        }
        if (liveMotorStatus) liveMotorStatus.textContent = `Motor: ${state.live.motor_status || "STOPPED"}`;
        if (liveRfidUid) liveRfidUid.textContent = state.live.rfid_last_uid || "None";
        if (liveRfidStatus) {
            liveRfidStatus.textContent = state.live.rfid_last_status || "No Scan";
            liveRfidStatus.className = state.live.rfid_last_status === "AUTHORIZED" ? "mini-sub text-emerald" : "mini-sub text-rose";
        }

        // Toggle Cut Relay Button Label
        if (cutRelayBtnText) {
            cutRelayBtnText.textContent = state.live.relay_status === "ON" ? "Emergency Relay Cut" : "Enable Relay Power";
        }
    }

    // Bind Emergency Relay Action
    if (btnCutRelay) {
        btnCutRelay.onclick = () => {
            const currentRelay = state.live ? state.live.relay_status : "ON";
            const targetCmd = currentRelay === "ON" ? "DISABLE_RELAY" : "ENABLE_RELAY";
            sendDeviceCommand(targetCmd);
        };
    }

    // 3. Render RFID Scan Log Stream Table
    renderRfidLogs(state.rfidLogs);

    // 4. Render Security Events & Risk Score Ring
    renderSecurityEvents(state.securityEvents);
}

function renderRfidLogs(logs) {
    const tableBody = document.getElementById('rfidLogTableBody');
    const badge = document.getElementById('rfidCountBadge');
    if (!tableBody) return;

    if (badge) badge.textContent = `${logs.length} Scans`;

    if (!logs || logs.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Waiting for ESP32 RFID scan data...</td></tr>`;
        return;
    }

    tableBody.innerHTML = logs.map(log => {
        const timeStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "Just now";
        const statusClass = log.status === "AUTHORIZED" ? "authorized" : "unauthorized";
        return `
            <tr>
                <td class="font-mono text-cyan">${log.uid || 'N/A'}</td>
                <td>${log.user_name || 'Unknown Operator'}</td>
                <td><span class="status-badge-cell ${statusClass}">${log.status}</span></td>
                <td class="font-mono text-dim">${timeStr}</td>
            </tr>
        `;
    }).join('');
}

function renderSecurityEvents(events) {
    const list = document.getElementById('secEventsList');
    const badge = document.getElementById('secEventCountBadge');
    if (!list) return;

    if (badge) badge.textContent = `${events.length} Incidents`;

    if (!events || events.length === 0) {
        list.innerHTML = `<div class="empty-event-state text-muted">No security incidents detected. System safe.</div>`;
        if (window.update3DRiskScore) window.update3DRiskScore(10);
        return;
    }

    let highestRisk = 0;
    list.innerHTML = events.map(ev => {
        if (ev.risk_score > highestRisk) highestRisk = ev.risk_score;
        const timeStr = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : "Just now";
        const severityClass = ev.severity === "critical" ? "critical" : "warning";
        const colorClass = ev.severity === "critical" ? "text-rose" : "text-amber";

        return `
            <div class="sec-event-item ${severityClass}">
                <div class="event-top-row">
                    <span class="event-type-tag ${colorClass}">${ev.type || 'security_incident'}</span>
                    <span class="event-time">${timeStr}</span>
                </div>
                <div class="event-reason">${ev.reason}</div>
                <div class="event-rec">⚡ Rec: ${ev.recommendation}</div>
            </div>
        `;
    }).join('');

    // Update 3D Ring Color based on highest risk
    if (window.update3DRiskScore) {
        window.update3DRiskScore(highestRisk);
    }
}

/* ==========================================================================
   2. Canvas Particle Mesh Background
   ========================================================================== */
function initCanvasMesh() {
    const canvas = document.getElementById('bgCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let width, height;
    let particles = [];

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    class Particle {
        constructor() {
            this.x = Math.random() * width;
            this.y = Math.random() * height;
            this.vx = (Math.random() - 0.5) * 0.4;
            this.vy = (Math.random() - 0.5) * 0.4;
            this.radius = Math.random() * 2 + 1;
        }

        update() {
            this.x += this.vx;
            this.y += this.vy;
            if (this.x < 0 || this.x > width) this.vx *= -1;
            if (this.y < 0 || this.y > height) this.vy *= -1;
        }

        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fillStyle = '#06b6d4';
            ctx.fill();
        }
    }

    const count = Math.min(Math.floor(window.innerWidth / 20), 45);
    for (let i = 0; i < count; i++) particles.push(new Particle());

    function animate() {
        ctx.clearRect(0, 0, width, height);
        for (let i = 0; i < particles.length; i++) {
            particles[i].update();
            particles[i].draw();

            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 140) {
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(6, 182, 212, ${0.18 * (1 - dist / 140)})`;
                    ctx.lineWidth = 0.8;
                    ctx.stroke();
                }
            }
        }
        requestAnimationFrame(animate);
    }
    animate();
}

/* ==========================================================================
   3. 5-Phase Roadmap Stepper Engine
   ========================================================================== */
const ROADMAP_PHASES = {
    1: {
        title: "Discovery & Asset Inventory",
        weeks: "Weeks 1–2",
        tag: "PHASE 01: ASSESSMENT",
        desc: "Passive network discovery across all IoT/IIoT & OT device classes without introducing latency or network disruption.",
        checklist: [
            "Passive DPI & SPAN/TAP mirror port scanning for all IoT/OT devices",
            "Asset classification by criticality, vendor, protocol (Modbus, BACnet, MQTT), and legacy OS status",
            "Risk & gap assessment comparing current posture against NIST 800-207 and IEC 62443",
            "Shadow IT & unauthorized rogue device detection"
        ],
        deliverable: "Comprehensive Device Inventory Report & Asset Vulnerability Risk Heatmap"
    },
    2: {
        title: "Architecture Design & Policy Baseline",
        weeks: "Weeks 3–4",
        tag: "PHASE 02: DESIGN",
        desc: "Define granular micro-segmentation protect surfaces, establish zero-trust identity policies, and sign off architectural blueprints.",
        checklist: [
            "Identify Protect Surfaces (data flows, sensitive PLCs, medical telemetry lines)",
            "Determine Agent vs Agentless enforcement policy per hardware device class",
            "Draft micro-segmentation zones & zero trust network access (ZTNA) rules",
            "Establish PKI certificate lifecycle & identity management mapping"
        ],
        deliverable: "ZGuard ZT Architecture Blueprint (Formally signed off by CISO & OT Security Lead)"
    },
    3: {
        title: "Pilot Deployment & Observe Mode",
        weeks: "Weeks 5–8",
        tag: "PHASE 03: PILOT TEST",
        desc: "Deploy ZGuard on a controlled pilot site (single manufacturing line or hospital wing) running exclusively in Observe Mode to validate baseline traffic.",
        checklist: [
            "Deploy ZGuard Edge Proxies on pilot segment with fail-open bypass protection",
            "Issue PKI device identities & initiate continuous telemetry monitoring",
            "Observe mode active: anomaly detection models learn baseline without dropping valid traffic",
            "Validate policy rules against actual operational workflows with zero false positives"
        ],
        deliverable: "Pilot Execution Report & Baseline Success Metrics Matrix vs Initial Posture"
    },
    4: {
        title: "Phased Production Rollout",
        weeks: "Weeks 9–20",
        tag: "PHASE 04: ROLLOUT",
        desc: "Incremental transition from Observe to Enforce mode site-by-site or by device tier, integrating into enterprise SIEM/SOAR and IAM portals.",
        checklist: [
            "Incremental migration from Observe → Enforce mode by site micro-zone",
            "Roll out transparent ZGuard Edge Gateways for legacy unmanaged hardware",
            "Integrate continuous event telemetry with Splunk, Microsoft Sentinel, and ServiceNow",
            "Activate Just-In-Time (JIT) ephemeral vendor access policies"
        ],
        deliverable: "Site-by-Site Go-Live Formal Sign-Offs & SIEM/SOAR Integration Validation"
    },
    5: {
        title: "Steady-State Operations & Optimization",
        weeks: "Week 20+ Ongoing",
        tag: "PHASE 05: STEADY-STATE",
        desc: "Automated 24/7 incident response, quarterly access recertification, continuous security posture tuning, and executive governance reviews.",
        checklist: [
            "24/7 continuous behavioral anomaly monitoring & automated threat containment",
            "Quarterly zero-trust policy reviews and access recertification audits",
            "OTA update governance & firmware patch integrity verification",
            "Quarterly Executive Business Reviews (QBR) tracking security KPIs"
        ],
        deliverable: "Quarterly Business Review (QBR) Report with Executive KPI Benchmarks"
    }
};

function initPhasedStepper() {
    const navItems = document.querySelectorAll('.step-nav-item');
    const detailCard = document.getElementById('stepDetailCard');

    function renderStep(stepId) {
        const data = ROADMAP_PHASES[stepId];
        if (!data || !detailCard) return;

        navItems.forEach(item => {
            if (parseInt(item.dataset.step) === stepId) item.classList.add('active');
            else item.classList.remove('active');
        });

        detailCard.innerHTML = `
            <div class="detail-header">
                <div class="detail-title-group">
                    <span class="detail-phase-badge">Phase 0${stepId}</span>
                    <h3 class="detail-phase-title">${data.title}</h3>
                </div>
                <span class="detail-week-badge">${data.weeks}</span>
            </div>

            <div class="detail-grid">
                <div>
                    <p class="detail-desc">${data.desc}</p>
                    <h4 class="detail-list-title">Key Phase Execution Steps</h4>
                    <ul class="checklist">
                        ${data.checklist.map(item => `
                            <li class="checklist-item">
                                <span class="check-icon">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                                </span>
                                <span>${item}</span>
                            </li>
                        `).join('')}
                    </ul>
                </div>

                <div>
                    <div class="deliverable-box">
                        <span class="deliverable-tag">${data.tag} DELIVERABLE</span>
                        <div class="deliverable-name">${data.deliverable}</div>
                        <p class="deliverable-desc">Audited enterprise consulting deliverable presented directly to customer security steering committee.</p>
                    </div>
                </div>
            </div>
        `;
    }

    navItems.forEach(item => {
        item.addEventListener('click', () => renderStep(parseInt(item.dataset.step)));
    });

    renderStep(1);
}

/* ==========================================================================
   4. Interactive Gantt Timeline
   ========================================================================== */
const GANTT_PROFILES = {
    small: {
        totalWeeks: 12,
        heroWeeks: "12 Weeks",
        phases: [
            { id: 1, name: "Phase 1: Discovery", start: 1, span: 2, class: "phase-1" },
            { id: 2, name: "Phase 2: Design", start: 2, span: 2, class: "phase-2" },
            { id: 3, name: "Phase 3: Pilot", start: 4, span: 2, class: "phase-3" },
            { id: 4, name: "Phase 4: Production Rollout", start: 6, span: 5, class: "phase-4" },
            { id: 5, name: "Phase 5: Steady-State Ops", start: 11, span: 2, class: "phase-5" }
        ]
    },
    enterprise: {
        totalWeeks: 20,
        heroWeeks: "20 Weeks",
        phases: [
            { id: 1, name: "Phase 1: Discovery & Inventory", start: 1, span: 2, class: "phase-1" },
            { id: 2, name: "Phase 2: Architecture Baseline", start: 3, span: 2, class: "phase-2" },
            { id: 3, name: "Phase 3: Pilot Deployment", start: 5, span: 4, class: "phase-3" },
            { id: 4, name: "Phase 4: Production Rollout", start: 9, span: 12, class: "phase-4" },
            { id: 5, name: "Phase 5: Steady-State Ops", start: 19, span: 2, class: "phase-5" }
        ]
    }
};

function initGanttTimeline() {
    const btnSmall = document.getElementById('btnSmallScale');
    const btnEnterprise = document.getElementById('btnEnterpriseScale');
    const weeksHeader = document.getElementById('ganttWeeksHeader');
    const ganttBody = document.getElementById('ganttBody');

    function renderGantt(profileKey) {
        const profile = GANTT_PROFILES[profileKey];
        if (!weeksHeader || !ganttBody) return;

        let headerCols = `<div class="week-col-head">Phase / Milestone</div>`;
        for (let w = 1; w <= profile.totalWeeks; w++) {
            headerCols += `<div class="week-col-head">W${w}</div>`;
        }
        weeksHeader.style.gridTemplateColumns = `220px repeat(${profile.totalWeeks}, 1fr)`;
        weeksHeader.innerHTML = headerCols;

        let bodyHtml = '';
        profile.phases.forEach(p => {
            bodyHtml += `
                <div class="gantt-row" style="grid-template-columns: 220px repeat(${profile.totalWeeks}, 1fr);">
                    <div class="gantt-label">${p.name}</div>
                    <div class="gantt-bar-container" style="grid-template-columns: repeat(${profile.totalWeeks}, 1fr);">
                        <div class="gantt-bar ${p.class}" style="grid-column: ${p.start} / span ${p.span};">
                            W${p.start} - W${p.start + p.span - 1} (${p.span} wks)
                        </div>
                    </div>
                </div>
            `;
        });
        ganttBody.innerHTML = bodyHtml;
    }

    if (btnSmall && btnEnterprise) {
        btnSmall.addEventListener('click', () => {
            btnSmall.classList.add('active');
            btnEnterprise.classList.remove('active');
            renderGantt('small');
        });

        btnEnterprise.addEventListener('click', () => {
            btnEnterprise.classList.add('active');
            btnSmall.classList.remove('active');
            renderGantt('enterprise');
        });
    }

    renderGantt('enterprise');
}

/* ==========================================================================
   5. Metrics Counter & Risk Simulator
   ========================================================================== */
function initMetricsCounter() {
    const metricCards = document.querySelectorAll('.metric-number[data-target]');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const target = parseInt(entry.target.dataset.target);
                animateCounter(entry.target, target);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });
    metricCards.forEach(card => observer.observe(card));
}

function animateCounter(element, target) {
    let current = 0;
    const increment = target / 40;
    const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
            element.textContent = target + '%';
            clearInterval(timer);
        } else {
            element.textContent = Math.floor(current) + '%';
        }
    }, 25);
}

function initRiskSimulator() {
    const slider = document.getElementById('simWeekSlider');
    const simWeekVal = document.getElementById('simWeekVal');
    const simRiskBar = document.getElementById('simRiskBar');
    const simRiskVal = document.getElementById('simRiskVal');
    const simPolicyVal = document.getElementById('simPolicyVal');

    if (!slider) return;

    slider.addEventListener('input', (e) => {
        const week = parseInt(e.target.value);
        simWeekVal.textContent = `Week ${week}`;

        const riskScore = Math.max(5, Math.round(95 - (week - 1) * 4.7));
        const policyPct = Math.min(100, Math.round((week / 20) * 100));

        simRiskBar.style.width = `${riskScore}%`;
        if (riskScore > 60) {
            simRiskBar.style.background = 'var(--rose-500)';
            simRiskVal.textContent = `${riskScore} / 100 (High Risk)`;
        } else if (riskScore > 25) {
            simRiskBar.style.background = 'var(--amber-500)';
            simRiskVal.textContent = `${riskScore} / 100 (Moderate Risk)`;
        } else {
            simRiskBar.style.background = 'var(--emerald-400)';
            simRiskVal.textContent = `${riskScore} / 100 (Low Risk / Zero Trust Enforced)`;
        }

        simPolicyVal.textContent = `${policyPct}% Enforced Mode`;
    });
}

/* ==========================================================================
   6. Deployment Model Options Tabs
   ========================================================================== */
const DEPLOYMENT_MODELS = {
    onprem: {
        title: "On-Premises Air-Gapped Engine",
        desc: "Designed for classified defense facilities, power generation plants, and air-gapped industrial OT networks requiring zero external cloud connectivity.",
        pros: ["100% Data Sovereignty & Local Storage", "Air-gapped deployment compatibility", "Zero external outbound network dependencies"],
        cons: ["Requires local server appliance cluster", "Manual OTA offline update bundle management"],
        specs: { latency: "< 1ms Ultra-low", management: "Local Appliance Console", compliance: "IEC 62443 SL-4 / NERC-CIP" }
    },
    cloud: {
        title: "Cloud-Hosted Managed SaaS",
        desc: "Ideal for distributed commercial enterprises, multi-site logistics centers, and retail IoT deployments wanting instant updates and low operational overhead.",
        pros: ["Instant provisioning & zero local server management", "Automated threat intelligence feed updates", "Global multi-site dashboard aggregation"],
        cons: ["Requires secure outbound TLS 1.3 telemetry tunnel", "Cloud compliance alignment required"],
        specs: { latency: "< 15ms Regional", management: "ZGuard Cloud SOC Portal", compliance: "SOC 2 Type II / ISO 27001" }
    },
    hybrid: {
        title: "Hybrid Cloud Engine (Most Popular)",
        desc: "Combines local edge enforcement proxies with cloud analytics for central policy governance and localized real-time threat containment.",
        pros: ["Local enforcement continues even during WAN outages", "Centralized policy management across global sites", "Optimized bandwidth utilization"],
        cons: ["Hybrid network routing architecture setup"],
        specs: { latency: "< 2ms Local Edge", management: "Unified Hybrid Dashboard", compliance: "NIS 2 / GDPR / HIPAA" }
    },
    edge: {
        title: "Edge-Native OT Gateway",
        desc: "Lightweight proxy micro-kernel deployed directly on industrial gateways, DIN-rail switches, or medical telemetry bridges for real-time SCADA lines.",
        pros: ["Sub-millisecond packet inspection for Modbus/SCADA", "Fail-open hardware bypass relays", "Zero footprint on legacy OT controllers"],
        cons: ["Requires compatible DIN-rail edge hardware"],
        specs: { latency: "< 0.5ms Micro-Second", management: "ZGuard Edge Agent Manager", compliance: "IEC 62443-4-2" }
    }
};

function initDeploymentTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const contentBox = document.getElementById('deploymentContent');

    function renderTab(tabId) {
        const model = DEPLOYMENT_MODELS[tabId];
        if (!model || !contentBox) return;

        tabBtns.forEach(btn => {
            if (btn.dataset.tab === tabId) btn.classList.add('active');
            else btn.classList.remove('active');
        });

        contentBox.innerHTML = `
            <div class="tab-card">
                <div>
                    <h3 class="tab-title">${model.title}</h3>
                    <p class="tab-desc">${model.desc}</p>
                    <div class="pro-con-grid">
                        <div class="pro-box">
                            <h4>Architectural Advantages</h4>
                            <ul class="pro-con-list">
                                ${model.pros.map(p => `<li>✓ ${p}</li>`).join('')}
                            </ul>
                        </div>
                        <div class="con-box">
                            <h4>Considerations</h4>
                            <ul class="pro-con-list">
                                ${model.cons.map(c => `<li>• ${c}</li>`).join('')}
                            </ul>
                        </div>
                    </div>
                </div>

                <div class="specs-box">
                    <div class="spec-item"><span class="spec-label">Inspection Latency</span><span class="spec-val">${model.specs.latency}</span></div>
                    <div class="spec-item"><span class="spec-label">Management Layer</span><span class="spec-val">${model.specs.management}</span></div>
                    <div class="spec-item"><span class="spec-label">Target Compliance Standard</span><span class="spec-val">${model.specs.compliance}</span></div>
                </div>
            </div>
        `;
    }

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => renderTab(btn.dataset.tab));
    });

    renderTab('onprem');
}

/* ==========================================================================
   7. Lead Capture & Timeline Estimator Calculator
   ========================================================================== */
function initCalculatorForm() {
    const form = document.getElementById('calculatorForm');
    const slider = document.getElementById('deviceCount');
    const sliderVal = document.getElementById('deviceCountVal');
    const calcEstWeeks = document.getElementById('calcEstWeeks');
    const calcEstMode = document.getElementById('calcEstMode');
    const calcEstEngineers = document.getElementById('calcEstEngineers');

    const modal = document.getElementById('successModal');
    const modalCloseBtn = document.getElementById('modalCloseBtn');
    const modalOkBtn = document.getElementById('modalOkBtn');

    if (!form || !slider) return;

    function updateEstimates() {
        const count = parseInt(slider.value);
        if (sliderVal) sliderVal.textContent = `${count.toLocaleString()} Devices`;

        let weeks = 12, mode = "Hybrid Edge Gateway", engineers = "2 Engineers";
        if (count > 20000) { weeks = 24; mode = "Distributed Enterprise Edge"; engineers = "5 Engineers + Architect"; }
        else if (count > 8000) { weeks = 20; mode = "Hybrid Multi-Site Cloud"; engineers = "3 Engineers"; }
        else if (count > 2500) { weeks = 16; mode = "Hybrid Edge Gateway"; engineers = "2 Engineers"; }
        else { weeks = 12; mode = "Cloud SaaS / Edge Proxy"; engineers = "1 Dedicated Engineer"; }

        if (calcEstWeeks) calcEstWeeks.textContent = `${weeks} Weeks`;
        if (calcEstMode) calcEstMode.textContent = mode;
        if (calcEstEngineers) calcEstEngineers.textContent = engineers;
    }

    slider.addEventListener('input', updateEstimates);
    updateEstimates();

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        let isValid = true;
        const companyName = document.getElementById('companyName');
        const workEmail = document.getElementById('workEmail');
        const industryVertical = document.getElementById('industryVertical');

        const companyGroup = companyName.closest('.form-group');
        const emailGroup = workEmail.closest('.form-group');
        const industryGroup = industryVertical.closest('.form-group');

        [companyGroup, emailGroup, industryGroup].forEach(g => g.classList.remove('error'));

        if (!companyName.value.trim()) { companyGroup.classList.add('error'); isValid = false; }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(workEmail.value.trim())) { emailGroup.classList.add('error'); isValid = false; }
        if (!industryVertical.value) { industryGroup.classList.add('error'); isValid = false; }

        if (isValid) {
            document.getElementById('modalCompName').textContent = companyName.value;
            document.getElementById('modalDeviceCount').textContent = `${parseInt(slider.value).toLocaleString()} Devices`;
            document.getElementById('modalTimelineWeeks').textContent = calcEstWeeks.textContent;
            document.getElementById('modalDeploymentModel').textContent = calcEstMode.textContent;

            modal.classList.add('active');
            form.reset();
            updateEstimates();
        }
    });

    const closeModal = () => modal.classList.remove('active');
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
    if (modalOkBtn) modalOkBtn.addEventListener('click', closeModal);
}

/* ==========================================================================
   8. Mobile Navigation Toggle
   ========================================================================== */
function initMobileNav() {
    const menuBtn = document.getElementById('mobileMenuBtn');
    const navLinks = document.getElementById('navLinks');

    if (menuBtn && navLinks) {
        menuBtn.addEventListener('click', () => navLinks.classList.toggle('active'));
    }
}
