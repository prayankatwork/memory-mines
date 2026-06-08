// game.js — Client game logic: Three.js rendering, mines, particles, effects

class MemoryMinesGame {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // Player
        this.player = { x: 0, z: 0, rotY: 0, pitch: 0 };
        this.inputs = { forward: false, backward: false, left: false, right: false, shooting: false, ability: false };

        // Game state
        this.gameState = 'lobby';
        this.localState = { health: 100, maxHealth: 100, abilityCooldown: 0, alive: true };
        this.enemyState = { x: 0, z: 0, visible: false, alive: true, health: 100 };
        this.matchInfo = { round: 1, scores: { you: 0, enemy: 0 }, zoneRadius: 30, zoneCenterX: 0, zoneCenterZ: 0 };

        // Map
        this.mapData = null;
        this.wallMeshes = [];
        this.floorMeshes = [];
        this.landmarkMeshes = [];
        this.enemyMesh = null;
        this.playerMesh = null;

        // Mines
        this.mineMeshes = [];         // { mesh, glow, type, id, active, triggered }
        this.mineExplosions = [];     // active explosion effects

        // Visual
        this.isDark = false;
        this.fogDensity = 0.02;
        this.pointerLocked = false;
        this.animFrameId = null;

        // Effects
        this.screenShake = { intensity: 0, duration: 0 };
        this.sonarRings = [];         // expanding ring shockwaves
        this.footstepParticles = [];
        this.muzzleFlashMesh = null;
        this.muzzleFlashTimer = 0;

        // Timers
        this.footstepTimer = 0;
        this.lastFootstepPos = { x: 0, z: 0 };
        this.lastGunshotTime = 0;
        this.zoneWarningPlayed = false;
        this.lastMineHumIntensity = 0;

