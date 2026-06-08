// server/classes.js — Scout-only class definition for MVP
// Hunter and future classes are in FUTURE_ROADMAP.md

const CLASSES = {
    SCOUT: 'scout'
};

const CLASS_DEFS = {
    [CLASSES.SCOUT]: {
        name: 'Scout',
        description: 'Sonar specialist. Reveals areas and detects enemies.',
        health: 100,
        moveSpeed: 6.0,
        abilityName: 'Sonar Pulse',
        abilityDescription: 'Sends a pulse that reveals terrain and enemies in a large radius for 2 seconds.',
        abilityCooldown: 12000,    // 12 seconds
        abilityDuration: 2000,     // 2 seconds
        abilityRadius: 20,          // world units
        passiveName: 'Keen Sense',
        passiveDescription: 'Re-reveal radius when standing still is 50% larger.',
        revealRadiusMultiplier: 1.5,
        revealTime: 3000,           // 3 seconds to re-reveal
        revealRadius: 8,            // base radius of re-reveal
        weaponDamage: 25,
        weaponRange: 50,
        weaponFireRate: 500         // ms between shots (2 shots/second)
    }
};

function getClassDef(classType) {
    return CLASS_DEFS[classType] || CLASS_DEFS[CLASSES.SCOUT];
}

module.exports = { CLASSES, CLASS_DEFS, getClassDef };
