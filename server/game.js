// server/game.js — Match logic, queue management, authoritative game loop with mines

const { v4: uuidv4 } = require('uuid');
const { generateMap, isWalkable, MAP_SIZE, TILE_SIZE, GRID_SIZE, MINE_TYPE } = require('./map');
const { getClassDef, CLASSES } = require('./classes');

// ── State ──
const queue = [];
const players = new Map();
const matches = new Map();

const TICK_RATE = 20;
const TICK_INTERVAL = 1000 / TICK_RATE;

// ── Match Phase ──
const MATCH_PHASE = {
    WAITING: 'waiting',
    MEMORIZE: 'memorize',
    DARK: 'dark',
    ROUND_END: 'round_end',
    MATCH_END: 'match_end'
};

// ── Player Management ──
function registerPlayer(ws) {
    const id = uuidv4();
    const player = { id, ws, username: `Player${id.slice(0, 4)}`, inMatch: false, matchId: null };
    players.set(id, player);
    return player;
}

function removePlayer(id) {
    const p = players.get(id);
    if (!p) return;
    const qi = queue.indexOf(id);
    if (qi !== -1) queue.splice(qi, 1);
    if (p.matchId) endMatch(p.matchId, { type: 'disconnect', playerId: id });
    players.delete(id);
}

function setUsername(id, name) {
    const p = players.get(id);
    if (p) p.username = name.slice(0, 16);
}

// ── Queue ──
function joinQueue(playerId) {
    if (queue.includes(playerId)) return;
    const p = players.get(playerId);
    if (p && p.matchId) endMatch(p.matchId, { type: 'disconnect', playerId });
    queue.push(playerId);
    tryMatch();
}

function leaveQueue(playerId) {
    const i = queue.indexOf(playerId);
    if (i !== -1) queue.splice(i, 1);
}

function tryMatch() {
    if (queue.length < 2) return;
    const a = queue.shift();
    const b = queue.shift();
    const pa = players.get(a), pb = players.get(b);
    if (!pa || !pb) {
        if (pa) queue.unshift(a);
        if (pb) queue.unshift(b);
        return;
    }

    const matchId = uuidv4().slice(0, 8);
    const match = createMatch(matchId, pa, pb);
    matches.set(matchId, match);

    pa.matchId = matchId; pa.inMatch = true;
    pb.matchId = matchId; pb.inMatch = true;

    send(pa, { type: 'match_found', matchId, opponent: pb.username });
    send(pb, { type: 'match_found', matchId, opponent: pa.username });

    match.confirmTimer = setTimeout(() => {
        if (match.phase === MATCH_PHASE.WAITING) {
            const ca = match.confirmed.has(pa.id);
            const cb = match.confirmed.has(pb.id);
            cleanupMatch(matchId);
            if (ca) queue.unshift(a);
            if (cb) queue.unshift(b);
            tryMatch();
        }
    }, 10000);
}

function confirmMatch(playerId) {
    for (const [, match] of matches) {
        if ((match.p1.id === playerId || match.p2.id === playerId) && match.phase === MATCH_PHASE.WAITING) {
            match.confirmed.add(playerId);
            const player = players.get(playerId);
            if (player) send(player, { type: 'match_confirmed' });
            const other = match.p1.id === playerId ? match.p2 : match.p1;
            send(other, { type: 'opponent_confirmed' });
            if (match.confirmed.size >= 2) {
                clearTimeout(match.confirmTimer);
                startMatch(match);
            }
            return;
        }
    }
}