        // Network
        this.network = window.network;
        this.bindNetworkEvents();
    }

    init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x080818);
        this.scene.fog = new THREE.Fog(0x080818, 20, 50);

        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 3, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.8;
        document.getElementById('game-container').prepend(this.renderer.domElement);

        this.setupLights();

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // Pointer lock
        const overlay = document.getElementById('pointer-lock-overlay');
        overlay.addEventListener('click', () => {
            document.body.requestPointerLock();
            window.audio.resume();
        });
        document.addEventListener('pointerlockchange', () => {
            this.pointerLocked = document.pointerLockElement === document.body;
            overlay.style.display = this.pointerLocked ? 'none' : 'flex';
        });

        // Mouse
        document.addEventListener('mousemove', (e) => {
            if (!this.pointerLocked) return;
            const sens = 0.002;
            this.player.rotY -= e.movementX * sens;
            this.player.pitch -= e.movementY * sens;
            this.player.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.player.pitch));
        });

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (!this.pointerLocked) return;
            switch (e.code) {
                case 'KeyW': this.inputs.forward = true; e.preventDefault(); break;
                case 'KeyS': this.inputs.backward = true; e.preventDefault(); break;
                case 'KeyA': this.inputs.left = true; e.preventDefault(); break;
                case 'KeyD': this.inputs.right = true; e.preventDefault(); break;
                case 'Space': this.inputs.ability = true; e.preventDefault(); break;
            }
        });
        document.addEventListener('keyup', (e) => {
            switch (e.code) {
                case 'KeyW': this.inputs.forward = false; e.preventDefault(); break;
                case 'KeyS': this.inputs.backward = false; e.preventDefault(); break;
                case 'KeyA': this.inputs.left = false; e.preventDefault(); break;
                case 'KeyD': this.inputs.right = false; e.preventDefault(); break;
                case 'Space': this.inputs.ability = false; e.preventDefault(); break;
            }
        });

        // Mouse click
        document.addEventListener('mousedown', (e) => {
            if (e.button === 0 && this.pointerLocked) {
                this.inputs.shooting = true;
                const now = Date.now();
                if (now - this.lastGunshotTime >= 450) {
                    this.lastGunshotTime = now;
                    window.audio.gunshot();
                    window.audio.muzzleFlash();
                    // Show muzzle flash briefly
                    this.muzzleFlashTimer = 100;
                }
            }
        });
        document.addEventListener('mouseup', (e) => {
            if (e.button === 0) this.inputs.shooting = false;
        });

        window.audio.init();
    }

    setupLights() {
        const ambient = new THREE.AmbientLight(0x111133, 0.4);
        this.scene.add(ambient);
        const dir = new THREE.DirectionalLight(0x3355cc, 0.2);
        dir.position.set(10, 20, 10);
        dir.castShadow = true;
        this.scene.add(dir);
        this.playerLight = new THREE.PointLight(0x4488ff, 0.4, 18);
        this.playerLight.position.set(0, 6, 0);
        this.scene.add(this.playerLight);
    }

    bindNetworkEvents() {
        this.network.on('state_update', (msg) => this.onStateUpdate(msg));
        this.network.on('darkness', () => this.onDarkness());
        this.network.on('sonar_pulse', (msg) => this.onSonarPulse(msg));
        this.network.on('you_died', (msg) => this.onYouDied(msg));
        this.network.on('round_end', (msg) => this.onRoundEnd(msg));
        this.network.on('new_round', (msg) => this.onNewRound(msg));
        this.network.on('match_end', (msg) => this.onMatchEnd(msg));
        this.network.on('you_were_hit', (msg) => this.onYouWereHit(msg));
        this.network.on('hit_confirmed', () => this.onHitConfirmed());
        this.network.on('enemy_killed', () => this.onEnemyKilled());
        this.network.on('footstep', () => this.onEnemyFootstep());
        this.network.on('zone_update', (msg) => this.onZoneUpdate(msg));
        this.network.on('rematch_available', () => this.onRematchAvailable());
        this.network.on('rematch_requested', () => this.onRematchRequested());
        this.network.on('rematch_declined', () => this.onRematchDeclined());
        this.network.on('opponent_disconnected', (msg) => this.onOpponentDisconnected(msg));
        // New events
        this.network.on('mine_explosion', (msg) => this.onMineExplosion(msg));
        this.network.on('proximity_beep', (msg) => this.onProximityBeep(msg));
        this.network.on('muzzle_flash', (msg) => this.onEnemyMuzzleFlash(msg));
        this.network.on('player_detected', (msg) => this.onPlayerDetected(msg));
        this.network.on('decoy_found', (msg) => this.onDecoyFound(msg));
    }

    buildMap(mapData) {
        this.clearMap();
        this.mapData = mapData;
        const grid = mapData.grid;
        const gs = mapData.gridSize;
        const ts = mapData.tileSize;
        const ms = mapData.mapSize;

        // Floor
        const floorGeo = new THREE.PlaneGeometry(ms, ms);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x111122,
            roughness: 0.85,
            metalness: 0.15,
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(0, -0.1, 0);
        floor.receiveShadow = true;
        this.scene.add(floor);
        this.floorMeshes.push(floor);

        // Grid
        const gridHelper = new THREE.GridHelper(ms, gs, 0x1a1a33, 0x111128);
        gridHelper.position.y = 0.01;
        this.scene.add(gridHelper);

        // Walls
        const wallMat = new THREE.MeshStandardMaterial({ color: 0x222244, roughness: 0.7, metalness: 0.3 });
        const pillarMat = new THREE.MeshStandardMaterial({ color: 0x333355, roughness: 0.5, metalness: 0.4 });
        for (let y = 0; y < gs; y++) {
            for (let x = 0; x < gs; x++) {
                const tile = grid[y][x];
                if (tile === 0) continue;
                const wx = x * ts + ts / 2 - ms / 2;
                const wz = y * ts + ts / 2 - ms / 2;
                if (tile === 1) {
                    const m = new THREE.Mesh(new THREE.BoxGeometry(ts, 3, ts), wallMat);
                    m.position.set(wx, 1.5, wz);
                    m.castShadow = true; m.receiveShadow = true;
                    this.scene.add(m); this.wallMeshes.push(m);
                } else if (tile === 2) {
                    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 3, 6), pillarMat);
                    m.position.set(wx, 1.5, wz);
                    m.castShadow = true;
                    this.scene.add(m); this.wallMeshes.push(m);
                }
            }
        }

        // Landmarks
        this.buildLandmarks(mapData.landmarks, ts, ms);

        // Player model — low-poly humanoid
        this.playerMesh = this.createPlayerModel(0x00e5ff);
        this.playerMesh.position.set(0, 1, 0);
        this.scene.add(this.playerMesh);

        // Enemy model — red variant
        this.enemyMesh = this.createPlayerModel(0xff4466);
        this.enemyMesh.position.set(0, 1, 0);
        this.enemyMesh.visible = false;
        this.scene.add(this.enemyMesh);

        // Mines
        this.buildMines(mapData.mines);

        // Zone ring
        this.createZoneRing();

        // Muzzle flash mesh
        const flashGeo = new THREE.SphereGeometry(0.5, 8, 8);
        const flashMat = new THREE.MeshBasicMaterial({ color: 0xffff88, transparent: true, opacity: 0.9 });
        this.muzzleFlashMesh = new THREE.Mesh(flashGeo, flashMat);
        this.muzzleFlashMesh.visible = false;
        this.scene.add(this.muzzleFlashMesh);
    }

    createPlayerModel(color) {
        const group = new THREE.Group();

        // Body
        const bodyMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2, roughness: 0.4, metalness: 0.6 });
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 1.0, 6), bodyMat);
        body.position.y = 0.6;
        group.add(body);

        // Head
        const headMat = new THREE.MeshStandardMaterial({ color: 0xeeeeff, roughness: 0.3, metalness: 0.1 });
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), headMat);
        head.position.y = 1.2;
        group.add(head);

        // Visor
        const visorMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.6 });
        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.06), visorMat);
        visor.position.set(0, 1.25, -0.2);
        group.add(visor);

        // Shoulder pads
        const padMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.1 });
        const leftPad = new THREE.Mesh(new THREE.SphereGeometry(0.12, 4, 4), padMat);
        leftPad.position.set(-0.35, 1.0, 0);
        group.add(leftPad);
        const rightPad = new THREE.Mesh(new THREE.SphereGeometry(0.12, 4, 4), padMat);
        rightPad.position.set(0.35, 1.0, 0);
        group.add(rightPad);

        // Glow ring (emissive aura)
        const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.15, side: THREE.BackSide });
        const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 1.3, 8), glowMat);
        glow.position.y = 0.6;
        group.add(glow);

        group.castShadow = true;
        return group;
    }

    buildLandmarks(landmarks, ts, ms) {
        if (!landmarks) return;
        const colors = { tower: 0x44aaff, bridge: 0x88ccff, tunnel: 0x6644aa, arena: 0xffaa44, ruins: 0x886644 };
        for (const lm of landmarks) {
            const wx = lm.gx * ts + ts / 2 - ms / 2;
            const wz = lm.gy * ts + ts / 2 - ms / 2;
            const color = colors[lm.type] || 0x666688;
            const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.08, roughness: 0.4, metalness: 0.3 });
            let mesh;
            switch (lm.type) {
                case 'tower':
                    mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1, 5, 6), mat);
                    mesh.position.set(wx, 2.5, wz); break;
                case 'bridge':
                    mesh = new THREE.Mesh(new THREE.BoxGeometry(lm.size, 1, 0.5), mat);
                    mesh.position.set(wx, 0.5, wz); break;
                case 'tunnel':
                    mesh = new THREE.Mesh(new THREE.BoxGeometry(lm.size, 1.5, 2.5), mat);
                    mesh.position.set(wx, 0.25, wz); break;
                case 'arena':
                    mesh = new THREE.Mesh(new THREE.RingGeometry(1.5, 3, 12), mat.clone());
                    mesh.rotation.x = -Math.PI / 2; mesh.position.set(wx, 0.05, wz); break;
                case 'ruins':
                    mesh = new THREE.Mesh(new THREE.BoxGeometry(lm.size, 0.5 + Math.random(), lm.size), mat);
                    mesh.position.set(wx, 0.25, wz); break;
                default:
                    mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
                    mesh.position.set(wx, 0.5, wz);
            }
            mesh.castShadow = true; mesh.receiveShadow = true;
            this.scene.add(mesh); this.landmarkMeshes.push(mesh);
        }
    }

    // ── Mines ──
    buildMines(mines) {
        this.clearMines();
        if (!mines) return;
        for (const m of mines) {
            const group = new THREE.Group();

            // Core orb
            let color, emissiveColor;
            switch (m.type) {
                case 'trigger': color = 0xff2244; emissiveColor = 0xff0044; break;
                case 'proximity': color = 0xff8800; emissiveColor = 0xff6600; break;
                case 'decoy': color = 0x4488ff; emissiveColor = 0x2266ff; break;
                default: color = 0xff4466; emissiveColor = 0xff0044;
            }

            const orbMat = new THREE.MeshStandardMaterial({
                color, emissive: emissiveColor, emissiveIntensity: 0.4,
                roughness: 0.3, metalness: 0.7, transparent: true, opacity: 0.9
            });
            const orb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), orbMat);
            group.add(orb);

            // Outer glow
            const glowMat = new THREE.MeshBasicMaterial({
                color: emissiveColor, transparent: true, opacity: 0.15, side: THREE.BackSide
            });
            const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), glowMat);
            group.add(glow);

            // Proximity: ring around it
            if (m.type === 'proximity') {
                const ringMat = new THREE.MeshBasicMaterial({
                    color: 0xff8800, transparent: true, opacity: 0.2, side: THREE.DoubleSide
                });
                const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.45, 12), ringMat);
                ring.rotation.x = Math.PI / 2;
                ring.position.y = 0.1;
                group.add(ring);
            }

            // Decoy: small ring
            if (m.type === 'decoy') {
                const ringMat = new THREE.MeshBasicMaterial({
                    color: 0x4488ff, transparent: true, opacity: 0.15, side: THREE.DoubleSide
                });
                const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.38, 8), ringMat);
                ring.rotation.x = Math.PI / 2;
                group.add(ring);
            }

            group.position.set(m.x, 0.15, m.z);
            this.scene.add(group);

            this.mineMeshes.push({
                group, orb, glow,
                id: m.id,
                type: m.type,
                x: m.x, z: m.z,
                active: true,
                triggered: false,
                bobPhase: Math.random() * Math.PI * 2
            });
        }
    }

    createZoneRing() {
        const geo = new THREE.RingGeometry(0, 1, 32);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xff4466, transparent: true, opacity: 0.15, side: THREE.DoubleSide
        });
        this.zoneRing = new THREE.Mesh(geo, mat);
        this.zoneRing.rotation.x = -Math.PI / 2;
        this.zoneRing.position.y = 0.05;
        this.scene.add(this.zoneRing);

        const edgeMat = new THREE.LineBasicMaterial({ color: 0xff4466, transparent: true, opacity: 0.25 });
        const points = [];
        for (let i = 0; i <= 32; i++) {
            const a = (i / 32) * Math.PI * 2;
            points.push(new THREE.Vector3(Math.cos(a), 0.08, Math.sin(a)));
        }
        const edgeGeo = new THREE.BufferGeometry().setFromPoints(points);
        this.zoneEdge = new THREE.Line(edgeGeo, edgeMat);
        this.scene.add(this.zoneEdge);
    }

    updateZoneRing() {
        if (!this.zoneRing || !this.zoneEdge) return;
        const r = this.matchInfo.zoneRadius;
        const cx = this.matchInfo.zoneCenterX;
        const cz = this.matchInfo.zoneCenterZ;

        const geo = new THREE.RingGeometry(Math.max(0, r - 0.3), r, 32);
        this.zoneRing.geometry.dispose();
        this.zoneRing.geometry = geo;
        this.zoneRing.position.set(cx, 0.05, cz);

        const pts = [];
        for (let i = 0; i <= 32; i++) {
            const a = (i / 32) * Math.PI * 2;
            pts.push(new THREE.Vector3(cx + Math.cos(a) * r, 0.08, cz + Math.sin(a) * r));
        }
        const edgeGeo = new THREE.BufferGeometry().setFromPoints(pts);
        this.zoneEdge.geometry.dispose();
        this.zoneEdge.geometry = edgeGeo;
    }

    clearMap() {
        this.clearMines();
        for (const m of [...this.wallMeshes, ...this.floorMeshes, ...this.landmarkMeshes]) {
            this.scene.remove(m);
            if (m.geometry) m.geometry.dispose();
            if (m.material) m.material.dispose();
        }
        this.wallMeshes = [];
        this.floorMeshes = [];
        this.landmarkMeshes = [];
        if (this.playerMesh) { this.scene.remove(this.playerMesh); this.playerMesh = null; }
        if (this.enemyMesh) { this.scene.remove(this.enemyMesh); this.enemyMesh = null; }
        if (this.zoneRing) { this.scene.remove(this.zoneRing); this.zoneRing = null; }
        if (this.zoneEdge) { this.scene.remove(this.zoneEdge); this.zoneEdge = null; }
        if (this.muzzleFlashMesh) { this.scene.remove(this.muzzleFlashMesh); this.muzzleFlashMesh = null; }
    }

    clearMines() {
        for (const m of this.mineMeshes) {
            this.scene.remove(m.group);
        }
        this.mineMeshes = [];
    }

    // ── Game Events ──
    onMatchStart(msg) {
        this.gameState = 'memorize';
        this.isDark = false;
        this.matchInfo.round = msg.round;
        this.localState.alive = true;
        this.localState.health = 100;
        this.enemyState.alive = true;
        this.enemyState.health = 100;
        this.sonarRings = [];
        this.mineExplosions = [];

        this.buildMap(msg.map);
        this.player.x = msg.yourSpawn.x;
        this.player.z = msg.yourSpawn.z;
        this.enemyState.x = msg.opponentSpawn.x;
        this.enemyState.z = msg.opponentSpawn.z;

        document.getElementById('lobby').classList.add('hidden');
        document.getElementById('game-ui').classList.remove('hidden');

        window.audio.roundStart();
        this.updateHUD();
    }

    onDarkness() {
        this.isDark = true;
        this.gameState = 'dark';
        if (this.scene) this.scene.fog = new THREE.Fog(0x080818, 8, 30);
        if (this.playerLight) this.playerLight.intensity = 0.15;
        window.audio.startZoneWind();
    }

    onStateUpdate(msg) {
        if (!this.renderer) return;

        // Local
        if (msg.you) {
            this.player.x = msg.you.x;
            this.player.z = msg.you.z;
            this.localState.health = msg.you.health;
            this.localState.abilityCooldown = msg.you.abilityCooldown;
            this.localState.abilityActive = msg.you.abilityActive;
            this.localState.alive = msg.you.alive;
        }

        // Enemy
        if (msg.enemy) {
            this.enemyState.x = msg.enemy.x;
            this.enemyState.z = msg.enemy.z;
            this.enemyState.visible = msg.enemy.visible || msg.enemy.muzzleFlash;
            this.enemyState.alive = msg.enemy.alive;
            this.enemyState.health = msg.enemy.health;
        }

        if (msg.gameState) this.gameState = msg.gameState;
        if (msg.round) this.matchInfo.round = msg.round;

        // Phase display
        if (msg.gameState === 'memorize' && msg.memorizeTimeLeft !== undefined) {
            document.getElementById('phase-text').textContent = `MEMORIZE — ${msg.memorizeTimeLeft}s`;
        } else if (msg.gameState === 'dark') {
            document.getElementById('phase-text').textContent = msg.zoneShrinking ? '⚡ ZONE SHRINKING ⚡' : 'DARK';
        }

        // Zone
        if (msg.zoneRadius !== undefined) {
            this.matchInfo.zoneRadius = msg.zoneRadius;
            this.matchInfo.zoneCenterX = msg.zoneCenterX || 0;
            this.matchInfo.zoneCenterZ = msg.zoneCenterZ || 0;
            this.updateZoneRing();
        }

        // Zone warning
        const distFromCenter = Math.sqrt(this.player.x ** 2 + this.player.z ** 2);
        const zw = document.getElementById('zone-warning');
        if (distFromCenter > this.matchInfo.zoneRadius - 2) {
            zw.classList.remove('hidden');
            if (!this.zoneWarningPlayed) {
                this.zoneWarningPlayed = true;
                window.audio.zoneWarning();
                setTimeout(() => { this.zoneWarningPlayed = false; }, 2000);
            }
        } else {
            zw.classList.add('hidden');
            this.zoneWarningPlayed = false;
        }

        // Update mine visibility
        this.updateMineVisibility(msg.visibleMines || []);

        this.updateHUD();
        this.updateVisuals();
    }

    updateMineVisibility(visibleMines) {
        const visibleIds = new Set(visibleMines.map(m => m.id));
        const activeVisible = new Set(visibleMines.filter(m => m.active && !m.triggered).map(m => m.id));

        for (const m of this.mineMeshes) {
            const shouldShow = visibleIds.has(m.id) && m.active && !m.triggered;
            m.group.visible = shouldShow;

            // Update state from server
            const serverMine = visibleMines.find(vm => vm.id === m.id);
            if (serverMine) {
                if (serverMine.triggered && !m.triggered) {
                    this.triggerMineVisual(m);
                }
            }
        }

        // Mine proximity hum based on nearest active, hidden mine
        if (this.gameState === 'dark') {
            let minDist = Infinity;
            for (const m of this.mineMeshes) {
                if (!m.active || m.triggered || m.type === 'decoy') continue;
                if (activeVisible.has(m.id)) continue; // Already visible
                const dx = this.player.x - m.x;
                const dz = this.player.z - m.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist < minDist) minDist = dist;
            }

            if (minDist < 5 && minDist > 0) {
                const intensity = Math.max(0, 1 - minDist / 5);
                if (!window.audio.mineHumRunning) {
                    window.audio.startMineHum(intensity);
                } else {
                    window.audio.updateMineHum(intensity);
                }
                this.lastMineHumIntensity = intensity;
            } else {
                if (window.audio.mineHumRunning) {
                    window.audio.stopMineHum();
                }
                this.lastMineHumIntensity = 0;
            }
        }
    }

    triggerMineVisual(mine) {
        mine.triggered = true;
        mine.active = false;
        // Flash the mesh rapidly then hide
        let flashes = 0;
        const flashInterval = setInterval(() => {
            mine.group.visible = !mine.group.visible;
            flashes++;
            if (flashes >= 4) {
                clearInterval(flashInterval);
                mine.group.visible = false;
            }
        }, 50);
    }

    // ── Mine Events ──
    onMineExplosion(msg) {
        // Screen shake
        this.screenShake = { intensity: msg.mineType === 'proximity' ? 8 : 5, duration: 300 };

        // Create explosion particles
        this.createExplosionEffect(msg.x, msg.z, msg.mineType);

        // Audio
        window.audio.mineExplosion(msg.mineType);

        // Mark mine as triggered locally
        const mine = this.mineMeshes.find(m => m.id === msg.mineId);
        if (mine && !mine.triggered) this.triggerMineVisual(mine);
    }

    createExplosionEffect(x, z, type) {
        const colors = type === 'proximity' ? [0xff6600, 0xffaa00, 0xff4400] : [0xff2244, 0xff4466, 0xff0044];
        const count = type === 'proximity' ? 25 : 15;
        const particles = [];

        for (let i = 0; i < count; i++) {
            const color = colors[Math.floor(Math.random() * colors.length)];
            const size = 0.05 + Math.random() * 0.1;
            const mat = new THREE.MeshBasicMaterial({
                color, transparent: true, opacity: 1
            });
            const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 4, 4), mat);
            mesh.position.set(
                x + (Math.random() - 0.5) * 0.5,
                0.1 + Math.random() * 0.3,
                z + (Math.random() - 0.5) * 0.5
            );
            const vel = {
                x: (Math.random() - 0.5) * 4,
                y: 1 + Math.random() * 3,
                z: (Math.random() - 0.5) * 4
            };
            this.scene.add(mesh);
            particles.push({ mesh, vel, life: 1.0, decay: 0.5 + Math.random() * 0.5 });
        }
        this.mineExplosions.push(...particles);
    }

    onProximityBeep(msg) {
        window.audio.proximityBeep(msg.count, msg.total);
        // Flash the mine visually
        const mine = this.mineMeshes.find(m => m.id === msg.mineId);
        if (mine && mine.active && !mine.triggered) {
            mine.group.visible = !mine.group.visible;
            setTimeout(() => { if (mine.group) mine.group.visible = true; }, 100);
        }
    }

    onEnemyMuzzleFlash(msg) {
        // Flash the enemy position briefly
        if (this.enemyMesh) {
            this.enemyMesh.visible = true;
            this.enemyState.x = msg.x;
            this.enemyState.z = msg.z;
            setTimeout(() => {
                if (!this.enemyState.visible) this.enemyMesh.visible = false;
            }, msg.duration || 400);
        }
        window.audio.gunshot();
        window.audio.muzzleFlash();
    }

    onPlayerDetected(msg) {
        // Show detection indicator
        document.getElementById('kill-feed').textContent = `🔍 Enemy detected! (${msg.reason === 'mine_explosion' ? 'Mine explosion' : 'Detected'})`;
        setTimeout(() => document.getElementById('kill-feed').textContent = '', 3000);
    }

    onDecoyFound(msg) {
        window.audio.decoyPing();
        const mine = this.mineMeshes.find(m => m.id === msg.mineId);
        if (mine) {
            mine.triggered = true;
            // Brief green flash then fade
            if (mine.orb) mine.orb.material.color.setHex(0x44ff88);
            setTimeout(() => { mine.group.visible = false; }, 300);
        }
    }

    onSonarPulse(msg) {
        const flash = document.getElementById('sonar-flash');
        flash.classList.remove('hidden');
        setTimeout(() => flash.classList.add('hidden'), 500);
        window.audio.sonarPing();

        // Create expanding ring effect
        if (this.scene) {
            const ringMat = new THREE.MeshBasicMaterial({
                color: 0x00e5ff, transparent: true, opacity: 0.4, side: THREE.DoubleSide
            });
            // Initial ring inner=0.1, outer=0.5, midpoint ~0.3
            const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.5, 24), ringMat);
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(msg.x, 0.12, msg.z);
            this.scene.add(ring);
            this.sonarRings.push({ mesh: ring, radius: 0, initRadius: 0.3, maxRadius: msg.radius || 15, life: 1.0 });
        }
    }

    onYouDied(msg) {
        this.localState.alive = false;
        window.audio.stopMineHum();
        const ds = document.getElementById('death-screen');
        ds.classList.remove('hidden');
        const detectionLabels = {
            'sonar_pulse': 'Enemy used Sonar Pulse',
            'mine_explosion': 'Stepped on a mine!',
            'reveal_phase': 'Enemy saw you during reveal',
            'line_of_sight': 'Enemy had line of sight',
            'shot': 'Shot by enemy',
            'mine': 'Mine explosion',
            'zone': 'Zone damage'
        };
        const label = detectionLabels[msg.detectedBy] || 'Unknown';
        document.getElementById('death-info').innerHTML =
            `Killed by <strong>${msg.killerName}</strong><br>` +
            `Direction: ${msg.direction} | Distance: ~${msg.distance}m<br>` +
            `<span style="color:#ffaa00;font-size:0.85rem">${label}</span>`;

        let timeLeft = 5;
        const timer = setInterval(() => {
            timeLeft--;
            document.getElementById('death-timer').textContent = `Respawning in ${timeLeft}...`;
            if (timeLeft <= 0) { clearInterval(timer); ds.classList.add('hidden'); }
        }, 1000);
        window.audio.death();
    }

    onYouWereHit(msg) {
        window.audio.hit();
        // Damage direction indicator
        document.getElementById('damage-indicator').classList.remove('hidden');
        setTimeout(() => document.getElementById('damage-indicator').classList.add('hidden'), 300);
        const dir = msg.direction || '';
        document.getElementById('kill-feed').textContent = `💥 Hit by ${msg.attackerName} (${dir})`;
        setTimeout(() => {
            if (document.getElementById('kill-feed').textContent.includes('Hit'))
                document.getElementById('kill-feed').textContent = '';
        }, 2000);
    }

    onHitConfirmed() { window.audio.hit(); }

    onEnemyKilled() {
        this.matchInfo.scores.you++;
        document.getElementById('kill-feed').textContent = '🎯 Enemy eliminated!';
        setTimeout(() => document.getElementById('kill-feed').textContent = '', 3000);
    }

    onEnemyFootstep() {
        window.audio.footstep('stone');
    }

    onRoundEnd(msg) {
        this.gameState = 'round_end';
        window.audio.stopMineHum();
        const myScore = msg.scores[this.network.playerId] || 0;
        const enemyId = Object.keys(msg.scores).find(k => k !== this.network.playerId);
        const enemyScore = msg.scores[enemyId] || 0;
        this.matchInfo.scores.you = myScore;
        this.matchInfo.scores.enemy = enemyScore;

        const re = document.getElementById('round-end-screen');
        re.classList.remove('hidden');
        const isWinner = msg.winner === this.network.playerId;
        document.getElementById('round-end-text').textContent = isWinner ? 'ROUND WON' : 'ROUND LOST';
        document.getElementById('round-end-text').style.color = isWinner ? '#00e5ff' : '#ff4466';
        document.getElementById('round-end-cause').textContent = msg.cause === 'mine' ? '💥 Mine kill' : msg.cause === 'zone' ? '⚡ Zone kill' : '🔫 Shot kill';
        setTimeout(() => re.classList.add('hidden'), 4000);
    }

    onNewRound(msg) {
        this.gameState = 'memorize';
        this.isDark = false;
        this.matchInfo.round = msg.round;
        this.localState.alive = true;
        this.localState.health = 100;
        this.enemyState.alive = true;
        this.sonarRings = [];
        this.mineExplosions = [];
        window.audio.stopZoneWind();
        window.audio.stopMineHum();

        this.player.x = msg.spawn.x;
        this.player.z = msg.spawn.z;
        this.enemyState.x = msg.opponentSpawn.x;
        this.enemyState.z = msg.opponentSpawn.z;

        if (this.scene) this.scene.fog = new THREE.Fog(0x080818, 20, 50);
        if (this.playerLight) this.playerLight.intensity = 0.4;

        // Rebuild mines from fresh data
        this.clearMines();
        this.buildMines(msg.mines);

        window.audio.roundStart();
    }

    onMatchEnd(msg) {
        this.gameState = 'match_end';
        window.audio.stopMineHum();
        window.audio.stopZoneWind();
        const me = document.getElementById('match-end-screen');
        me.classList.remove('hidden');
        const isWinner = msg.winner === this.network.playerId;
        document.getElementById('match-end-text').textContent = isWinner ? 'YOU WIN!' : 'YOU LOSE';
        document.getElementById('match-end-text').style.color = isWinner ? '#00e5ff' : '#ff4466';
        const enemyId = Object.keys(msg.finalScores).find(k => k !== this.network.playerId);
        document.getElementById('match-scores').textContent =
            `You: ${msg.finalScores[this.network.playerId] || 0} — Enemy: ${msg.finalScores[enemyId] || 0}`;
    }

    onRematchAvailable() { document.getElementById('rematch-section').classList.remove('hidden'); }
    onRematchRequested() { this.network.requestRematch(); }
    onRematchDeclined() {
        document.getElementById('rematch-section').classList.add('hidden');
        document.getElementById('match-end-screen').classList.add('hidden');
        document.getElementById('lobby').classList.remove('hidden');
        this.gameState = 'lobby';
    }

    onOpponentDisconnected(msg) {
        document.getElementById('kill-feed').textContent = msg.message || 'Opponent disconnected';
        setTimeout(() => {
            document.getElementById('game-ui').classList.add('hidden');
            document.getElementById('lobby').classList.remove('hidden');
            this.gameState = 'lobby';
        }, 3000);
    }

    onZoneUpdate(msg) {
        this.matchInfo.zoneRadius = msg.radius;
        this.matchInfo.zoneCenterX = msg.centerX || 0;
        this.matchInfo.zoneCenterZ = msg.centerZ || 0;
        this.updateZoneRing();
    }

    // ── HUD ──
    updateHUD() {
        const hp = this.localState.health;
        const maxHp = this.localState.maxHealth;
        const pct = Math.max(0, (hp / maxHp) * 100);
        document.getElementById('health-fill').style.width = pct + '%';
        document.getElementById('health-fill').style.background =
            hp > 50 ? `linear-gradient(90deg, #00e5ff, #00ff88)` :
            hp > 25 ? `linear-gradient(90deg, #ffaa00, #ff6600)` :
            `linear-gradient(90deg, #ff4400, #ff0000)`;
        document.getElementById('health-text').textContent = Math.max(0, Math.round(hp));

        const maxCd = 10000;
        const cdPct = this.localState.abilityActive ? 0 : Math.max(0, (this.localState.abilityCooldown / maxCd) * 100);
        document.getElementById('ability-fill').style.width = (100 - cdPct) + '%';
        document.getElementById('ability-text').textContent = this.localState.abilityActive ? 'SCANNING' : 'SONAR SCAN';
        document.getElementById('ability-key').textContent = this.localState.abilityCooldown <= 0 ? '[READY]' : `[${Math.ceil(this.localState.abilityCooldown / 1000)}s]`;

        document.getElementById('round-info').textContent = `Round ${this.matchInfo.round}`;
        document.getElementById('score-you').textContent = `You: ${this.matchInfo.scores.you || 0}`;
        document.getElementById('score-enemy').textContent = `Enemy: ${this.matchInfo.scores.enemy || 0}`;
    }

    // ── Visual Update ──
    updateVisuals() {
        // Player mesh
        if (this.playerMesh) {
            this.playerMesh.position.set(this.player.x, 0, this.player.z);
            this.playerMesh.rotation.y = -this.player.rotY;
        }

        // Camera
        this.camera.position.set(this.player.x, 2.5 + Math.max(0, this.player.pitch * 2), this.player.z);
        const lookX = this.player.x + Math.sin(this.player.rotY) * Math.cos(this.player.pitch);
        const lookY = 2.5 - Math.sin(this.player.pitch) * 2;
        const lookZ = this.player.z + Math.cos(this.player.rotY) * Math.cos(this.player.pitch);
        this.camera.lookAt(lookX, lookY, lookZ);

        if (this.playerLight) this.playerLight.position.set(this.player.x, 6, this.player.z);

        // Enemy
        if (this.enemyMesh) {
            const visible = this.enemyState.visible && this.enemyState.alive;
            this.enemyMesh.visible = visible || this.gameState === 'memorize';
            if (this.enemyMesh.visible && this.enemyState.alive) {
                this.enemyMesh.position.set(this.enemyState.x, 0, this.enemyState.z);
                // Face toward player if visible
                const dx = this.player.x - this.enemyState.x;
                const dz = this.player.z - this.enemyState.z;
                this.enemyMesh.rotation.y = -Math.atan2(dx, dz);
            }
        }

        // Muzzle flash on player
        if (this.muzzleFlashMesh) {
            if (this.muzzleFlashTimer > 0) {
                this.muzzleFlashMesh.position.set(this.player.x, 1.2, this.player.z);
                this.muzzleFlashMesh.visible = true;
                this.muzzleFlashMesh.scale.setScalar(1 + Math.random() * 0.5);
                this.muzzleFlashTimer -= 16;
            } else {
                this.muzzleFlashMesh.visible = false;
            }
        }

        // Fog
        if (this.isDark && this.scene.fog) {
            this.scene.fog.far = Math.max(10, 30 - this.fogDensity * 50);
        } else if (this.scene.fog) {
            this.scene.fog.far = 50;
        }

        // Screen shake
        if (this.screenShake.duration > 0) {
            const intensity = this.screenShake.intensity;
            this.camera.position.x += (Math.random() - 0.5) * intensity * 0.02;
            this.camera.position.y += (Math.random() - 0.5) * intensity * 0.02;
            this.screenShake.duration -= 16;
            this.screenShake.intensity *= 0.95;
        }
    }

    // ── Update Effects (called every frame) ──
    updateEffects() {
        // Mine bob animation
        const time = Date.now() / 1000;
        for (const m of this.mineMeshes) {
            if (!m.active || m.triggered || !m.group.visible) continue;
            m.group.position.y = 0.15 + Math.sin(time * 2 + m.bobPhase) * 0.05;
            if (m.glow) {
                const pulse = 0.1 + 0.1 * Math.sin(time * 3 + m.bobPhase);
                m.glow.material.opacity = pulse;
            }
        }

        // Sonar rings
        for (let i = this.sonarRings.length - 1; i >= 0; i--) {
            const sr = this.sonarRings[i];
            sr.radius += 0.3;
            sr.life -= 0.025;
            const scale = sr.radius / sr.initRadius;
            sr.mesh.scale.setScalar(scale);
            sr.mesh.material.opacity = sr.life * 0.4;
            if (sr.life <= 0) {
                this.scene.remove(sr.mesh);
                sr.mesh.geometry.dispose();
                sr.mesh.material.dispose();
                this.sonarRings.splice(i, 1);
            }
        }

        // Explosion particles
        for (let i = this.mineExplosions.length - 1; i >= 0; i--) {
            const p = this.mineExplosions[i];
            p.mesh.position.x += p.vel.x * 0.016;
            p.mesh.position.y += p.vel.y * 0.016;
            p.mesh.position.z += p.vel.z * 0.016;
            p.vel.y -= 4 * 0.016; // gravity
            p.life -= p.decay * 0.016;
            p.mesh.material.opacity = Math.max(0, p.life);
            p.mesh.scale.setScalar(p.life);
            if (p.life <= 0) {
                this.scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
                this.mineExplosions.splice(i, 1);
            }
        }
    }

    // ── Send Inputs ──
    sendInputs() {
        if (this.gameState !== 'memorize' && this.gameState !== 'dark') return;
        if (!this.localState.alive) return;

        this.network.sendInput({
            forward: this.inputs.forward,
            backward: this.inputs.backward,
            left: this.inputs.left,
            right: this.inputs.right,
            shooting: this.inputs.shooting,
            ability: this.inputs.ability,
            mouseX: this.player.rotY,
            mouseY: this.player.pitch
        });

        // Reset one-shot inputs
        this.inputs.ability = false;

        // Local footsteps
        if (this.inputs.forward || this.inputs.backward || this.inputs.left || this.inputs.right) {
            this.footstepTimer += 16;
            const moved = Math.abs(this.player.x - this.lastFootstepPos.x) + Math.abs(this.player.z - this.lastFootstepPos.z);
            if (this.footstepTimer > 300 || moved > 2) {
                this.footstepTimer = 0;
                this.lastFootstepPos.x = this.player.x;
                this.lastFootstepPos.z = this.player.z;
                window.audio.footstep('stone');
            }
        }
    }

    // ── Game Loop ──
    gameLoop() {
        if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
        const loop = () => {
            this.sendInputs();
            this.updateEffects();
            this.renderer.render(this.scene, this.camera);
            this.animFrameId = requestAnimationFrame(loop);
        };
        loop();
    }

    stop() {
        if (this.animFrameId) { cancelAnimationFrame(this.animFrameId); this.animFrameId = null; }
        window.audio.stopMineHum();
        window.audio.stopZoneWind();
    }
}

// Global instance
window.game = new MemoryMinesGame();
