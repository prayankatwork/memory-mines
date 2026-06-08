# MEMORY MINES — FUTURE ROADMAP

Everything below is **postponed** from the MVP — not cancelled. Once the core loop is validated, resume from here.

---

## Matchmaking & Ranking

| Feature | Original Phase | Reason Postponed | Suggested Future Phase |
|---------|:--------------:|:----------------:|:---------------------:|
| Glicko-2 rating system | Phase 1 | MVP tests core fun, not ranking | Phase 2 |
| Ranked tiers (Bronze → Master) | Phase 1 | Needs rating system first | Phase 2 |
| Skill brackets | Phase 1 | Needs rating system first | Phase 2 |
| Rating deviation tracking | Phase 1 | Glicko-2 detail | Phase 2 |
| Volatility tracking | Phase 1 | Glicko-2 detail | Phase 2 |
| Leaderboard (global) | Phase 1 | Needs persistence + rating | Phase 2 |
| Skill-based matchmaking | Phase 1 | Needs rating system first | Phase 2 |

---

## Classes

| Feature | Original Phase | Reason Postponed | Suggested Future Phase |
|---------|:--------------:|:----------------:|:---------------------:|
| Hunter class | Phase 1 | Isolate memory mechanic in MVP | Phase 2 |
| Additional classes (future) | Phase 2+ | Not yet designed | Phase 3+ |

---

## Persistence & Accounts

| Feature | Original Phase | Reason Postponed | Suggested Future Phase |
|---------|:--------------:|:----------------:|:---------------------:|
| MongoDB database | Phase 1 | In-memory sufficient for MVP test | Phase 2 |
| Account system (username/password) | Phase 1 | No persistence needed yet | Phase 2 |
| Match history | Phase 1 | Needs database | Phase 2 |
| Permanent ratings | Phase 1 | Needs database + rating system | Phase 2 |

---

## Monetization

| Feature | Original Phase | Reason Postponed | Suggested Future Phase |
|---------|:--------------:|:----------------:|:---------------------:|
| Cosmetic shop | Phase 2 | Validate fun first | Phase 3 |
| Battle Pass | Phase 2 | Validate fun first | Phase 3 |
| Skins | Phase 2 | Validate fun first | Phase 3 |
| Emotes | Phase 2 | Validate fun first | Phase 3 |
| Death effects | Phase 2 | Validate fun first | Phase 3 |
| Victory animations | Phase 2 | Validate fun first | Phase 3 |

---

## Spectator & Replay

| Feature | Original Phase | Reason Postponed | Suggested Future Phase |
|---------|:--------------:|:----------------:|:---------------------:|
| Spectator mode | Phase 2 | Needed for growth, not core fun test | Phase 3 |
| Replay system | Phase 2 | Needed for growth, not core fun test | Phase 3 |
| Clip sharing | Phase 2 | Needed for growth, not core fun test | Phase 3 |
| Kill cams | Phase 2 | Nice-to-have for death fairness | Phase 2 |

---

## Social

| Feature | Original Phase | Reason Postponed | Suggested Future Phase |
|---------|:--------------:|:----------------:|:---------------------:|
| Friends list | Phase 2 | Not needed for 1v1 queue MVP | Phase 3 |
| Parties | Phase 2 | Not needed for 1v1 queue MVP | Phase 3 |
| Voice chat | Phase 2 | Not needed for 1v1 queue MVP | Phase 4 |
| Guilds/Clans | Phase 3 | Post-MVP retention feature | Phase 4 |
| Clan leaderboards | Phase 3 | Post-MVP retention feature | Phase 4 |

---

## Content

| Feature | Original Phase | Reason Postponed | Suggested Future Phase |
|---------|:--------------:|:----------------:|:---------------------:|
| Additional maps | Phase 2 | One map enough for MVP test | Phase 3 |
| Additional game modes | Phase 2 | One mode enough for MVP test | Phase 3 |
| Tournament mode | Phase 3 | Post-MVP growth feature | Phase 4 |

---

## Anti-Cheat

| Feature | Original Phase | Reason Postponed | Suggested Future Phase |
|---------|:--------------:|:----------------:|:---------------------:|
| Server-authoritative validation | Phase 1 | MVP can run trusted for now | Phase 2 |
| Input rate limiting | Phase 1 | MVP can run trusted for now | Phase 2 |
| Fog of war enforcement | Phase 1 | MVP can run trusted for now | Phase 2 |
| Screenshot cheat mitigation | Phase 2 | Hard problem, solve after MVP | Phase 3 |

---

## Progression

| Feature | Original Phase | Reason Postponed | Suggested Future Phase |
|---------|:--------------:|:----------------:|:---------------------:|
| XP system | Phase 2 | No persistence yet | Phase 3 |
| Leveling | Phase 2 | No persistence yet | Phase 3 |
| Achievement system | Phase 3 | Post-MVP engagement feature | Phase 4 |
| Mastery badges | Phase 3 | Post-MVP engagement feature | Phase 4 |
| Daily/weekly missions | Phase 3 | Post-MVP engagement feature | Phase 4 |

---

**Resume order after MVP validation:**
1. Phase 2: Database + Accounts + Basic persistence
2. Phase 2: Hunter class + second class
3. Phase 2: Glicko-2 rating + leaderboard + SBMM
4. Phase 2: Kill cams + death fairness
5. Phase 3: Cosmetics + Battle Pass
6. Phase 3: Spectator + Replay + Clip sharing
7. Phase 3: Additional maps + modes
8. Phase 4: Social systems + Tournaments + Anti-cheat