// ── Match Creation ──
function createMatch(id, p1, p2) {
    const seed = Math.floor(Math.random() * 2147483647);
    return {
        id,
        p1, p2,
        phase: MATCH_PHASE.WAITING,
        confirmed: new Set(),
        confirmTimer: null,
        mapSeed: seed,
        map: null,
        tickTimer: null,
        round: 1,
        scores: { [p1.id]: 0, [p2.id]: 0 },
        players: {
            [p1.id]: createPlayerState(p1.id),
            [p2.id]: createPlayerState(p2.id)
        },
        inputs: { [p1.id]: {}, [p2.id]: {} },
        memorizeTimer: 10000,       // 10s memorize phase
        zoneCenterX: 0, zoneCenterZ: 0,
        zoneRadius: MAP_SIZE / 2 - 2,
        zoneShrinkTimer: 0,
        roundEndTimer: 0,
        tickCount: 0,
        // Proximity mine tracking
        proximityBeeps: {},         // mineId -> { count, timer, targetId }
        // Muzzle flash tracking
        muzzleFlashes: {}           // playerId -> remaining ms
    };
}

function createPlayerState(id) {
    const def = getClassDef(CLASSES.SCOUT);
    return {
        id,
        x: 0, z: 0, rotY: 0,
        health: def.health,
        maxHealth: def.health,
        alive: true,
        abilityCooldown: 0,
        abilityActive: false,
        abilityTimer: 0,
        fireCooldown: 0,
        kills: 0,
        deaths: 0,
        lastFootstepX: 0,
        lastFootstepZ: 0,
        lastFootstepTick: 0,
        // Track which mines the player has already stepped on this round (to prevent double-trigger)
        triggeredMines: new Set()
    };
}

// ── Match Start ──
function startMatch(match) {
    match.map = generateMap(match.mapSeed);
    const map = match.map;
    const p1s = match.players[match.p1.id];
    const p2s = match.players[match.p2.id];

    // Assign spawns
    if (map.spawns.length >= 2) {
        p1s.x = map.spawns[0].x; p1s.z = map.spawns[0].z;
        p2s.x = map.spawns[1].x; p2s.z = map.spawns[1].z;
    } else {
        p1s.x = -10; p1s.z = -10;
        p2s.x = 10; p2s.z = 10;
    }
    p1s.rotY = Math.atan2(p2s.x - p1s.x, p2s.z - p1s.z);
    p2s.rotY = Math.atan2(p1s.x - p2s.x, p1s.z - p2s.z);

    resetPlayerState(p1s);
    resetPlayerState(p2s);

    match.phase = MATCH_PHASE.MEMORIZE;
    match.memorizeTimer = 10000;
    match.zoneRadius = MAP_SIZE / 2 - 2;
    match.zoneShrinkTimer = 0;
    match.zoneCenterX = 0;
    match.zoneCenterZ = 0;
    match.proximityBeeps = {};
    match.muzzleFlashes = {};
    match.tickCount = 0;

    // Clone mines for this match (so we can track triggered state)
    match.activeMines = map.mines.map(m => ({
        ...m,
        triggered: false,
        triggerTime: 0,
        beeping: false,
        beepCount: 0,
        lastBeepTime: 0
    }));

    // Send match start to both — include mine data (all visible during MEMORIZE)
    const mapData = {
        seed: match.mapSeed,
        grid: match.map.grid,
        landmarks: match.map.landmarks,
        mines: match.activeMines.map(m => ({
            id: m.id, x: m.x, z: m.z, type: m.type, active: true
        })),
        mapSize: MAP_SIZE,
        tileSize: TILE_SIZE,
        gridSize: GRID_SIZE,
        spawns: match.map.spawns.map(s => ({ x: s.x, z: s.z }))
    };

    send(match.p1, {
        type: 'match_start', matchId: match.id, round: match.round,
        classType: CLASSES.SCOUT, map: mapData,
        yourSpawn: { x: p1s.x, z: p1s.z },
        opponentSpawn: { x: p2s.x, z: p2s.z }
    });
    send(match.p2, {
        type: 'match_start', matchId: match.id, round: match.round,
        classType: CLASSES.SCOUT, map: mapData,
        yourSpawn: { x: p2s.x, z: p2s.z },
        opponentSpawn: { x: p1s.x, z: p1s.z }
    });

    // Start game tick
    match.tickTimer = setInterval(() => tick(match), TICK_INTERVAL);
}

