// server/classes.js — Class definitions for Memory Mines

const CLASSES = {
    SCOUT: 'scout'
};

const CLASS_DEFS = {
    [CLASSES.SCOUT]: {
        name: 'Scout',
        description: 'Mine specialist. Uses sonar to detect hidden mines and navigate the dark.',
        health: 100,
        moveSpeed: 6.5,
        abilityName: 'Sonar Scan',
        abilityDescription: 'Sends a pulse that reveals all mines within 15 units for 1.5 seconds.',
        abilityCooldown: 10000,     // 10 seconds
        abilityDuration: 1500,      // 1.5 seconds
        abilityRadius: 15,          // world units — reveals mines in this radius
        weaponDamage: 25,
        weaponRange: 50,
        weaponFireRate: 500,        // ms between shots (2 shots/second)
        muzzleFlashDuration: 400,   // ms your position is revealed after shooting
        mineTriggerDamage: 30,      // trigger mine damage
        mineProximityDamage: 50,    // proximity mine damage
        proximityBeepCount: 3,      // beeps before proximity mine explodes
        proximityBeepInterval: 350, // ms between beeps
        zoneDamage: 8               // dps outside zone
    }
};

function getClassDef(classType) {
    return CLASS_DEFS[classType] || CLASS_DEFS[CLASSES.SCOUT];
}

module.exports = { CLASSES, CLASS_DEFS, getClassDef };
