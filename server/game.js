// server/game.js — Match logic, queue management, authoritative game loop

const { v4: uuidv4 } = require('uuid');
const { generateMap, isWalkable, MAP_SIZE, TILE_SIZE, GRID_SIZE } = require('./map');
const { getClassDef, CLASSES } = require('./classes');

// ── State ──
const queue = [];                    // playerId[]
const players = new Map();           // playerId -> { ws, username, inMatch, matchId }
const matches = new Map();           // matchId -> matchState

const TICK_RATE = 20;                // Hz
const TICK_INTERVAL = 1000 / TICK_RATE;

// ── Match State Machine ──
const MATCH_PHASE = {
    WAITING: 'waiting',
    REVEAL: 'reveal',
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
    // Leave queue
    const qi = queue.indexOf(id);
    if (qi !== -1) queue.splice(qi, 1);
    // Leave match
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
    // Leave current match if any
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
    if (!pa || !pb) { if (pa) queue.unshift(a); if (pb) queue.unshift(b); return; }

    // Send match found
    const matchId = uuidv4().slice(0, 8);
    const match = createMatch(matchId, pa, pb);
    matches.set(matchId, match);

    pa.matchId = matchId; pa.inMatch = true;
    pb.matchId = matchId; pb.inMatch = true;

    send(pa, { type: 'match_found', matchId, opponent: pb.username });
    send(pb, { type: 'match_found', matchId, opponent: pa.username });

    // Wait for confirmations (3s timeout)
    match.confirmTimer = setTimeout(() => {
        if (match.phase === MATCH_PHASE.WAITING) {
            // One or both didn't confirm — cancel
            const ca = match.confirmed.has(pa.id);
            const cb = match.confirmed.has(pb.id);
            cleanupMatch(matchId);
            if (ca) queue.unshift(a);
            if (cb) queue.unshift(b);
            tryMatch();
        }
    }, 10000); // 10s to confirm
}