function resetPlayerState(ps) {
    const def = getClassDef(CLASSES.SCOUT);
    ps.health = def.health;
    ps.alive = true;
    ps.abilityCooldown = 0;
    ps.abilityActive = false;
    ps.abilityTimer = 0;
    ps.fireCooldown = 0;
    ps.triggeredMines = new Set();
}

// ── Game Tick ──
function tick(match) {
    if (match.phase === MATCH_PHASE.MATCH_END || match.phase === MATCH_PHASE.ROUND_END) return;

    const def = getClassDef(CLASSES.SCOUT);
    const dt = TICK_INTERVAL / 1000;
    match.tickCount++;

    // ── Phase Timer ──
    if (match.phase === MATCH_PHASE.MEMORIZE) {
        match.memorizeTimer -= TICK_INTERVAL;
        if (match.memorizeTimer <= 0) {
            match.phase = MATCH_PHASE.DARK;
            send(match.p1, { type: 'darkness' });
            send(match.p2, { type: 'darkness' });
        }
    }

    // ── Process Each Player ──
    for (const p of [match.p1, match.p2]) {
        const ps = match.players[p.id];
        if (!ps.alive) continue;

        const input = match.inputs[p.id] || {};
        const moveSpeed = def.moveSpeed * dt;

        // Movement
        let dx = 0, dz = 0;
        if (input.forward) dz += moveSpeed;
        if (input.backward) dz -= moveSpeed;
        if (input.left) dx -= moveSpeed;
        if (input.right) dx += moveSpeed;

        const yaw = input.mouseX !== undefined ? input.mouseX : ps.rotY;
        ps.rotY = yaw;
        const cos = Math.cos(yaw), sin = Math.sin(yaw);
        const mdx = dx * cos + dz * sin;
        const mdz = -dx * sin + dz * cos;

        const newX = ps.x + mdx;
        const newZ = ps.z + mdz;

        // Collision
        if (isWalkable(match.map.grid, newX, newZ)) {
            ps.x = newX;
            ps.z = newZ;
        } else if (isWalkable(match.map.grid, newX, ps.z)) {
            ps.x = newX;
        } else if (isWalkable(match.map.grid, ps.x, newZ)) {
            ps.z = newZ;
        }

        // ── Mine Collision ──
        if (match.phase === MATCH_PHASE.DARK) {
            checkMineCollision(match, p, ps, def);
        }

        // ── Footstep Audio (send to opponent) ──
        const moved = Math.abs(ps.x - ps.lastFootstepX) + Math.abs(ps.z - ps.lastFootstepZ);
        if (moved > 1.0 && match.tickCount - ps.lastFootstepTick > 6) {
            ps.lastFootstepTick = match.tickCount;
            ps.lastFootstepX = ps.x;
            ps.lastFootstepZ = ps.z;
            const other = p.id === match.p1.id ? match.p2 : match.p1;
            send(other, { type: 'footstep', x: ps.x, z: ps.z });
        }

        // ── Ability Cooldown ──
        if (ps.abilityCooldown > 0) ps.abilityCooldown -= TICK_INTERVAL;
        if (ps.abilityActive) {
            ps.abilityTimer -= TICK_INTERVAL;
            if (ps.abilityTimer <= 0) ps.abilityActive = false;
        }

        // ── Use Ability (Sonar Scan — reveals mines nearby) ──
        if (input.ability && ps.abilityCooldown <= 0 && !ps.abilityActive && match.phase === MATCH_PHASE.DARK) {
            ps.abilityCooldown = def.abilityCooldown;
            ps.abilityActive = true;
            ps.abilityTimer = def.abilityDuration;
            // Send sonar_pulse to both players
            send(match.p1, { type: 'sonar_pulse', playerId: p.id, x: ps.x, z: ps.z, radius: def.abilityRadius });
            send(match.p2, { type: 'sonar_pulse', playerId: p.id, x: ps.x, z: ps.z, radius: def.abilityRadius });
        }

        // ── Shooting ──
        if (ps.fireCooldown > 0) ps.fireCooldown -= TICK_INTERVAL;
        if (input.shooting && ps.fireCooldown <= 0 && match.phase !== MATCH_PHASE.MEMORIZE) {
            ps.fireCooldown = def.weaponFireRate;
            handleShot(match, p, ps, def);
            // Muzzle flash — reveal shooter's position to enemy
            if (!match.muzzleFlashes) match.muzzleFlashes = {};
            match.muzzleFlashes[p.id] = def.muzzleFlashDuration;
            const other = p.id === match.p1.id ? match.p2 : match.p1;
            send(other, { type: 'muzzle_flash', x: ps.x, z: ps.z, duration: def.muzzleFlashDuration });
        }

        // ── Muzzle Flash Timer ──
        if (match.muzzleFlashes && match.muzzleFlashes[p.id] > 0) {
            match.muzzleFlashes[p.id] -= TICK_INTERVAL;
            if (match.muzzleFlashes[p.id] <= 0) delete match.muzzleFlashes[p.id];
        }

        // ── Zone Damage ──
        const distFromCenter = Math.sqrt(ps.x * ps.x + ps.z * ps.z);
        if (distFromCenter > match.zoneRadius) {
            ps.health -= def.zoneDamage * dt;
            if (ps.health <= 0) {
                ps.health = 0;
                killPlayer(match, p, null, 'zone');
            }
        }
    }

    // ── Zone Shrinking (starts after 20s in DARK) ──
    if (match.phase === MATCH_PHASE.DARK) {
        match.zoneShrinkTimer += TICK_INTERVAL;
        if (match.zoneShrinkTimer > 20000 && match.zoneRadius > 8) {
            match.zoneRadius = Math.max(8, match.zoneRadius - 0.3);
            send(match.p1, { type: 'zone_update', radius: match.zoneRadius, centerX: 0, centerZ: 0 });
            send(match.p2, { type: 'zone_update', radius: match.zoneRadius, centerX: 0, centerZ: 0 });
        }
        if (match.zoneShrinkTimer > 35000 && match.zoneRadius > 4) {
            match.zoneRadius = Math.max(4, match.zoneRadius - 0.5);
            send(match.p1, { type: 'zone_update', radius: match.zoneRadius, centerX: 0, centerZ: 0 });
            send(match.p2, { type: 'zone_update', radius: match.zoneRadius, centerX: 0, centerZ: 0 });
        }
    }

    // ── Process Proximity Mine Beeps ──
    processProximityBeeps(match);

    // ── Send State Update ──
    broadcastState(match);
}

