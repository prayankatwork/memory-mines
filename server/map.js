// server/map.js — Procedural map generator with mines
// 64x64 world, 16x16 grid, 4 units per tile

const MAP_SIZE = 64;
const TILE_SIZE = 4;
const GRID_SIZE = MAP_SIZE / TILE_SIZE; // 16

const TILE = { FLOOR: 0, WALL: 1, PILLAR: 2, MINE: 3 };
const MINE_TYPE = { TRIGGER: 'trigger', PROXIMITY: 'proximity', DECOY: 'decoy' };
const LANDMARK = { TOWER: 'tower', BRIDGE: 'bridge', TUNNEL: 'tunnel', ARENA: 'arena', RUINS: 'ruins' };

// Seeded PRNG (mulberry32)
function seededRandom(seed) {
    return function() {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function generateMap(seed) {
    const rng = seededRandom(seed);
    const grid = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(TILE.FLOOR));
    const mineData = [];

    // Outer walls
    for (let x = 0; x < GRID_SIZE; x++) {
        grid[0][x] = TILE.WALL;
        grid[GRID_SIZE - 1][x] = TILE.WALL;
    }
    for (let y = 0; y < GRID_SIZE; y++) {
        grid[y][0] = TILE.WALL;
        grid[y][GRID_SIZE - 1] = TILE.WALL;
    }

    // Internal walls (10-14% density — sparser to leave room for mines)
    const density = 0.10 + rng() * 0.04;
    for (let y = 2; y < GRID_SIZE - 2; y++)
        for (let x = 2; x < GRID_SIZE - 2; x++)
            if (rng() < density) grid[y][x] = TILE.WALL;

    // Ensure connectivity
    floodFillConnect(grid, rng);

    // Scatter pillars (fewer now)
    for (let y = 2; y < GRID_SIZE - 2; y++)
        for (let x = 2; x < GRID_SIZE - 2; x++)
            if (grid[y][x] === TILE.FLOOR && rng() < 0.02) grid[y][x] = TILE.PILLAR;

    // Place landmarks
    const landmarks = placeLandmarks(grid, rng);

    // Place mines — 30 mines across walkable tiles
    const mines = placeMines(grid, rng, 30);

    // Spawns — opposite sides of map
    const spawns = findSpawns(grid, rng);

    return { seed, grid, landmarks, spawns, mines, mapSize: MAP_SIZE, tileSize: TILE_SIZE, gridSize: GRID_SIZE };
}

function floodFillConnect(grid, rng) {
    const visited = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(false));
    const cx = Math.floor(GRID_SIZE / 2), cy = Math.floor(GRID_SIZE / 2);
    const queue = [{ x: cx, y: cy }];
    visited[cy][cx] = true;
    const dx = [0, 1, 0, -1], dy = [-1, 0, 1, 0];

    while (queue.length) {
        const { x, y } = queue.shift();
        for (let d = 0; d < 4; d++) {
            const nx = x + dx[d], ny = y + dy[d];
            if (nx > 0 && nx < GRID_SIZE - 1 && ny > 0 && ny < GRID_SIZE - 1 && !visited[ny][nx]) {
                visited[ny][nx] = true;
                if (grid[ny][nx] !== TILE.WALL) queue.push({ x: nx, y: ny });
            }
        }
    }

    for (let y = 1; y < GRID_SIZE - 1; y++)
        for (let x = 1; x < GRID_SIZE - 1; x++)
            if (grid[y][x] === TILE.FLOOR && !visited[y][x])
                carveToCenter(grid, x, y);
}

function carveToCenter(grid, sx, sy) {
    const cx = Math.floor(GRID_SIZE / 2), cy = Math.floor(GRID_SIZE / 2);
    let x = sx, y = sy, steps = 0;
    while ((x !== cx || y !== cy) && steps++ < 40) {
        if (grid[y][x] === TILE.WALL) grid[y][x] = TILE.FLOOR;
        if (x < cx) x++; else if (x > cx) x--;
        if (y < cy) y++; else if (y > cy) y--;
    }
}

