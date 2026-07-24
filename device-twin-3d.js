/* ==========================================================================
   ZGUARD - 3D Device Twin Panel Component (Three.js / WebGL)
   ========================================================================== */

let scene, camera, renderer, deviceNode, ringMesh, particleSystem;
let isParticleBurstActive = false;
let burstTimer = 0;
let ringGlowColor = 0x10b981; // Default Green (Safe)

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
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        const pointLight = new THREE.PointLight(0x06b6d4, 2.5, 50);
        pointLight.position.set(10, 15, 10);
        scene.add(pointLight);

        const fillLight = new THREE.PointLight(0x3b82f6, 1.2, 50);
        fillLight.position.set(-10, -10, -10);
        scene.add(fillLight);

        // Create ESP32 Abstract Device Node (Isometric Shield / Gateway)
        const nodeGroup = new THREE.Group();

        // Base Board (Dark Slate Metallic Plate)
        const boardGeo = new THREE.BoxGeometry(7, 0.6, 9);
        const boardMat = new THREE.MeshStandardMaterial({
            color: 0x0f172a,
            roughness: 0.3,
            metalness: 0.8
        });
        const boardMesh = new THREE.Mesh(boardGeo, boardMat);
        nodeGroup.add(boardMesh);

        // Microcontroller Chip (ESP32 Core)
        const chipGeo = new THREE.BoxGeometry(3, 0.4, 4);
        const chipMat = new THREE.MeshStandardMaterial({
            color: 0x1e293b,
            roughness: 0.2,
            metalness: 0.9
        });
        const chipMesh = new THREE.Mesh(chipGeo, chipMat);
        chipMesh.position.set(0, 0.5, 0);
        nodeGroup.add(chipMesh);

        // Security Shield Emblem on Chip
        const shieldGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.2, 6);
        const shieldMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4, wireframe: true });
        const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
        shieldMesh.position.set(0, 0.8, 0);
        nodeGroup.add(shieldMesh);

        // Status LED Indicator
        const ledGeo = new THREE.SphereGeometry(0.35, 16, 16);
        const ledMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
        const ledMesh = new THREE.Mesh(ledGeo, ledMat);
        ledMesh.position.set(2.4, 0.5, -3.2);
        nodeGroup.add(ledMesh);

        // Outer Pulsing Glow Ring (Reflects Zero-Trust Risk Score)
        const ringGeo = new THREE.RingGeometry(5.8, 6.3, 48);
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

        // Particle Burst System (50 Particles)
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
            color: 0xf43f5e,
            size: 0.4,
            transparent: true,
            opacity: 0
        });
        particleSystem = new THREE.Points(particleGeo, particleMat);
        particleSystem.userData = { velocities: velocities };
        nodeGroup.add(particleSystem);

        scene.add(nodeGroup);
        deviceNode = nodeGroup;

        // Damped OrbitControls Ambient Rotation
        let angle = 0;
        function animate3D() {
            requestAnimationFrame(animate3D);

            // Ambient gentle rotation
            angle += 0.005;
            deviceNode.rotation.y = Math.sin(angle * 0.8) * 0.25;
            deviceNode.rotation.x = Math.cos(angle * 0.5) * 0.08;

            // Pulse ring opacity
            if (ringMesh) {
                ringMesh.material.opacity = 0.5 + Math.sin(Date.now() * 0.003) * 0.35;
            }

            // Handle particle burst animation on security event
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
                    // Reset particle positions
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
        ringMesh.material.color.setHex(0xf43f5e); // Red (Critical)
    } else if (riskScore > 30) {
        ringMesh.material.color.setHex(0xf59e0b); // Amber (Warning)
    } else {
        ringMesh.material.color.setHex(0x10b981); // Green (Safe)
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