// ── Mine Collision ──
function checkMineCollision(match, player, ps, def) {
    for (const mine of match.activeMines) {
        if (!mine.active || mine.triggered) continue;
        if (ps.triggeredMines.has(mine.id)) continue;

        const dx = ps.x - mine.x;
        const dz = ps.z - mine.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        switch (mine.type) {
            case MINE_TYPE.TRIGGER:
                if (dist < 1.5) {
                    // Trigger! Damage + position reveal
                    mine.triggered = true;
                    mine.active = false;
                    ps.triggeredMines.add(mine.id);
                    ps.health -= def.mineTriggerDamage;

                    // Send explosion event to both players
                    const triggerMsg = {
                        type: 'mine_explosion',
                        mineId: mine.id,
                        x: mine.x,
                        z: mine.z,
                        mineType: mine.type,
                        damage: def.mineTriggerDamage,
                        victimId: ps.id
                    };
                    send(match.p1, triggerMsg);
                    send(match.p2, triggerMsg);

                    // Victim position revealed to enemy
                    const enemy = ps.id === match.p1.id ? match.p2 : match.p1;
                    send(enemy, { type: 'player_detected', x: ps.x, z: ps.z, reason: 'mine_explosion' });

                    if (ps.health <= 0) {
                        ps.health = 0;
                        killPlayer(match, player, null, 'mine');
                    }
                }
                break;

            case MINE_TYPE.PROXIMITY:
                if (dist < 3.0) {
                    // Start or continue beeping sequence
                    if (!mine.beeping) {
                        mine.beeping = true;
                        mine.beepCount = 0;
                        mine.lastBeepTime = Date.now();
                        // Send initial beep
                        send(match.p1, { type: 'proximity_beep', mineId: mine.id, x: mine.x, z: mine.z, count: 1, total: 3, targetId: ps.id });
                        send(match.p2, { type: 'proximity_beep', mineId: mine.id, x: mine.x, z: mine.z, count: 1, total: 3, targetId: ps.id });
                    } else {
                        // Check if it's time for next beep
                        const elapsed = Date.now() - mine.lastBeepTime;
                        if (elapsed >= 350 && mine.beepCount < 3) {
                            mine.beepCount++;
                            mine.lastBeepTime = Date.now();
                            send(match.p1, { type: 'proximity_beep', mineId: mine.id, x: mine.x, z: mine.z, count: mine.beepCount, total: 3, targetId: ps.id });
                            send(match.p2, { type: 'proximity_beep', mineId: mine.id, x: mine.x, z: mine.z, count: mine.beepCount, total: 3, targetId: ps.id });

                            if (mine.beepCount >= 3) {
                                // Explode!
                                mine.triggered = true;
                                mine.active = false;
                                ps.triggeredMines.add(mine.id);
                                ps.health -= def.mineProximityDamage;

                                const boomMsg = {
                                    type: 'mine_explosion',
                                    mineId: mine.id,
                                    x: mine.x,
                                    z: mine.z,
                                    mineType: mine.type,
                                    damage: def.mineProximityDamage,
                                    victimId: ps.id
                                };
                                send(match.p1, boomMsg);
                                send(match.p2, boomMsg);

                                const enemy = ps.id === match.p1.id ? match.p2 : match.p1;
                                send(enemy, { type: 'player_detected', x: ps.x, z: ps.z, reason: 'mine_explosion' });

                                if (ps.health <= 0) {
                                    ps.health = 0;
                                    killPlayer(match, player, null, 'mine');
                                }
                            }
                        }
                    }
                } else {
                    // Player moved out of range — reset beeping
                    if (mine.beeping) {
                        mine.beeping = false;
                        mine.beepCount = 0;
                    }
                }
                break;

            case MINE_TYPE.DECOY:
                // Harmless — but visually looks like a real mine on sonar
                // No collision logic needed
                if (dist < 1.0) {
                    // Player steps on decoy — send a subtle visual cue
                    if (!mine.triggered) {
                        mine.triggered = true; // Mark as "found" so it disappears
                        send(match.p1, { type: 'decoy_found', mineId: mine.id, x: mine.x, z: mine.z, playerId: ps.id });
                        send(match.p2, { type: 'decoy_found', mineId: mine.id, x: mine.x, z: mine.z, playerId: ps.id });
                    }
                }
                break;
        }
    }
}

