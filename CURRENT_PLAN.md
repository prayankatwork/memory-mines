# MEMORY MINES — CURRENT PLAN (MVP v1.1)

## Core Concept
A 1v1 competitive duel game where you see the map for 15 seconds, then navigate and fight in complete darkness using memory, audio, and a re-reveal mechanic.

**The one question this MVP answers:**
> "Is navigating, fighting, and outsmarting an opponent in darkness using memory actually fun?"

**Primary success metric:** Rematch rate
**Secondary metrics:** Average session length, matches per session, voluntary replay rate, player feedback

---

## Phase 1 — Build Scope

### Stack (100% Free)
| Layer | Technology |
|-------|-----------|
| 3D Engine | Three.js (CDN) |
| Backend | Node.js + ws (WebSocket) + Express (static files) |
| Audio | Web Audio API (procedural, no files needed) |
| No database | In-memory only for MVP |

### Match Structure
- **Format:** 1v1 competitive duel
- **Matchmaking:** Simple queue (first available)
- **Rounds:** Best-of-3 (first to 2 wins)
- **Rematch:** Offered after match ends

### Map
- **Size:** 64x64 world units (16x16 grid)
- **Landmarks:** Tower, Bridge, Tunnel, Center Arena, Ruins
- **Procedural:** Generated from seed, shared server ↔ client

### Gameplay Systems
| System | Description |
|--------|-------------|
| **15s reveal phase** | Full visibility at match start |
| **Darkness phase** | Complete fog of war |
| **Re-reveal mechanic** | Stand still 3s → reveal radius (moving breaks it) |
| **Basic shooting** | Click to fire, hitscan, 4 hits to kill |
| **Zone shrinking** | Playable area shrinks, outside = damage |
| **Audio system** | Procedural footsteps, gunshots, sonar, hits, zone warnings |
| **Death feedback** | "Killed by [Player] from [Direction]" overlay |

### Class
- **Scout only** — Sonar Pulse (reveal area for 2s), Keen Sense (larger re-reveal radius)
- Hunter and all other classes postponed (see FUTURE_ROADMAP.md)

### Success Check
Get 2 players into a match. Play 30 minutes.

**Ask:** "Do you want another match?"

- If yes repeatedly → ✅ Build more
- If "interesting but boring" → Fix core loop first

### Tracking During Testing
- Average match length
- Matches per session
- When people quit
- Why they died
- Whether deaths felt fair
