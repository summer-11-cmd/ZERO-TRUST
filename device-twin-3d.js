/* ==========================================================================
   ZGUARD - 3D Device Twin Panel Component (Three.js / WebGL)
   Includes Animated DC Motor (Spins when motor_status === "RUNNING")
   ========================================================================== */

let scene, camera, renderer, deviceNode, ringMesh, particleSystem, motorRotor;
let isParticleBurstActive = false;
let burstTimer = 0;
let ringGlowColor = 0x059669; // Default Green (Safe)

/**
 * Initialize 3D Device Twin Canvas
 */
function init3DDeviceTwin(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // WebGL Availability Check
    if (!window.WebGLRenderingContext) {
        render2DFallback(container, "WebGL not supported by browser");
        return;
    }

    try {
        const width = container.clientWidth || 320;
        const height = container.clientHeight || 260;

        // Scene & Camera setup
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        camera.position.set(18, 16, 22);
        camera.lookAt(0, 0, 0);

        // Renderer
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        
        container.appendChild(renderer.domElement);

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambientLight);

        const pointLight = new THREE.PointLight(0x0284c7, 2.5, 50);
        pointLight.position.set(10, 15, 10);
        scene.add(pointLight);

        const fillLight = new THREE.PointLight(0x2563eb, 1.2, 50);
        fillLight.position.set(-10, -10, -10);
        scene.add(fillLight);

        // Create ESP32 Abstract Device Node
        const nodeGroup = new THREE.Group();

        // Base Board (Light Metallic Slate Plate)
        const boardGeo = new THREE.BoxGeometry(8, 0.6, 10);
        const boardMat = new THREE.MeshStandardMaterial({
            color: 0xe2e8f0,
            roughness: 0.4,
            metalness: 0.6
        });
        const boardMesh = new THREE.Mesh(boardGeo, boardMat);
        nodeGroup.add(boardMesh);

        // Microcontroller Chip (ESP32 Core)
        const chipGeo = new THREE.BoxGeometry(3, 0.4, 4);
        const chipMat = new THREE.MeshStandardMaterial({
            color: 0x334155,
            roughness: 0.2,
            metalness: 0.8
        });
        const chipMesh = new THREE.Mesh(chipGeo, chipMat);
        chipMesh.position.set(-2, 0.5, -1);
        nodeGroup.add(chipMesh);

        // Security Shield Emblem on Chip
        const shieldGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.2, 6);
        const shieldMat = new THREE.MeshBasicMaterial({ color: 0x0284c7, wireframe: true });
        const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
        shieldMesh.position.set(-2, 0.8, -1);
        nodeGroup.add(shieldMesh);

        // --- DC MOTOR 3D ASSEMBLY ---
        const motorGroup = new THREE.Group();
        motorGroup.position.set(2.2, 1.0, 1.5);

        // Motor Housing (Cylinder Casing)
        const housingGeo = new THREE.CylinderGeometry(1.2, 1.2, 2.0, 24);
        const housingMat = new THREE.MeshStandardMaterial({
            color: 0x64748b,
            metalness: 0.9,
            roughness: 0.3
        });
        const housingMesh = new THREE.Mesh(housingGeo, housingMat);
        motorGroup.add(housingMesh);

        // Motor Base Mount Brackets
        const mountGeo = new THREE.BoxGeometry(2.8, 0.3, 1.6);
        const mountMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8 });
        const mountMesh = new THREE.Mesh(mountGeo, mountMat);
        mountMesh.position.set(0, -0.9, 0);
        motorGroup.add(mountMesh);

        // Spinning Rotor Assembly (Shaft + Blades)
        const rotorGroup = new THREE.Group();
        rotorGroup.position.set(0, 1.1, 0);

        // Central Shaft Pin
        const shaftGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.8, 12);
        const shaftMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.9 });
        const shaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
        rotorGroup.add(shaftMesh);

        // Fan Blades on Rotor Pin
        const bladeGeo = new THREE.BoxGeometry(1.8, 0.08, 0.3);
        const bladeMat = new THREE.MeshBasicMaterial({ color: 0x0284c7 });
        const blade1 = new THREE.Mesh(bladeGeo, bladeMat);
        blade1.position.y = 0.3;
        rotorGroup.add(blade1);

        const blade2 = new THREE.Mesh(bladeGeo, bladeMat);
        blade2.rotation.y = Math.PI / 2;
        blade2.position.y = 0.3;
        rotorGroup.add(blade2);

        motorGroup.add(rotorGroup);
        motorRotor = rotorGroup; // Save handle for continuous rotation animation

        nodeGroup.add(motorGroup);

        // Status LED Indicator
        const ledGeo = new THREE.SphereGeometry(0.35, 16, 16);
        const ledMat = new THREE.MeshBasicMaterial({ color: 0x059669 });
        const ledMesh = new THREE.Mesh(ledGeo, ledMat);
        ledMesh.position.set(-3.2, 0.5, -4.0);
        nodeGroup.add(ledMesh);

        // Outer Pulsing Glow Ring
        const ringGeo = new THREE.RingGeometry(6.2, 6.7, 48);
        const ringMat = new THREE.MeshBasicMaterial({
            color: ringGlowColor,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85
        });
        ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = Math.PI / 2;
        ringMesh.position.y = -0.2;
        nodeGroup.add(ringMesh);

        // Particle Burst System
        const particleCount = 60;
        const particleGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 2;
            positions[i * 3 + 1] = Math.random() * 2;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 2;

            velocities.push({
                x: (Math.random() - 0.5) * 0.15,
                y: Math.random() * 0.2 + 0.05,
                z: (Math.random() - 0.5) * 0.15
            });
        }

        particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const particleMat = new THREE.PointsMaterial({
            color: 0xdc2626,
            size: 0.4,
            transparent: true,
            opacity: 0
        });
        particleSystem = new THREE.Points(particleGeo, particleMat);
        particleSystem.userData = { velocities: velocities };
        nodeGroup.add(particleSystem);

        scene.add(nodeGroup);
        deviceNode = nodeGroup;

        // Damped OrbitControls & Animation Loop
        let angle = 0;
        function animate3D() {
            requestAnimationFrame(animate3D);

            // Ambient gentle tilt
            angle += 0.005;
            deviceNode.rotation.y = Math.sin(angle * 0.8) * 0.2;
            deviceNode.rotation.x = Math.cos(angle * 0.5) * 0.06;

            // DC Motor Rotor Animation: spins continuously if motor_status === "RUNNING"
            if (motorRotor) {
                const motorStatus = (window.ZGUARD_STATE && window.ZGUARD_STATE.live) ? window.ZGUARD_STATE.live.motor_status : "STOPPED";
                if (motorStatus === "RUNNING") {
                    motorRotor.rotation.y += 0.15;
                }
            }

            // Pulse ring opacity
            if (ringMesh) {
                ringMesh.material.opacity = 0.5 + Math.sin(Date.now() * 0.003) * 0.35;
            }

            // Handle particle burst animation
            if (isParticleBurstActive) {
                burstTimer += 0.05;
                const pos = particleSystem.geometry.attributes.position.array;
                const vels = particleSystem.userData.velocities;

                for (let i = 0; i < particleCount; i++) {
                    pos[i * 3] += vels[i].x;
                    pos[i * 3 + 1] += vels[i].y;
                    pos[i * 3 + 2] += vels[i].z;
                }
                particleSystem.geometry.attributes.position.needsUpdate = true;
                particleSystem.material.opacity = Math.max(0, 1 - burstTimer / 2);

                if (burstTimer >= 2) {
                    isParticleBurstActive = false;
                    particleSystem.material.opacity = 0;
                    for (let i = 0; i < particleCount; i++) {
                        pos[i * 3] = (Math.random() - 0.5) * 2;
                        pos[i * 3 + 1] = Math.random() * 2;
                        pos[i * 3 + 2] = (Math.random() - 0.5) * 2;
                    }
                    particleSystem.geometry.attributes.position.needsUpdate = true;
                }
            }

            renderer.render(scene, camera);
        }
        animate3D();

        // Responsive Resize
        window.addEventListener('resize', () => {
            const w = container.clientWidth;
            const h = container.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        });

    } catch (e) {
        console.warn("[ZGuard 3D] Three.js initialization failed, rendering 2D Fallback:", e);
        render2DFallback(container, "3D Renderer Error");
    }
}

/**
 * Trigger Particle Burst on Security Alert Event
 */
window.triggerSecurityParticleBurst = function() {
    if (particleSystem) {
        isParticleBurstActive = true;
        burstTimer = 0;
        particleSystem.material.opacity = 1;
    }
};

/**
 * Update Ring Color based on Zero Trust Risk Score
 */
function update3DRiskScore(riskScore) {
    if (!ringMesh) return;
    if (riskScore > 60) {
        ringMesh.material.color.setHex(0xdc2626); // Red (Critical)
    } else if (riskScore > 30) {
        ringMesh.material.color.setHex(0xd97706); // Amber (Warning)
    } else {
        ringMesh.material.color.setHex(0x059669); // Green (Safe)
    }
}

/**
 * Render 2D WebGL Fallback Badge
 */
function render2DFallback(container, reason) {
    container.innerHTML = `
        <div class="twin-2d-fallback">
            <div class="fallback-icon">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div class="fallback-title">ZGuard Device Twin</div>
            <div class="fallback-badge"><span class="pulse-dot"></span> ESP32-01 Active</div>
            <span class="fallback-note">${reason} (Static 2D Mode)</span>
        </div>
    `;
}