function processProximityBeeps(match) {
    // Clean up orphaned beeping state (player moved away)
    for (const mine of match.activeMines) {
        if (!mine.beeping) continue;

        // Check if either player is still nearby
        let nearby = false;
        for (const p of [match.p1, match.p2]) {
            const ps = match.players[p.id];
            if (!ps.alive) continue;
            const dx = ps.x - mine.x;
            const dz = ps.z - mine.z;
            if (Math.sqrt(dx * dx + dz * dz) < 3.0) {
                nearby = true;
                break;
            }
        }
        if (!nearby) {
            mine.beeping = false;
            mine.beepCount = 0;
        }
    }
}

// ── Shooting ──
function handleShot(match, shooter, shooterState, def) {
    const target = shooter.id === match.p1.id ? match.p2 : match.p1;
    const targetState = match.players[target.id];
    if (!targetState.alive) return;

    const dx = targetState.x - shooterState.x;
    const dz = targetState.z - shooterState.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist <= def.weaponRange) {
        const angle = Math.atan2(dx, dz);
        let angleDiff = shooterState.rotY - angle;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

        if (Math.abs(angleDiff) < Math.PI * 0.6) {
            targetState.health -= def.weaponDamage;
            send(shooter, { type: 'hit_confirmed', damage: def.weaponDamage });
            const dir = getDirectionLabel(angle);
            send(target, {
                type: 'you_were_hit',
                health: targetState.health,
                damage: def.weaponDamage,
                attackerName: shooter.username,
                direction: dir,
                distance: Math.round(dist)
            });

            if (targetState.health <= 0) {
                targetState.health = 0;
                killPlayer(match, target, shooter, 'shot');
            }
        }
    }
}