function clearCircle(grid, cx, cy, r) {
    for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
            if (dx * dx + dy * dy <= r * r) {
                const gx = cx + dx, gy = cy + dy;
                if (gx > 0 && gx < GRID_SIZE - 1 && gy > 0 && gy < GRID_SIZE - 1)
                    grid[gy][gx] = TILE.FLOOR;
            }
}

function placeLandmarks(grid, rng) {
    const landmarks = [];
    const cx = Math.floor(GRID_SIZE / 2), cy = Math.floor(GRID_SIZE / 2);

    // Arena (center) — open fighting pit
    clearCircle(grid, cx, cy, 2);
    for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 1.5 && dist < 3.5) {
                const gx = cx + dx, gy = cy + dy;
                if (gx > 0 && gx < GRID_SIZE - 1 && gy > 0 && gy < GRID_SIZE - 1)
                    if (rng() < 0.6) grid[gy][gx] = TILE.WALL;
            }
        }
    landmarks.push({ type: LANDMARK.ARENA, gx: cx, gy: cy, size: 7 });

    // Tower (north-east)
    const tx = Math.floor(GRID_SIZE * 0.75) + Math.floor(rng() * 2);
    const ty = Math.floor(GRID_SIZE * 0.25) + Math.floor(rng() * 2);
    clearCircle(grid, tx, ty, 2);
    for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
            if (Math.abs(dx) === 2 || Math.abs(dy) === 2) {
                const gx = tx + dx, gy = ty + dy;
                if (gx > 0 && gx < GRID_SIZE - 1 && gy > 0 && gy < GRID_SIZE - 1)
                    grid[gy][gx] = TILE.WALL;
            }
    landmarks.push({ type: LANDMARK.TOWER, gx: tx, gy: ty, size: 5 });

    // Bridge (horizontal corridor across middle)
    const by = Math.floor(GRID_SIZE * 0.5) + Math.floor(rng() * 3 - 1);
    for (let x = 3; x < GRID_SIZE - 3; x++) {
        if (grid[by][x] === TILE.WALL) grid[by][x] = TILE.FLOOR;
        if (by > 0) grid[by - 1][x] = TILE.WALL;
        if (by < GRID_SIZE - 1) grid[by + 1][x] = TILE.WALL;
    }
    if (by > 1) { grid[by - 1][3] = TILE.FLOOR; grid[by - 1][GRID_SIZE - 4] = TILE.FLOOR; }
    if (by < GRID_SIZE - 2) { grid[by + 1][3] = TILE.FLOOR; grid[by + 1][GRID_SIZE - 4] = TILE.FLOOR; }
    landmarks.push({ type: LANDMARK.BRIDGE, gx: Math.floor(GRID_SIZE / 2), gy: by, size: GRID_SIZE - 6 });

    // Tunnel (south-west, walled corridor)
    const tnx = Math.floor(GRID_SIZE * 0.25);
    const tny = Math.floor(GRID_SIZE * 0.75);
    for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
            const gx = tnx + dx, gy = tny + dy;
            if (gx > 0 && gx < GRID_SIZE - 1 && gy > 0 && gy < GRID_SIZE - 1) {
                if (Math.abs(dy) <= 1) grid[gy][gx] = TILE.FLOOR;
                else if (Math.abs(dx) <= 2) grid[gy][gx] = TILE.WALL;
            }
        }
    grid[tny][tnx - 3] = TILE.FLOOR; grid[tny][tnx + 3] = TILE.FLOOR;
    landmarks.push({ type: LANDMARK.TUNNEL, gx: tnx, gy: tny, size: 7 });

    // Ruins (scattered pillars, south-east)
    const rx = Math.floor(GRID_SIZE * 0.75), ry = Math.floor(GRID_SIZE * 0.75);
    clearCircle(grid, rx, ry, 2);
    for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++)
            if (Math.abs(dx) + Math.abs(dy) <= 4 && rng() < 0.3) {
                const gx = rx + dx, gy = ry + dy;
                if (gx > 0 && gx < GRID_SIZE - 1 && gy > 0 && gy < GRID_SIZE - 1 && grid[gy][gx] === TILE.FLOOR)
                    grid[gy][gx] = TILE.PILLAR;
            }
    landmarks.push({ type: LANDMARK.RUINS, gx: rx, gy: ry, size: 7 });

    return landmarks;
}

