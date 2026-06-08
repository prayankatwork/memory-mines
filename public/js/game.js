// game.js — Main client game logic: Three.js rendering, map, player, HUD, game state

class MemoryMinesGame {
    constructor() {
        // Three.js
        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // Player
        this.player = { x: 0, z: 0, rotY: 0, pitch: 0 };
        this.inputs = { forward: false, backward: false, left: false, right: false, shooting: false, ability: false };

        // Game state
        this.gameState = 'lobby'; // lobby, queue, match_found, reveal, dark, round_end, match_end
        this.localState = { health: 100, maxHealth: 100, abilityCooldown: 0, isRevealing: false, alive: true };
        this.enemyState = { x: 0, z: 0, visible: false, alive: true, health: 100 };
        this.matchInfo = { round: 1, scores: { you: 0, enemy: 0 }, zoneRadius: 30, zoneCenterX: 0, zoneCenterZ: 0 };

        // Map
        this.mapData = null;
        this.mapMesh = null;
        this.wallMeshes = [];
        this.floorMeshes = [];
        this.landmarkMeshes = [];
        this.enemyMesh = null;
        this.playerMesh = null;

        // Visual
        this.isDark = false;
        this.fogDensity = 0.02;
        this.pointerLocked = false;
        this.animFrameId = null;

        // Re-reveal
        this.revealTimer = 0;
        this.lastInputTime = 0;

        // Footstep timer
        this.footstepTimer = 0;
        this.lastFootstepPos = { x: 0, z: 0 };

        // Network
        this.network = window.network;
        this.bindNetworkEvents();
    }