// ── Kill ──
function killPlayer(match, victim, killer, method) {
    const vs = match.players[victim.id];
    vs.alive = false;
    vs.deaths++;

    let killerName = 'Zone';
    let dir = 'Unknown';
    let dist = 0;

    if (killer) {
        killerName = killer.username;
        const dx = vs.x - match.players[killer.id].x;
        const dz = vs.z - match.players[killer.id].z;
        dist = Math.round(Math.sqrt(dx * dx + dz * dz));
        dir = getDirectionLabel(Math.atan2(dx, dz));
    }

    let detectedBy = method || 'line_of_sight';

    // Death feedback
    send(victim, {
        type: 'you_died',
        killerName,
        direction: dir,
        distance: dist,
        detectedBy,
        round: match.round
    });

    if (killer) {
        const ks = match.players[killer.id];
        ks.kills++;
        send(killer, { type: 'enemy_killed', round: match.round });
    }

    // End round
    const winner = killer ? killer.id : (victim.id === match.p1.id ? match.p2.id : match.p1.id);
    match.scores[winner]++;
    match.phase = MATCH_PHASE.ROUND_END;
    match.roundEndTimer = 5000;

    const winnerName = killer ? killer.username : (winner === match.p1.id ? match.p1.username : match.p2.username);
    send(match.p1, {
        type: 'round_end', winner, winnerName,
        scores: match.scores, round: match.round,
        cause: method
    });
    send(match.p2, {
        type: 'round_end', winner, winnerName,
        scores: match.scores, round: match.round,
        cause: method
    });

    // Check match win (first to 3)
    if (match.scores[winner] >= 3) {
        setTimeout(() => {
            if (matches.has(match.id)) {
                match.phase = MATCH_PHASE.MATCH_END;
                send(match.p1, {
                    type: 'match_end', winner, winnerName,
                    finalScores: match.scores
                });
                send(match.p2, {
                    type: 'match_end', winner, winnerName,
                    finalScores: match.scores
                });
                send(match.p1, { type: 'rematch_available', matchId: match.id });
                send(match.p2, { type: 'rematch_available', matchId: match.id });
            }
        }, 3000);
    } else {
        // Next round
        setTimeout(() => {
            if (matches.has(match.id)) {
                match.round++;
                match.phase = MATCH_PHASE.MEMORIZE;
                match.memorizeTimer = 10000;

                const p1s = match.players[match.p1.id];
                const p2s = match.players[match.p2.id];
                if (match.map.spawns.length >= 2) {
                    p1s.x = match.map.spawns[0].x; p1s.z = match.map.spawns[0].z;
                    p2s.x = match.map.spawns[1].x; p2s.z = match.map.spawns[1].z;
                }
                // Reset zone and mines for new round
                match.zoneShrinkTimer = 0;
                match.zoneRadius = MAP_SIZE / 2 - 2;
                match.activeMines = match.map.mines.map(m => ({
                    ...m,
                    triggered: false,
                    triggerTime: 0,
                    beeping: false,
                    beepCount: 0,
                    lastBeepTime: 0
                }));
                match.proximityBeeps = {};
                match.muzzleFlashes = {};

                resetPlayerState(p1s);
                resetPlayerState(p2s);

                // Send new round with fresh mine data
                const minesData = match.activeMines.map(m => ({
                    id: m.id, x: m.x, z: m.z, type: m.type, active: true
                }));

                send(match.p1, {
                    type: 'new_round', round: match.round,
                    spawn: { x: p1s.x, z: p1s.z },
                    opponentSpawn: { x: p2s.x, z: p2s.z },
                    mines: minesData
                });
                send(match.p2, {
                    type: 'new_round', round: match.round,
                    spawn: { x: p2s.x, z: p2s.z },
                    opponentSpawn: { x: p1s.x, z: p1s.z },
                    mines: minesData
                });
            }
        }, 5000);
    }
}