function placeMines(grid, rng, count) {
    const mines = [];
    const cx = Math.floor(GRID_SIZE / 2), cy = Math.floor(GRID_SIZE / 2);
    const candidates = [];

    // Collect walkable tiles, excluding center arena and spawn areas
    for (let y = 2; y < GRID_SIZE - 2; y++) {
        for (let x = 2; x < GRID_SIZE - 2; x++) {
            if (grid[y][x] !== TILE.FLOOR) continue;
            const distFromCenter = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
            if (distFromCenter < 3) continue; // Keep center arena clear
            candidates.push({ gx: x, gy: y });
        }
    }

    // Shuffle candidates
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    // Place mines
    const placed = Math.min(count, candidates.length);
    for (let i = 0; i < placed; i++) {
        const c = candidates[i];
        const typeRoll = rng();
        let type;
        if (typeRoll < 0.5) type = MINE_TYPE.TRIGGER;       // 50% trigger
        else if (typeRoll < 0.85) type = MINE_TYPE.PROXIMITY; // 35% proximity
        else type = MINE_TYPE.DECOY;                          // 15% decoy

        const worldPos = gridToWorld(c.gx, c.gy);
        mines.push({
            id: `m_${i}`,
            gx: c.gx,
            gy: c.gy,
            x: worldPos.x,
            z: worldPos.z,
            type: type,
            active: true,
            triggered: false
        });
    }

    return mines;
}

function findSpawns(grid, rng) {
    const cx = Math.floor(GRID_SIZE / 2), cy = Math.floor(GRID_SIZE / 2);
    const cells = [];
    for (let y = 2; y < GRID_SIZE - 2; y++)
        for (let x = 2; x < GRID_SIZE - 2; x++)
            if (grid[y][x] === TILE.FLOOR) {
                const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
                if (dist > 4) cells.push({ x, y, dist });
            }

    cells.sort((a, b) => b.dist - a.dist);

    const spawns = [];
    if (cells.length >= 2) {
        const first = cells[0];
        spawns.push(gridToWorld(first.x, first.y));
        let best = null, bestDist = -1;
        for (const c of cells) {
            const d = Math.abs(c.x - first.x) + Math.abs(c.y - first.y);
            if (d > bestDist) { bestDist = d; best = c; }
        }
        if (best) spawns.push(gridToWorld(best.x, best.y));
    }
    // Shuffle
    for (let i = spawns.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [spawns[i], spawns[j]] = [spawns[j], spawns[i]];
    }
    return spawns;
}

function gridToWorld(gx, gy) {
    return {
        x: gx * TILE_SIZE + TILE_SIZE / 2 - MAP_SIZE / 2,
        z: gy * TILE_SIZE + TILE_SIZE / 2 - MAP_SIZE / 2
    };
}

function worldToGrid(wx, wz) {
    return {
        x: Math.floor((wx + MAP_SIZE / 2) / TILE_SIZE),
        y: Math.floor((wz + MAP_SIZE / 2) / TILE_SIZE)
    };
}

function isWalkable(grid, wx, wz) {
    const g = worldToGrid(wx, wz);
    if (g.x < 0 || g.x >= GRID_SIZE || g.y < 0 || g.y >= GRID_SIZE) return false;
    return grid[g.y][g.x] === TILE.FLOOR || grid[g.y][g.x] === TILE.MINE;
}

module.exports = { generateMap, gridToWorld, worldToGrid, isWalkable, TILE, MINE_TYPE, LANDMARK, MAP_SIZE, TILE_SIZE, GRID_SIZE };