function confirmMatch(playerId) {
    for (const [, match] of matches) {
        if ((match.p1.id === playerId || match.p2.id === playerId) && match.phase === MATCH_PHASE.WAITING) {
            match.confirmed.add(playerId);
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
        state: null,
        tickTimer: null,
        round: 1,
        scores: { [p1.id]: 0, [p2.id]: 0 },
        players: {
            [p1.id]: createPlayerState(p1.id, CLASSES.SCOUT),
            [p2.id]: createPlayerState(p2.id, CLASSES.SCOUT)
        },
        inputs: { [p1.id]: {}, [p2.id]: {} },
        revealTimer: 0,
        zoneCenterX: 0, zoneCenterZ: 0,
        zoneRadius: MAP_SIZE / 2 - 2,
        zoneShrinkTimer: 0,
        nextShrinkRadius: MAP_SIZE / 2 - 2,
        roundEndTimer: 0,
        tickCount: 0
    };
}

function createPlayerState(id, classType) {
    const def = getClassDef(classType);
    return {
        id, classType,
        x: 0, z: 0, rotY: 0,
        health: def.health,
        maxHealth: def.health,
        alive: true,
        abilityCooldown: 0,
        abilityActive: false,
        abilityTimer: 0,
        reRevealTimer: 0,
        isRevealing: false,
        fireCooldown: 0,
        kills: 0,
        deaths: 0,
        lastFootstepX: 0,
        lastFootstepZ: 0,
        lastFootstepTick: 0
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

    match.phase = MATCH_PHASE.REVEAL;
    match.revealTimer = 15000; // 15 seconds
    match.zoneRadius = MAP_SIZE / 2 - 2;
    match.zoneShrinkTimer = 0;
    match.zoneCenterX = 0;
    match.zoneCenterZ = 0;

    // Send match start to both
    const mapData = {
        seed: match.mapSeed,
        grid: match.map.grid,
        landmarks: match.map.landmarks,
        mapSize: MAP_SIZE,
        tileSize: TILE_SIZE,
        gridSize: GRID_SIZE,
        spawns: match.map.spawns.map(s => ({ x: s.x, z: s.z }))
    };

    send(match.p1, { type: 'match_start', matchId: match.id, round: match.round, classType: CLASSES.SCOUT, map: mapData, yourSpawn: { x: p1s.x, z: p1s.z }, opponentSpawn: { x: p2s.x, z: p2s.z } });
    send(match.p2, { type: 'match_start', matchId: match.id, round: match.round, classType: CLASSES.SCOUT, map: mapData, yourSpawn: { x: p2s.x, z: p2s.z }, opponentSpawn: { x: p1s.x, z: p1s.z } });

    // Start game tick
    match.tickTimer = setInterval(() => tick(match), TICK_INTERVAL);
}

function resetPlayerState(ps) {
    const def = getClassDef(ps.classType);
    ps.health = def.health;
    ps.alive = true;
    ps.abilityCooldown = 0;
    ps.abilityActive = false;
    ps.abilityTimer = 0;
    ps.reRevealTimer = 0;
    ps.isRevealing = false;
    ps.fireCooldown = 0;
}

// ── Game Tick ──
function tick(match) {
    if (match.phase === MATCH_PHASE.MATCH_END || match.phase === MATCH_PHASE.ROUND_END) {
        return; // Wait for timer or next phase
    }

    const def = getClassDef(CLASSES.SCOUT);
    const dt = TICK_INTERVAL / 1000;

    // Update reveal timer
    if (match.phase === MATCH_PHASE.REVEAL) {
        match.revealTimer -= TICK_INTERVAL;
        if (match.revealTimer <= 0) {
            match.phase = MATCH_PHASE.DARK;
            send(match.p1, { type: 'darkness' });
            send(match.p2, { type: 'darkness' });
        }
    }

    // Process inputs and update players
    for (const p of [match.p1, match.p2]) {
        const ps = match.players[p.id];
        if (!ps.alive) continue;

        const input = match.inputs[p.id] || {};
        const moveSpeed = def.moveSpeed * dt;

        // Movement
        let dx = 0, dz = 0;
        if (input.forward) dz -= moveSpeed;
        if (input.backward) dz += moveSpeed;
        if (input.left) dx -= moveSpeed;
        if (input.right) dx += moveSpeed;

        // Rotate movement by camera yaw
        const yaw = input.mouseX !== undefined ? input.mouseX : ps.rotY;
        ps.rotY = yaw;
        const cos = Math.cos(yaw), sin = Math.sin(yaw);
        const mdx = dx * cos - dz * sin;
        const mdz = dx * sin + dz * cos;

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

        // Re-reveal mechanic (standing still)
        const isMoving = input.forward || input.backward || input.left || input.right;
        if (isMoving) {
            ps.reRevealTimer = 0;
            ps.isRevealing = false;
        } else if (match.phase === MATCH_PHASE.DARK) {
            ps.reRevealTimer += TICK_INTERVAL;
            ps.isRevealing = ps.reRevealTimer >= def.revealTime;
        }

        // Enemy footstep audio — send to opponent when player moves significantly
        const movedDist = Math.abs(ps.x - ps.lastFootstepX) + Math.abs(ps.z - ps.lastFootstepZ);
        if (movedDist > 1.0 && match.tickCount - ps.lastFootstepTick > 6) { // ~300ms at 20Hz
            ps.lastFootstepTick = match.tickCount;
            ps.lastFootstepX = ps.x;
            ps.lastFootstepZ = ps.z;
            const other = p.id === match.p1.id ? match.p2 : match.p1;
            send(other, { type: 'footstep', x: ps.x, z: ps.z });
        }

        // Ability cooldown
        if (ps.abilityCooldown > 0) ps.abilityCooldown -= TICK_INTERVAL;
        if (ps.abilityActive) {
            ps.abilityTimer -= TICK_INTERVAL;
            if (ps.abilityTimer <= 0) ps.abilityActive = false;
        }

        // Use ability
        if (input.ability && ps.abilityCooldown <= 0 && !ps.abilityActive) {
            ps.abilityCooldown = def.abilityCooldown;
            ps.abilityActive = true;
            ps.abilityTimer = def.abilityDuration;
            // Notify both players
            send(match.p1, { type: 'sonar_pulse', playerId: p.id, x: ps.x, z: ps.z, radius: def.abilityRadius });
            send(match.p2, { type: 'sonar_pulse', playerId: p.id, x: ps.x, z: ps.z, radius: def.abilityRadius });
        }

        // Shooting
        if (ps.fireCooldown > 0) ps.fireCooldown -= TICK_INTERVAL;
        if (input.shooting && ps.fireCooldown <= 0) {
            ps.fireCooldown = def.weaponFireRate;
            handleShot(match, p, ps);
        }

        // Zone damage
        const distFromCenter = Math.sqrt(ps.x * ps.x + ps.z * ps.z);
        if (distFromCenter > match.zoneRadius) {
            ps.health -= 5 * dt; // 5 dps outside zone
            if (ps.health <= 0) {
                ps.health = 0;
                killPlayer(match, p, null); // Killed by zone
            }
        }
    }

    // Increment tick counter
    match.tickCount++;

    // Zone shrinking
    match.zoneShrinkTimer += TICK_INTERVAL;
    if (match.phase === MATCH_PHASE.DARK) {
        if (match.zoneShrinkTimer > 30000 && match.zoneRadius > 10) {
            match.zoneRadius = Math.max(10, match.zoneRadius - 0.5);
            send(match.p1, { type: 'zone_update', radius: match.zoneRadius, centerX: 0, centerZ: 0 });
            send(match.p2, { type: 'zone_update', radius: match.zoneRadius, centerX: 0, centerZ: 0 });
        }
        if (match.zoneShrinkTimer > 45000 && match.zoneRadius > 5) {
            match.zoneRadius = Math.max(5, match.zoneRadius - 0.8);
            send(match.p1, { type: 'zone_update', radius: match.zoneRadius, centerX: 0, centerZ: 0 });
            send(match.p2, { type: 'zone_update', radius: match.zoneRadius, centerX: 0, centerZ: 0 });
        }
    }

    // Send state update
    broadcastState(match);
}

function handleShot(match, shooter, shooterState) {
    const def = getClassDef(CLASSES.SCOUT);
    const target = shooter.id === match.p1.id ? match.p2 : match.p1;
    const targetState = match.players[target.id];
    if (!targetState.alive) return;

    // Simple hit detection: check distance and direction
    const dx = targetState.x - shooterState.x;
    const dz = targetState.z - shooterState.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist <= def.weaponRange) {
        // Check if roughly facing the target
        const angle = Math.atan2(dx, dz);
        let angleDiff = shooterState.rotY - angle;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

        if (Math.abs(angleDiff) < Math.PI * 0.6) { // ~108 degree FOV
            targetState.health -= def.weaponDamage;
            send(shooter, { type: 'hit_confirmed', damage: def.weaponDamage });

            // Direction from shooter to target for death feedback
            const dir = getDirectionLabel(angle);
            send(target, { type: 'you_were_hit', health: targetState.health, damage: def.weaponDamage, attackerName: shooter.username, direction: dir, distance: Math.round(dist) });

            if (targetState.health <= 0) {
                targetState.health = 0;
                killPlayer(match, target, shooter);
            }
        }
    }
}

function killPlayer(match, victim, killer) {
    const vs = match.players[victim.id];
    vs.alive = false;
    vs.kills = 0;
    vs.deaths++;

    const killerName = killer ? killer.username : 'Zone';
    let dir = 'Unknown';
    let dist = 0;

    if (killer) {
        const dx = vs.x - match.players[killer.id].x;
        const dz = vs.z - match.players[killer.id].z;
        dist = Math.round(Math.sqrt(dx * dx + dz * dz));
        dir = getDirectionLabel(Math.atan2(dx, dz));
    }

    // Determine detection method
    let detectedBy = 'line_of_sight';
    if (match.phase === MATCH_PHASE.REVEAL) {
        detectedBy = 'reveal_phase';
    } else if (killer) {
        const ks = match.players[killer.id];
        if (ks.abilityActive) {
            detectedBy = 'sonar_pulse';
        } else if (vs.isRevealing) {
            detectedBy = 're_revealing';
        }
    }

    // Death feedback with context
    send(victim, {
        type: 'you_died',
        killerName,
        direction: dir,
        distance: dist,
        detectedBy,
        round: match.round
    });

    // Notify killer
    if (killer) {
        const ks = match.players[killer.id];
        ks.kills++;
        send(killer, { type: 'enemy_killed', round: match.round });
    }

    // End round
    const winner = killer ? killer.id : (victim.id === match.p1.id ? match.p2.id : match.p1.id);
    match.scores[winner]++;
    match.phase = MATCH_PHASE.ROUND_END;
    match.roundEndTimer = 5000; // 5s pause

    const winnerName = killer ? killer.username : (winner === match.p1.id ? match.p1.username : match.p2.username);
    send(match.p1, { type: 'round_end', winner: winner, winnerName, scores: match.scores, round: match.round });
    send(match.p2, { type: 'round_end', winner: winner, winnerName, scores: match.scores, round: match.round });

    // Check match win (first to 2)
    if (match.scores[winner] >= 2) {
        setTimeout(() => {
            if (matches.has(match.id)) {
                match.phase = MATCH_PHASE.MATCH_END;
                send(match.p1, { type: 'match_end', winner: winner, winnerName, finalScores: match.scores });
                send(match.p2, { type: 'match_end', winner: winner, winnerName, finalScores: match.scores });
                send(match.p1, { type: 'rematch_available', matchId: match.id });
                send(match.p2, { type: 'rematch_available', matchId: match.id });
            }
        }, 3000);
    } else {
        // Next round
        setTimeout(() => {
            if (matches.has(match.id)) {
                match.round++;
                match.phase = MATCH_PHASE.REVEAL;
                match.revealTimer = 15000;

                // Reset player positions and health
                const p1s = match.players[match.p1.id];
                const p2s = match.players[match.p2.id];
                if (match.map.spawns.length >= 2) {
                    p1s.x = match.map.spawns[0].x; p1s.z = match.map.spawns[0].z;
                    p2s.x = match.map.spawns[1].x; p2s.z = match.map.spawns[1].z;
                }
                // Reset zone for new round
                match.zoneShrinkTimer = 0;
                match.zoneRadius = MAP_SIZE / 2 - 2;
                resetPlayerState(p1s);
                resetPlayerState(p2s);

                send(match.p1, { type: 'new_round', round: match.round, spawn: { x: p1s.x, z: p1s.z }, opponentSpawn: { x: p2s.x, z: p2s.z } });
                send(match.p2, { type: 'new_round', round: match.round, spawn: { x: p2s.x, z: p2s.z }, opponentSpawn: { x: p1s.x, z: p1s.z } });
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

function broadcastState(match) {
    const p1s = match.players[match.p1.id];
    const p2s = match.players[match.p2.id];

    // Reveal in sonar pulse: tell the enemy's position if ability is active
    const p1SeesEnemy = p1s.abilityActive;
    const p2SeesEnemy = p2s.abilityActive;

    const state = {
        type: 'state_update',
        gameState: match.phase,
        round: match.round,
        revealTimeLeft: match.phase === MATCH_PHASE.REVEAL ? Math.ceil(match.revealTimer / 1000) : 0,
        zoneRadius: match.zoneRadius,
        zoneCenterX: match.zoneCenterX,
        zoneCenterZ: match.zoneCenterZ
    };

    // Send to P1
    send(match.p1, {
        ...state,
        you: {
            x: p1s.x, z: p1s.z, rotY: p1s.rotY,
            health: p1s.health, maxHealth: p1s.maxHealth,
            abilityCooldown: p1s.abilityCooldown,
            abilityActive: p1s.abilityActive,
            isRevealing: p1s.isRevealing,
            alive: p1s.alive
        },
        enemy: {
            x: p2s.x, z: p2s.z, rotY: p2s.rotY,
            health: p2s.health,
            visible: match.phase === MATCH_PHASE.REVEAL || p1s.abilityActive || p2s.isRevealing,
            alive: p2s.alive
        }
    });

    // Send to P2
    send(match.p2, {
        ...state,
        you: {
            x: p2s.x, z: p2s.z, rotY: p2s.rotY,
            health: p2s.health, maxHealth: p2s.maxHealth,
            abilityCooldown: p2s.abilityCooldown,
            abilityActive: p2s.abilityActive,
            isRevealing: p2s.isRevealing,
            alive: p2s.alive
        },
        enemy: {
            x: p1s.x, z: p1s.z, rotY: p1s.rotY,
            health: p1s.health,
            visible: match.phase === MATCH_PHASE.REVEAL || p2s.abilityActive || p1s.isRevealing,
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
                    // Start new match with same players
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
                // Put both back in queue
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