function getDirectionLabel(angle) {
    const deg = angle * 180 / Math.PI;
    if (deg > -22.5 && deg <= 22.5) return 'North';
    if (deg > 22.5 && deg <= 67.5) return 'Northeast';
    if (deg > 67.5 && deg <= 112.5) return 'East';
    if (deg > 112.5 && deg <= 157.5) return 'Southeast';
    if (deg > 157.5 || deg <= -157.5) return 'South';
    if (deg > -157.5 && deg <= -112.5) return 'Southwest';
    if (deg > -112.5 && deg <= -67.5) return 'West';
    return 'Northwest';
}

// ── State Broadcasting ──
function broadcastState(match) {
    const p1s = match.players[match.p1.id];
    const p2s = match.players[match.p2.id];

    // Which mines are visible?
    // - During MEMORIZE: all active mines visible
    // - During DARK: only mines within sonar range of ability-active player
    const getVisibleMines = (playerState, abilityActive) => {
        if (match.phase === MATCH_PHASE.MEMORIZE) {
            return match.activeMines.filter(m => m.active).map(m => ({
                id: m.id, x: m.x, z: m.z, type: m.type, active: m.active, triggered: m.triggered
            }));
        }
        if (!abilityActive) return [];
        return match.activeMines
            .filter(m => {
                if (!m.active) return false;
                const dx = playerState.x - m.x;
                const dz = playerState.z - m.z;
                return Math.sqrt(dx * dx + dz * dz) <= 15;
            })
            .map(m => ({
                id: m.id, x: m.x, z: m.z, type: m.type, active: m.active, triggered: m.triggered
            }));
    };

    // Can see enemy?
    const p1SeesEnemy = match.phase === MATCH_PHASE.MEMORIZE || p1s.abilityActive || p2s.isRevealing;
    const p2SeesEnemy = match.phase === MATCH_PHASE.MEMORIZE || p2s.abilityActive || p1s.isRevealing;

    // Muzzle flash detection
    const p1HasMuzzleFlash = match.muzzleFlashes && match.muzzleFlashes[p1.id] > 0;
    const p2HasMuzzleFlash = match.muzzleFlashes && match.muzzleFlashes[p2.id] > 0;

    const state = {
        type: 'state_update',
        gameState: match.phase,
        round: match.round,
        memorizeTimeLeft: match.phase === MATCH_PHASE.MEMORIZE ? Math.ceil(match.memorizeTimer / 1000) : 0,
        zoneRadius: match.zoneRadius,
        zoneCenterX: match.zoneCenterX,
        zoneCenterZ: match.zoneCenterZ,
        zoneShrinking: match.phase === MATCH_PHASE.DARK && match.zoneShrinkTimer > 15000
    };

    // Send to P1
    send(match.p1, {
        ...state,
        visibleMines: getVisibleMines(p1s, p1s.abilityActive),
        you: {
            x: p1s.x, z: p1s.z, rotY: p1s.rotY,
            health: p1s.health, maxHealth: p1s.maxHealth,
            abilityCooldown: p1s.abilityCooldown,
            abilityActive: p1s.abilityActive,
            alive: p1s.alive
        },
        enemy: {
            x: p2s.x, z: p2s.z, rotY: p2s.rotY,
            health: p2s.health,
            visible: p1SeesEnemy || p2HasMuzzleFlash,
            muzzleFlash: p2HasMuzzleFlash,
            reason: p2HasMuzzleFlash ? 'muzzle_flash' : '',
            alive: p2s.alive
        }
    });

    // Send to P2
    send(match.p2, {
        ...state,
        visibleMines: getVisibleMines(p2s, p2s.abilityActive),
        you: {
            x: p2s.x, z: p2s.z, rotY: p2s.rotY,
            health: p2s.health, maxHealth: p2s.maxHealth,
            abilityCooldown: p2s.abilityCooldown,
            abilityActive: p2s.abilityActive,
            alive: p2s.alive
        },
        enemy: {
            x: p1s.x, z: p1s.z, rotY: p1s.rotY,
            health: p1s.health,
            visible: p2SeesEnemy || p1HasMuzzleFlash,
            muzzleFlash: p1HasMuzzleFlash,
            reason: p1HasMuzzleFlash ? 'muzzle_flash' : '',
            alive: p1s.alive
        }
    });
}

