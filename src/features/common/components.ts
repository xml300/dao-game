// src/features/common/components.ts
import { defineComponent, Types } from 'bitecs';

// Max entities setting for bitECS - adjust based on expected scale
const MAX_ENTITIES = 1000;

// --- Core Components ---
export const Position = defineComponent({ x: Types.f32, y: Types.f32 }, MAX_ENTITIES);
export const Velocity = defineComponent({ vx: Types.f32, vy: Types.f32 }, MAX_ENTITIES);
export const Rotation = defineComponent({ angle: Types.f32 }, MAX_ENTITIES); // In degrees or radians? Phaser uses degrees usually.

// --- Player Specific ---
export const PlayerControlled = defineComponent({}, MAX_ENTITIES); // Tag component
export const InputState = defineComponent({
    moveX: Types.f32, // Use f32 for axes
    moveY: Types.f32,
    attackLight: Types.ui8, // Use ui8 for flags (0 or 1)
    attackHeavy: Types.ui8,
    dodge: Types.ui8,
    interact: Types.ui8,
    openMenu: Types.ui8,
    technique1: Types.ui8,
    technique2: Types.ui8,
    technique3: Types.ui8,
    technique4: Types.ui8,
    sprint: Types.ui8,
    toggleFlight: Types.ui8,
    blink: Types.ui8,
    // Add other techniques/actions
}, MAX_ENTITIES);

// --- Rendering & Physics ---
export const Renderable = defineComponent({
    spriteKey: Types.ui16, // Need a way to map u16 back to string key
    animationKey: Types.ui16, // Map back to string
    visible: Types.ui8, // 1 for true, 0 for false
    depth: Types.i16, // Depth sorting
    tint: Types.ui32, // 0xffffff for no tint
}, MAX_ENTITIES);

export const PhysicsBody = defineComponent({
    bodyId: Types.ui32, // Store an ID to map back to Phaser Arcade Body instance
    width: Types.f32,
    height: Types.f32,
    offsetX: Types.f32,
    offsetY: Types.f32,
    collides: Types.ui8, // Collision enabled flag
}, MAX_ENTITIES);

// --- Combat / Stats ---
export const Health = defineComponent({ current: Types.f32, max: Types.f32 }, MAX_ENTITIES);
export const QiPool = defineComponent({ current: Types.f32, max: Types.f32 }, MAX_ENTITIES);
export const StaminaPool = defineComponent({ current: Types.f32, max: Types.f32 }, MAX_ENTITIES);

// TDD 4.6 - Component to track logical state for animation/logic branching
export const MovementState = defineComponent({
    isIdle: Types.ui8,
    isRunning: Types.ui8,
    isJumping: Types.ui8,
    isFalling: Types.ui8,
    isFlying: Types.ui8,
    isHurt: Types.ui8, 
    isDead: Types.ui8
}, MAX_ENTITIES);


// State component to track combat actions (refining MovementState concept)
export const CombatState = defineComponent({
    isAttackingLight: Types.ui8,
    isAttackingHeavy: Types.ui8,
    attackSequence: Types.ui8, // For combo tracking (0 = none, 1 = first, etc.)
    attackWindowMs: Types.f32, // Timer for combo window
    isDodging: Types.ui8,
    dodgeDurationMs: Types.f32, // Timer for dodge duration/iframes
    isParrying: Types.ui8,
    parryWindowMs: Types.f32, // Timer for parry window
    isStaggered: Types.ui8, // Can't act
    staggerDurationMs: Types.f32,
    isInvulnerable: Types.ui8, // e.g., during dodge
    invulnerableDurationMs: Types.f32,
    canAttack: Types.ui8, // Flag to prevent spamming/allow recovery
    canMove: Types.ui8,   // Flag to restrict movement during certain actions
}, MAX_ENTITIES);

export const AIState = defineComponent({
    currentState: Types.ui8,
    stateDurationMs: Types.f32,
    targetEid: Types.eid,
    perceptionRadiusSq: Types.f32,
    attackRadiusSq: Types.f32,
    actionCooldownMs: Types.f32,
    isCalculatingPath: Types.ui8, // Flag: 1 if findPath called, 0 otherwise
    currentPathIndex: Types.i16, // Index in the current path (-1 if no path)
    lastTargetTileX: Types.i16,  // Store last known target tile to avoid recalc
    lastTargetTileY: Types.i16,
}, MAX_ENTITIES);