    // ── Initialization ──
    init() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a1a);
        this.scene.fog = new THREE.Fog(0x0a0a1a, 20, 50);

        // Camera
        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 3, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        document.getElementById('game-container').prepend(this.renderer.domElement);

        // Lights
        this.setupLights();

        // Resize
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

        // Mouse move
        document.addEventListener('mousemove', (e) => {
            if (!this.pointerLocked) return;
            const sensitivity = 0.002;
            this.player.rotY -= e.movementX * sensitivity;
            this.player.pitch -= e.movementY * sensitivity;
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

        // Mouse click (shoot)
        document.addEventListener('mousedown', (e) => {
            if (e.button === 0 && this.pointerLocked) {
                this.inputs.shooting = true;
                window.audio.gunshot();
            }
        });
        document.addEventListener('mouseup', (e) => {
            if (e.button === 0) this.inputs.shooting = false;
        });

        // Start audio context
        window.audio.init();
    }

    setupLights() {
        // Ambient
        const ambient = new THREE.AmbientLight(0x222244, 0.5);
        this.scene.add(ambient);

        // Directional (simulates moonlight)
        const dir = new THREE.DirectionalLight(0x4466ff, 0.3);
        dir.position.set(10, 20, 10);
        dir.castShadow = true;
        this.scene.add(dir);

        // Point light for player (follows)
        this.playerLight = new THREE.PointLight(0x4488ff, 0.5, 15);
        this.playerLight.position.set(0, 5, 0);
        this.scene.add(this.playerLight);
    }

    // ── Network Events ──
    bindNetworkEvents() {
        this.network.on('state_update', (msg) => this.onStateUpdate(msg));
        // match_start is handled in main.js (which also starts the game loop)
        this.network.on('darkness', () => this.onDarkness());
        this.network.on('sonar_pulse', (msg) => this.onSonarPulse(msg));
        this.network.on('you_died', (msg) => this.onYouDied(msg));
        this.network.on('round_end', (msg) => this.onRoundEnd(msg));
        this.network.on('new_round', (msg) => this.onNewRound(msg));
        this.network.on('match_end', (msg) => this.onMatchEnd(msg));
        this.network.on('you_were_hit', (msg) => this.onYouWereHit(msg));
        this.network.on('hit_confirmed', () => this.onHitConfirmed());
        this.network.on('enemy_killed', () => this.onEnemyKilled());
        this.network.on('footstep', () => window.audio.footstep('stone'));
        this.network.on('zone_update', (msg) => this.onZoneUpdate(msg));
        this.network.on('rematch_available', () => this.onRematchAvailable());
        this.network.on('rematch_requested', () => this.onRematchRequested());
        this.network.on('rematch_declined', () => this.onRematchDeclined());
        this.network.on('opponent_disconnected', (msg) => this.onOpponentDisconnected(msg));
    }

    // ── Map Building ──
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
            color: 0x1a1a2e,
            roughness: 0.9,
            metalness: 0.1
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(0, -0.1, 0);
        floor.receiveShadow = true;
        this.scene.add(floor);
        this.floorMeshes.push(floor);

        // Grid lines (subtle)
        const gridHelper = new THREE.GridHelper(ms, gs, 0x222244, 0x1a1a3a);
        gridHelper.position.y = 0.01;
        this.scene.add(gridHelper);

        // Walls and pillars
        const wallMat = new THREE.MeshStandardMaterial({
            color: 0x2a2a4a,
            roughness: 0.7,
            metalness: 0.2
        });
        const pillarMat = new THREE.MeshStandardMaterial({
            color: 0x3a3a5a,
            roughness: 0.5,
            metalness: 0.3
        });

        for (let y = 0; y < gs; y++) {
            for (let x = 0; x < gs; x++) {
                const tile = grid[y][x];
                if (tile === 0) continue; // FLOOR

                const wx = x * ts + ts / 2 - ms / 2;
                const wz = y * ts + ts / 2 - ms / 2;

                if (tile === 1) { // WALL
                    const geo = new THREE.BoxGeometry(ts, 3, ts);
                    const mesh = new THREE.Mesh(geo, wallMat);
                    mesh.position.set(wx, 1.5, wz);
                    mesh.castShadow = true;
                    mesh.receiveShadow = true;
                    this.scene.add(mesh);
                    this.wallMeshes.push(mesh);
                } else if (tile === 2) { // PILLAR
                    const geo = new THREE.CylinderGeometry(0.3, 0.5, 3, 6);
                    const mesh = new THREE.Mesh(geo, pillarMat);
                    mesh.position.set(wx, 1.5, wz);
                    mesh.castShadow = true;
                    this.scene.add(mesh);
                    this.wallMeshes.push(mesh);
                }
            }
        }

        // Landmarks
        this.buildLandmarks(mapData.landmarks, ts, ms);

        // Player model (simple cylinder)
        const playerGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.5, 8);
        const playerMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x004466, emissiveIntensity: 0.3 });
        this.playerMesh = new THREE.Mesh(playerGeo, playerMat);
        this.playerMesh.position.set(0, 0.75, 0);
        this.playerMesh.castShadow = true;
        this.scene.add(this.playerMesh);

        // Enemy model (cylinder, red)
        const enemyMat = new THREE.MeshStandardMaterial({ color: 0xff4466, emissive: 0x662244, emissiveIntensity: 0.3 });
        this.enemyMesh = new THREE.Mesh(playerGeo.clone(), enemyMat);
        this.enemyMesh.position.set(0, 0.75, 0);
        this.enemyMesh.visible = false;
        this.scene.add(this.enemyMesh);

        // Zone ring indicator
        this.createZoneRing();
    }

    buildLandmarks(landmarks, ts, ms) {
        if (!landmarks) return;
        const colors = {
            tower: 0x44aaff,
            bridge: 0x88ccff,
            tunnel: 0x6644aa,
            arena: 0xffaa44,
            ruins: 0x886644
        };

        for (const lm of landmarks) {
            const wx = lm.gx * ts + ts / 2 - ms / 2;
            const wz = lm.gy * ts + ts / 2 - ms / 2;
            const color = colors[lm.type] || 0x666688;
            const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.1, roughness: 0.4, metalness: 0.3 });

            let mesh;
            switch (lm.type) {
                case 'tower':
                    mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1, 5, 6), mat);
                    mesh.position.set(wx, 2.5, wz);
                    break;
                case 'bridge':
                    mesh = new THREE.Mesh(new THREE.BoxGeometry(lm.size, 1, 0.5), mat);
                    mesh.position.set(wx, 0.5, wz);
                    break;
                case 'tunnel':
                    mesh = new THREE.Mesh(new THREE.BoxGeometry(lm.size, 1.5, 2.5), mat);
                    mesh.position.set(wx, 0.25, wz);
                    break;
                case 'arena':
                    mesh = new THREE.Mesh(new THREE.RingGeometry(1.5, 3, 12), mat.clone());
                    mesh.rotation.x = -Math.PI / 2;
                    mesh.position.set(wx, 0.05, wz);
                    break;
                case 'ruins':
                    mesh = new THREE.Mesh(new THREE.BoxGeometry(lm.size, 0.5 + Math.random(), lm.size), mat);
                    mesh.position.set(wx, 0.25, wz);
                    break;
                default:
                    mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
                    mesh.position.set(wx, 0.5, wz);
            }
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            this.landmarkMeshes.push(mesh);
        }
    }

    createZoneRing() {
        const geo = new THREE.RingGeometry(0, 1, 32);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xff4466,
            transparent: true,
            opacity: 0.2,
            side: THREE.DoubleSide
        });
        this.zoneRing = new THREE.Mesh(geo, mat);
        this.zoneRing.rotation.x = -Math.PI / 2;
        this.zoneRing.position.y = 0.1;
        this.scene.add(this.zoneRing);

        // Zone edge glow
        const edgeMat = new THREE.LineBasicMaterial({ color: 0xff4466, transparent: true, opacity: 0.3 });
        const points = [];
        for (let i = 0; i <= 32; i++) {
            const a = (i / 32) * Math.PI * 2;
            points.push(new THREE.Vector3(Math.cos(a), 0.15, Math.sin(a)));
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

        // Update ring geometry
        const geo = new THREE.RingGeometry(Math.max(0, r - 0.3), r, 32);
        this.zoneRing.geometry.dispose();
        this.zoneRing.geometry = geo;
        this.zoneRing.position.set(cx, 0.1, cz);

        // Update edge
        const points = [];
        for (let i = 0; i <= 32; i++) {
            const a = (i / 32) * Math.PI * 2;
            points.push(new THREE.Vector3(cx + Math.cos(a) * r, 0.15, cz + Math.sin(a) * r));
        }
        const edgeGeo = new THREE.BufferGeometry().setFromPoints(points);
        this.zoneEdge.geometry.dispose();
        this.zoneEdge.geometry = edgeGeo;
    }

    clearMap() {
        for (const m of [...this.wallMeshes, ...this.floorMeshes, ...this.landmarkMeshes]) {
            this.scene.remove(m);
            if (m.geometry) m.geometry.dispose();
            if (m.material) m.material.dispose();
        }
        this.wallMeshes = [];
        this.floorMeshes = [];
        this.landmarkMeshes = [];
    }

    // ── Game State Events ──
    onMatchStart(msg) {
        this.gameState = 'reveal';
        this.isDark = false;
        this.matchInfo.round = msg.round;
        this.localState.alive = true;
        this.localState.health = 100;
        this.enemyState.alive = true;
        this.enemyState.health = 100;

        // Build map
        this.buildMap(msg.map);

        // Set positions
        this.player.x = msg.yourSpawn.x;
        this.player.z = msg.yourSpawn.z;
        this.enemyState.x = msg.opponentSpawn.x;
        this.enemyState.z = msg.opponentSpawn.z;

        // Show game UI
        document.getElementById('lobby').classList.add('hidden');
        document.getElementById('game-ui').classList.remove('hidden');

        // Audio
        window.audio.roundStart();
        this.updateHUD();
    }

    onDarkness() {
        this.isDark = true;
        this.gameState = 'dark';
        // Increase fog
        if (this.scene) this.scene.fog = new THREE.Fog(0x0a0a1a, 10, 35);
        // Dim lights
        if (this.playerLight) this.playerLight.intensity = 0.2;
    }

    onStateUpdate(msg) {
        // Local player
        if (msg.you) {
            this.player.x = msg.you.x;
            this.player.z = msg.you.z;
            this.localState.health = msg.you.health;
            this.localState.abilityCooldown = msg.you.abilityCooldown;
            this.localState.abilityActive = msg.you.abilityActive;
            this.localState.isRevealing = msg.you.isRevealing;
            this.localState.alive = msg.you.alive;
        }

        // Enemy
        if (msg.enemy) {
            this.enemyState.x = msg.enemy.x;
            this.enemyState.z = msg.enemy.z;
            this.enemyState.visible = msg.enemy.visible;
            this.enemyState.alive = msg.enemy.alive;
            this.enemyState.health = msg.enemy.health;
        }

        // Game state
        if (msg.gameState) this.gameState = msg.gameState;
        if (msg.round) this.matchInfo.round = msg.round;
        if (msg.revealTimeLeft !== undefined) {
            document.getElementById('round-info').textContent = `Reveal: ${msg.revealTimeLeft}s`;
        }

        // Zone
        if (msg.zoneRadius !== undefined) {
            this.matchInfo.zoneRadius = msg.zoneRadius;
            this.matchInfo.zoneCenterX = msg.zoneCenterX || 0;
            this.matchInfo.zoneCenterZ = msg.zoneCenterZ || 0;
            this.updateZoneRing();
        }

        // Check zone warning
        const distFromCenter = Math.sqrt(this.player.x ** 2 + this.player.z ** 2);
        const zw = document.getElementById('zone-warning');
        if (distFromCenter > this.matchInfo.zoneRadius - 2) {
            zw.classList.remove('hidden');
            window.audio.zoneWarning();
        } else {
            zw.classList.add('hidden');
        }

        this.updateHUD();
        this.updateVisuals();
    }

    onSonarPulse(msg) {
        // Flash effect
        const flash = document.getElementById('sonar-flash');
        flash.classList.remove('hidden');
        setTimeout(() => flash.classList.add('hidden'), 500);

        // Audio
        if (msg.playerId === this.network.playerId) {
            window.audio.sonarPing();
        }
    }

    onYouDied(msg) {
        this.localState.alive = false;

        // Death screen
        const ds = document.getElementById('death-screen');
        ds.classList.remove('hidden');
        const detectionLabels = {
            'sonar_pulse': 'Enemy used Sonar Pulse to detect you',
            're_revealing': 'You were detected while re-revealing',
            'reveal_phase': 'Enemy saw you during reveal phase',
            'line_of_sight': 'Enemy had line of sight'
        };
        const detectionText = detectionLabels[msg.detectedBy] || 'Unknown';
        document.getElementById('death-info').innerHTML =
            `Killed by <strong>${msg.killerName}</strong><br>` +
            `Direction: ${msg.direction} | Distance: ~${msg.distance}m<br>` +
            `<span style="color:#ffaa00;font-size:0.85rem">${detectionText}</span>`;

        let timeLeft = 5;
        const timer = setInterval(() => {
            timeLeft--;
            document.getElementById('death-timer').textContent = `Respawning in ${timeLeft}...`;
            if (timeLeft <= 0) {
                clearInterval(timer);
                ds.classList.add('hidden');
            }
        }, 1000);

        window.audio.death();
    }

    onYouWereHit(msg) {
        window.audio.hit();
        // Flash damage direction
        const dir = msg.direction || '';
        document.getElementById('kill-feed').textContent = `Hit by ${msg.attackerName} (${dir})`;
        setTimeout(() => {
            if (document.getElementById('kill-feed').textContent.includes('Hit'))
                document.getElementById('kill-feed').textContent = '';
        }, 2000);
    }

    onHitConfirmed() {
        window.audio.hit();
    }

    onEnemyKilled() {
        this.matchInfo.scores.you++;
        document.getElementById('kill-feed').textContent = 'Enemy eliminated!';
        setTimeout(() => document.getElementById('kill-feed').textContent = '', 3000);
    }

    onRoundEnd(msg) {
        this.gameState = 'round_end';
        this.matchInfo.scores = msg.scores;
        const re = document.getElementById('round-end-screen');
        re.classList.remove('hidden');
        const isWinner = msg.winner === this.network.playerId;
        document.getElementById('round-end-text').textContent = isWinner ? 'ROUND WON' : 'ROUND LOST';
        document.getElementById('round-end-text').style.color = isWinner ? '#00e5ff' : '#ff4466';

        setTimeout(() => {
            re.classList.add('hidden');
        }, 4000);
    }

    onNewRound(msg) {
        this.gameState = 'reveal';
        this.isDark = false;
        this.matchInfo.round = msg.round;
        this.localState.alive = true;
        this.localState.health = 100;
        this.enemyState.alive = true;

        // Reset positions
        this.player.x = msg.spawn.x;
        this.player.z = msg.spawn.z;
        this.enemyState.x = msg.opponentSpawn.x;
        this.enemyState.z = msg.opponentSpawn.z;

        // Reset fog and lights
        if (this.scene) this.scene.fog = new THREE.Fog(0x0a0a1a, 20, 50);
        if (this.playerLight) this.playerLight.intensity = 0.5;

        window.audio.roundStart();
    }

    onMatchEnd(msg) {
        this.gameState = 'match_end';
        const me = document.getElementById('match-end-screen');
        me.classList.remove('hidden');
        const isWinner = msg.winner === this.network.playerId;
        document.getElementById('match-end-text').textContent = isWinner ? 'YOU WIN!' : 'YOU LOSE';
        document.getElementById('match-end-text').style.color = isWinner ? '#00e5ff' : '#ff4466';
        document.getElementById('match-scores').textContent =
            `You: ${msg.finalScores[this.network.playerId] || 0} — Enemy: ${msg.finalScores[Object.keys(msg.finalScores).find(k => k !== this.network.playerId)] || 0}`;
    }

    onRematchAvailable() {
        document.getElementById('rematch-section').classList.remove('hidden');
    }

    onRematchRequested() {
        // Auto-accept
        this.network.requestRematch();
    }

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

    // ── HUD Update ──
    updateHUD() {
        // Health
        const hp = this.localState.health;
        const maxHp = this.localState.maxHealth;
        const pct = Math.max(0, (hp / maxHp) * 100);
        document.getElementById('health-fill').style.width = pct + '%';
        document.getElementById('health-fill').style.background =
            hp > 50 ? `linear-gradient(90deg, #00e5ff, #00ff88)` :
            hp > 25 ? `linear-gradient(90deg, #ffaa00, #ff6600)` :
            `linear-gradient(90deg, #ff4400, #ff0000)`;
        document.getElementById('health-text').textContent = Math.max(0, Math.round(hp));

        // Ability
        const maxCd = 12000; // 12s
        const cdPct = this.localState.abilityActive ? 0 : Math.max(0, (this.localState.abilityCooldown / maxCd) * 100);
        document.getElementById('ability-fill').style.width = (100 - cdPct) + '%';
        document.getElementById('ability-icon').textContent = this.localState.abilityActive ? '🔊' : '';
        document.getElementById('ability-text').textContent = this.localState.abilityActive ? 'ACTIVE' : 'Sonar Pulse';

        // Round
        document.getElementById('round-info').textContent = `Round ${this.matchInfo.round}`;

        // Score
        document.getElementById('score-you').textContent = `You: ${this.matchInfo.scores.you || 0}`;
        document.getElementById('score-enemy').textContent = `Enemy: ${this.matchInfo.scores.enemy || 0}`;

        // Re-reveal indicator
        const ri = document.getElementById('reveal-indicator');
        if (this.localState.isRevealing && this.gameState === 'dark') {
            ri.classList.remove('hidden');
        } else {
            ri.classList.add('hidden');
        }
    }

    // ── Visual Update ──
    updateVisuals() {
        // Player mesh
        if (this.playerMesh) {
            this.playerMesh.position.set(this.player.x, 0.75, this.player.z);
        }

        // Camera
        this.camera.position.set(
            this.player.x,
            2.5 + (this.player.pitch > 0 ? this.player.pitch * 2 : 0),
            this.player.z
        );
        const lookX = this.player.x + Math.sin(this.player.rotY) * Math.cos(this.player.pitch);
        const lookY = 1.5 - Math.sin(this.player.pitch) * 2 + 2.5;
        const lookZ = this.player.z + Math.cos(this.player.rotY) * Math.cos(this.player.pitch);
        this.camera.lookAt(lookX, lookY, lookZ);

        // Player light follows
        if (this.playerLight) {
            this.playerLight.position.set(this.player.x, 5, this.player.z);
        }

        // Enemy
        if (this.enemyMesh) {
            const visible = this.enemyState.visible && this.enemyState.alive;
            this.enemyMesh.visible = visible || this.gameState === 'reveal';
            if (this.enemyMesh.visible && this.enemyState.alive) {
                this.enemyMesh.position.set(this.enemyState.x, 0.75, this.enemyState.z);
            }
        }

        // Fog control
        if (this.isDark) {
            if (this.scene.fog) {
                this.scene.fog.far = Math.max(8, 35 - this.fogDensity * 100);
            }
        } else {
            if (this.scene.fog) {
                this.scene.fog.far = 50;
            }
            this.fogDensity = 0.02;
        }
    }

    // ── Send Input ──
    sendInputs() {
        if (this.gameState !== 'reveal' && this.gameState !== 'dark') return;
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

        // Footstep sounds
        if (this.inputs.forward || this.inputs.backward || this.inputs.left || this.inputs.right) {
            this.footstepTimer += 16; // ~60fps
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
            this.renderer.render(this.scene, this.camera);
            this.animFrameId = requestAnimationFrame(loop);
        };
        loop();
    }

    stop() {
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    // ── Rematch Button Events (called from main.js) ──
    bindRematchButtons() {
        document.getElementById('rematch-btn').addEventListener('click', () => {
            this.network.requestRematch();
        });
        document.getElementById('leave-btn').addEventListener('click', () => {
            this.network.declineRematch();
        });
    }
}

// Global instance
window.game = new MemoryMinesGame();