// ── Input ──
function handleInput(playerId, input) {
    for (const [, match] of matches) {
        if (match.p1.id === playerId || match.p2.id === playerId) {
            match.inputs[playerId] = input;
            return;
        }
    }
}

// ── Rematch ──
function handleRematch(playerId, accept) {
    for (const [, match] of matches) {
        if (match.p1.id === playerId || match.p2.id === playerId) {
            if (match.phase !== MATCH_PHASE.MATCH_END) return;
            if (!match.rematch) match.rematch = new Set();
            if (accept) {
                match.rematch.add(playerId);
                const other = match.p1.id === playerId ? match.p2 : match.p1;
                send(other, { type: 'rematch_requested' });
                if (match.rematch.size >= 2) {
                    cleanupMatch(match.id, true);
                    const newId = uuidv4().slice(0, 8);
                    const newMatch = createMatch(newId, match.p1, match.p2);
                    matches.set(newId, newMatch);
                    match.p1.matchId = newId;
                    match.p2.matchId = newId;
                    startMatch(newMatch);
                }
            } else {
                const other = match.p1.id === playerId ? match.p2 : match.p1;
                send(other, { type: 'rematch_declined' });
                queue.push(match.p1.id);
                queue.push(match.p2.id);
                cleanupMatch(match.id);
                tryMatch();
            }
            return;
        }
    }
}

// ── Cleanup ──
function cleanupMatch(matchId, keepPlayers = false) {
    const match = matches.get(matchId);
    if (!match) return;
    clearInterval(match.tickTimer);
    clearTimeout(match.confirmTimer);
    if (!keepPlayers) {
        const p1 = players.get(match.p1.id);
        const p2 = players.get(match.p2.id);
        if (p1) { p1.inMatch = false; p1.matchId = null; }
        if (p2) { p2.inMatch = false; p2.matchId = null; }
    }
    matches.delete(matchId);
}

function endMatch(matchId, reason) {
    const match = matches.get(matchId);
    if (!match) return;
    if (reason.type === 'disconnect') {
        const other = match.p1.id === reason.playerId ? match.p2 : match.p1;
        const disconnected = reason.playerId === match.p1.id ? match.p1 : match.p2;
        send(other, { type: 'opponent_disconnected', message: `${disconnected.username} disconnected.` });
    }
    cleanupMatch(matchId);
}

// ── Send ──
function send(player, data) {
    try {
        if (player.ws.readyState === 1) player.ws.send(JSON.stringify(data));
    } catch (e) { /* ignore */ }
}

module.exports = { registerPlayer, removePlayer, setUsername, joinQueue, leaveQueue, confirmMatch, handleInput, handleRematch, tryMatch, queue, MATCH_PHASE };