// Component for temporary hitboxes spawned during attacks
export const Hitbox = defineComponent({
    ownerEid: Types.eid, // Entity that owns/spawned this hitbox
    offsetX: Types.f32,
    offsetY: Types.f32,
    width: Types.f32,
    height: Types.f32,
    // damage: Types.f32, // Damage might be better calculated dynamically
    knockback: Types.f32, // Optional knockback strength
    durationMs: Types.f32, // How long the hitbox stays active
    startTimeMs: Types.f32, // World time when activated
    maxHits: Types.ui8, // Max entities this instance can hit (1 for single target)
    filter: Types.ui8, // E.g., 0=player, 1=enemy, determines what it *can* hit
}, MAX_ENTITIES); 

// Component added to entities that are hit by a Hitbox - signals damageSystem
export const TakeDamage = defineComponent({
    amount: Types.f32,
    sourceEid: Types.eid, // Entity that dealt the damage
}, MAX_ENTITIES);

// Component for tracking cooldowns (e.g., for attacks, abilities)
export const Cooldown = defineComponent({
    attackLightMs: Types.f32, // Remaining cooldown time
    attackHeavyMs: Types.f32,
    dodgeMs: Types.f32,
    blinkMs: Types.f32,
    // Add more cooldowns as needed
}, MAX_ENTITIES);

// Simple component to identify enemies
export const Enemy = defineComponent({
    archetypeId: Types.ui16, // Link back to config data
}, MAX_ENTITIES);

// --- ECS Components ---
// Add a component to manage technique cooldowns specifically
export const TechniqueCooldowns = defineComponent({
    // Store remaining cooldown time in milliseconds, keyed by TechniqueID (or slot index?)
    // Using a dynamic structure within ECS is harder. Let's track active slot cooldowns.
    slot0Ms: Types.f32,
    slot1Ms: Types.f32,
    slot2Ms: Types.f32,
    slot3Ms: Types.f32,
    // Add more slots if needed
}, MAX_ENTITIES);

// Component to indicate a technique is currently being cast (prevents other actions)
export const Casting = defineComponent({
    techniqueId: Types.ui16, // Map back to string TechniqueID
    castDurationMs: Types.f32, // How long the casting animation/lock takes
    effectTriggered: Types.ui8, // Flag: Has the effect logic run yet?
}, MAX_ENTITIES);



export enum EnemyAIState {
    Idle = 0,
    Patrolling = 1, // Add later
    Chasing = 2,
    Attacking = 3,
    Fleeing = 4, // Add later
    Staggered = 5 // Could reuse CombatState.isStaggered
}

 

// --- Utilities for Component Management ---

// Simple mapping for string keys to number IDs (improve later if needed)
const spriteKeyMap = new Map<string, number>();
const animationKeyMap = new Map<string, number>();
let nextSpriteKeyId = 0;
let nextAnimationKeyId = 0;
const physicsBodyMap = new Map<number, Phaser.Physics.Arcade.Body>();
let nextPhysicsBodyId = 1;
const techniqueKeyMap = new Map<string, number>();
let nextTechniqueKeyId = 0;




export function getSpriteKeyId(key: string): number {
    if (!spriteKeyMap.has(key)) {
        const id = nextSpriteKeyId++;
        spriteKeyMap.set(key, id);
        console.log(`Component Utils: Registered sprite key "${key}" as ID ${id}`);
    }
    return spriteKeyMap.get(key)!;
}

export function getAnimationKeyId(key: string): number {
     if (!animationKeyMap.has(key)) {
         animationKeyMap.set(key, nextAnimationKeyId++);
     }
     return animationKeyMap.get(key)!;
}

export function getSpriteKeyById(id: number): string | undefined {
    for (const [key, value] of spriteKeyMap.entries()) {
        if (value === id) return key;
    }
    return undefined;
}
export function getAnimationKeyById(id: number): string | undefined {
    for (const [key, value] of animationKeyMap.entries()) {
         if (value === id) return key;
     }
     return undefined;
}

export function registerPhysicsBody(body: Phaser.Physics.Arcade.Body): number {
    const id = nextPhysicsBodyId++;
    physicsBodyMap.set(id, body);
    return id;
}

export function getPhysicsBody(id: number): Phaser.Physics.Arcade.Body | undefined {
    return physicsBodyMap.get(id);
}

export function removePhysicsBody(id: number): void {
    physicsBodyMap.delete(id);
}


export function getTechniqueKeyId(key: string): number {
    if (!techniqueKeyMap.has(key)) {
        techniqueKeyMap.set(key, nextTechniqueKeyId++);
    }
    return techniqueKeyMap.get(key)!;
}

export function getTechniqueKeyById(id: number): string | undefined {
    for (const [key, value] of techniqueKeyMap.entries()) {
        if (value === id) return key;
    }
    return undefined;
}