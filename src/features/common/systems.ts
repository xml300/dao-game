// src/features/common/systems.ts
import {
  addComponent,
  addEntity,
  defineQuery,
  enterQuery,
  exitQuery,
  hasComponent,
  removeComponent,
} from "bitecs";
import Phaser from "phaser";
import {
  Position,
  Velocity,
  Rotation,
  PlayerControlled,
  InputState,
  Renderable,
  PhysicsBody,
  MovementState,
  getPhysicsBody,
  removePhysicsBody,
  registerPhysicsBody,
  getSpriteKeyById,
  getAnimationKeyById,
  getAnimationKeyId,
  CombatState,
  Cooldown,
  Enemy,
  Hitbox,
  TakeDamage,
  Health,
  QiPool,
  StaminaPool,
  AIState,
  EnemyAIState,
  Casting,
  TechniqueCooldowns,
} from "./components";
import { usePlayerStore } from "@/state/player.store";
import { InWorld } from "@/types";
import * as AssetKeys from "@/constants/assets"; // Import constants
import GameScene from "@/scenes/GameScene";
import { TechniqueRegistry } from "@/config/technique";

// --- System Inputs/Resources ---
// Define interfaces for resources systems need, like Phaser scene or input manager
export interface SystemResources {
  time: number;
  delta: number;
  scene: Phaser.Scene; // For accessing input, physics, rendering
  playerGroup: Phaser.Physics.Arcade.Group;
  enemyGroup: Phaser.Physics.Arcade.Group;
  playerHitboxGroup: Phaser.Physics.Arcade.Group;
}

// --- Queries ---
const velocityMovementQuery = defineQuery([
  Position,
  Velocity,
  PhysicsBody,
  CombatState,
]);
const castingQuery = defineQuery([Casting]);
const aiQuery = defineQuery([
  Enemy,
  AIState,
  Position,
  Velocity,
  Rotation,
  PhysicsBody,
  CombatState,
  Health,
]);
const playerQuery = defineQuery([PlayerControlled, Position]);
const playerInputQuery = defineQuery([
  PlayerControlled,
  InputState,
  Velocity,
  PhysicsBody,
  MovementState,
  CombatState,
  Cooldown,
  StaminaPool,
]); // Added Combat/Cooldown/Stamina
const movementQuery = defineQuery([
  Position,
  Velocity,
  PhysicsBody,
  MovementState,
]);
const physicsQuery = defineQuery([PhysicsBody]); // Query entities needing physics handling
const combatStateQuery = defineQuery([CombatState]);
const renderableQuery = defineQuery([Position, Rotation, Renderable]);
const newRenderableQuery = enterQuery(renderableQuery);
const exitedRenderableQuery = exitQuery(renderableQuery);
const playerCombatQuery = defineQuery([
  PlayerControlled,
  InputState,
  CombatState,
  Cooldown,
  Velocity,
  PhysicsBody,
  Health,
]);
const hitboxQuery = defineQuery([Hitbox, Position, PhysicsBody]);
const enemyQuery = defineQuery([
  Enemy,
  Health,
  Position,
  PhysicsBody,
  CombatState,
]);
const damageQuery = defineQuery([TakeDamage, Health]);
const spriteMap = new Map<number, Phaser.GameObjects.Sprite>();
const hitboxHitRegistry = new Map<number, Set<number>>();

export function syncPositionSystem(world: InWorld) {
  const entities = physicsQuery(world);
  for (const eid of entities) {
    const bodyId = PhysicsBody.bodyId[eid];
    const body = getPhysicsBody(bodyId);
    // Use the GameObject's position as it's the source of truth after physics simulation
    const gameObject = body?.gameObject;
    if (gameObject) {
      Position.x[eid] = gameObject?.body?.position.x || Position.x[eid];
      Position.y[eid] = gameObject.body?.position.y || Position.y[eid];
      // Sync rotation if necessary (though we set angle in renderSystem)
      // Rotation.angle[eid] = gameObject.angle;
    }
  }
}

// --- AI System (FSM - TDD 4.3.1) ---
export function aiSystem(world: InWorld) {
  const { scene, time, delta } = world.resources;
  const deltaMs = delta * 1000;

  const aiEntities = aiQuery(world);
  const players = playerQuery(world);

  // Simple check: Assume single player for targeting
  if (players.length === 0) return; // No player to react to
  const playerEid = players[0];
  const playerX = Position.x[playerEid];
  const playerY = Position.y[playerEid];

  for (const eid of aiEntities) {
    const aiPosX = Position.x[eid];
    const aiPosY = Position.y[eid];

    // Decrement timers
    AIState.stateDurationMs[eid] = Math.max(
      0,
      AIState.stateDurationMs[eid] - deltaMs
    );
    AIState.actionCooldownMs[eid] = Math.max(
      0,
      AIState.actionCooldownMs[eid] - deltaMs
    );

    // --- FSM Logic ---
    const currentState = AIState.currentState[eid];
    const perceptionRadiusSq = AIState.perceptionRadiusSq[eid];
    const attackRadiusSq = AIState.attackRadiusSq[eid];
    const distSq = Phaser.Math.Distance.Squared(
      aiPosX,
      aiPosY,
      playerX,
      playerY
    );
    const canAct =
      AIState.actionCooldownMs[eid] === 0 && !CombatState.isStaggered[eid];

    let nextState = currentState; // Assume state doesn't change unless condition met

    switch (currentState) {
      case EnemyAIState.Idle:
        // Transition conditions from Idle
        if (distSq < perceptionRadiusSq) {
          console.log(`AI[${eid}]: Player detected. Switching to Chase.`);
          nextState = EnemyAIState.Chasing;
          AIState.targetEid[eid] = playerEid; // Set target
        } else {
          // Stay Idle or switch to Patrolling (later)
          // Stop movement if any remained from previous state
          const bodyId = PhysicsBody.bodyId[eid];
          const body = getPhysicsBody(bodyId) as Phaser.Physics.Arcade.Body;
          if (body) body.setVelocity(0, 0);
        }
        break;

      case EnemyAIState.Chasing:
        // Transition conditions from Chasing
        if (distSq < attackRadiusSq) {
          console.log(`AI[${eid}]: Reached attack range. Switching to Attack.`);
          nextState = EnemyAIState.Attacking;
          AIState.actionCooldownMs[eid] = 1500; // Cooldown before first attack
        } else if (distSq > perceptionRadiusSq * 1.5) {
          // Lose sight if player gets too far
          console.log(`AI[${eid}]: Player lost. Switching to Idle.`);
          nextState = EnemyAIState.Idle;
          AIState.targetEid[eid] = 0; // Clear target
        } else {
          // --- Chase Behavior ---
          const bodyId = PhysicsBody.bodyId[eid];
          const body = getPhysicsBody(bodyId) as Phaser.Physics.Arcade.Body;
          if (body) {
            const chaseSpeed = 100; // Move to config/component
            scene.physics.moveTo(body.gameObject, playerX, playerY, chaseSpeed); // Use moveTo for simple chasing

            // Update rotation to face player
            const angleToPlayer = Phaser.Math.Angle.Between(
              aiPosX,
              aiPosY,
              playerX,
              playerY
            );
            Rotation.angle[eid] = Phaser.Math.RadToDeg(angleToPlayer);
            // Basic flipping based on player position relative to enemy
            if (playerX < aiPosX) Rotation.angle[eid] = 180;
            else Rotation.angle[eid] = 0;
          }
        }
        break;

      case EnemyAIState.Attacking:
        // Transition conditions from Attacking
        if (distSq > attackRadiusSq * 1.2) {
          // If player moves out of range
          console.log(
            `AI[${eid}]: Player moved out of range. Switching to Chase.`
          );
          nextState = EnemyAIState.Chasing;
          // Stop current attack if any?
          CombatState.isAttackingLight[eid] = 0; // Stop attack state
          CombatState.attackWindowMs[eid] = 0;
        } else if (canAct) {
          // --- Attack Behavior ---
          console.log(`AI[${eid}]: Attempting attack.`);
          // Stop movement before attacking
          const bodyId = PhysicsBody.bodyId[eid];
          const body = getPhysicsBody(bodyId) as Phaser.Physics.Arcade.Body;
          if (body) body.setVelocity(0, 0);

          // Face player
          if (playerX < aiPosX) Rotation.angle[eid] = 180;
          else Rotation.angle[eid] = 0;

          // Initiate enemy attack state (similar to player)
          CombatState.isAttackingLight[eid] = 1; // Use light attack state for now
          CombatState.attackWindowMs[eid] = 600; // Duration of enemy attack anim/hitbox
          CombatState.canMove[eid] = 0; // Prevent movement during attack
          AIState.actionCooldownMs[eid] = 2000; // Cooldown until next attack attempt

          // Spawn Enemy Hitbox (similar to player, but different filter)
          const hitboxEid = addEntity(world);
          addComponent(world, Hitbox, hitboxEid);
          addComponent(world, Position, hitboxEid);
          addComponent(world, PhysicsBody, hitboxEid);
          // Configure Hitbox component
          Hitbox.ownerEid[hitboxEid] = eid;
          Hitbox.offsetX[hitboxEid] = Rotation.angle[eid] === 180 ? -30 : 30; // Adjust offset
          Hitbox.offsetY[hitboxEid] = 5;
          Hitbox.width[hitboxEid] = 40;
          Hitbox.height[hitboxEid] = 30;
          Hitbox.durationMs[hitboxEid] = 300; // Active duration
          Hitbox.startTimeMs[hitboxEid] = world.resources.time + 150; // Activation delay
          Hitbox.maxHits[hitboxEid] = 1;
          Hitbox.filter[hitboxEid] = 1; // 1 = Enemy attack, hits players

          PhysicsBody.bodyId[hitboxEid] = 0; // Will be created by physicsSystem
          PhysicsBody.width[hitboxEid] = Hitbox.width[hitboxEid];
          PhysicsBody.height[hitboxEid] = Hitbox.height[hitboxEid];
          // ... set other PhysicsBody props ...
          PhysicsBody.offsetX[hitboxEid] = 0;
          PhysicsBody.offsetY[hitboxEid] = 0;
          PhysicsBody.collides[hitboxEid] = 0;

          hitboxHitRegistry.delete(hitboxEid); // Clear old hits
          console.log(`AI[${eid}]: Created ENEMY hitbox ${hitboxEid}`);
        }
        break;

      // Add cases for Fleeing, Patrolling later...
    }

    // Update state if changed
    if (nextState !== currentState) {
      AIState.currentState[eid] = nextState;
      AIState.stateDurationMs[eid] = 0; // Reset state timer (or set specific duration if needed)
      // Reset combat state flags when changing AI state (e.g., stop attacking when switching to chase)
      if (nextState !== EnemyAIState.Attacking) {
        CombatState.isAttackingLight[eid] = 0;
        CombatState.attackWindowMs[eid] = 0;
        CombatState.canMove[eid] = 1; // Allow movement unless new state prevents it
      }
    }
  }
}
// --- Input System (TDD 3.2) ---
export function inputSystem(world: InWorld) {
  const { scene } = world.resources;
  const cursors = scene.input.keyboard?.createCursorKeys();
  const keySpace = scene.input.keyboard?.addKey(
    Phaser.Input.Keyboard.KeyCodes.SPACE
  ); // Example specific key
  const keyShift = scene.input.keyboard?.addKey(
    Phaser.Input.Keyboard.KeyCodes.SHIFT
  );
  const keyF = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.F);
  const key1 = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ONE);
  const key2 = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.TWO);
  const key3 = scene.input.keyboard?.addKey(
    Phaser.Input.Keyboard.KeyCodes.THREE
  );
  const key4 = scene.input.keyboard?.addKey(
    Phaser.Input.Keyboard.KeyCodes.FOUR
  );

  const entities = playerInputQuery(world); // Use existing query, ensure it includes CombatState or add it

  for (const eid of entities) {
    // Reset flags/axes
    InputState.moveX[eid] = 0;
    InputState.moveY[eid] = 0;
    InputState.attackHeavy[eid] = 0;
    InputState.technique1[eid] = 0;
    InputState.technique2[eid] = 0;
    InputState.technique3[eid] = 0;
    InputState.technique4[eid] = 0;
    InputState.dodge[eid] = 0;
    InputState.sprint[eid] = 0;

    if (Phaser.Input.Keyboard.JustDown(key1!)) {
      InputState.technique1[eid] = 1; // Using technique1 field for slot 0 (index 0)
      console.log("Input: Key 1 pressed");
    }
    if (Phaser.Input.Keyboard.JustDown(key2!)) {
      InputState.technique2[eid] = 1; // Using technique1 field for slot 0 (index 0)
      console.log("Input: Key 2 pressed");
    }
    if (Phaser.Input.Keyboard.JustDown(key3!)) {
      InputState.technique3[eid] = 1; // Using technique1 field for slot 0 (index 0)
      console.log("Input: Key 3 pressed");
    }
    if (Phaser.Input.Keyboard.JustDown(key4!)) {
      InputState.technique4[eid] = 1; // Using technique1 field for slot 0 (index 0)
      console.log("Input: Key 4 pressed");
    }

    if (Phaser.Input.Keyboard.JustDown(keySpace!)) {
      // Use JustDown for single trigger
      InputState.attackLight[eid] = 1;
    }
    if (Phaser.Input.Keyboard.JustDown(keyF!)) {
      // Check for Heavy Attack
      InputState.attackHeavy[eid] = 1;
    }

    // Read Keyboard Input (Example)
    if (cursors?.left.isDown) InputState.moveX[eid] = -1;
    else if (cursors?.right.isDown) InputState.moveX[eid] = 1;

    if (cursors?.up.isDown) InputState.moveY[eid] = -1;
    else if (cursors?.down.isDown) InputState.moveY[eid] = 1;

    if (cursors?.space.isDown) InputState.attackLight[eid] = 1; // Example mapping
    if (cursors?.shift.isDown) InputState.sprint[eid] = 1; // Example mapping
    // Add more key checks (A, S, D, W, custom keys) for actions based on TDD 3.2.2 mapping

    if (Phaser.Input.Keyboard.JustDown(keyShift!)) {
      InputState.dodge[eid] = 1;
    }

    // Normalize diagonal movement vector if necessary
    const moveX = InputState.moveX[eid];
    const moveY = InputState.moveY[eid];
    if (moveX !== 0 && moveY !== 0) {
      const length = Math.sqrt(moveX * moveX + moveY * moveY);
      InputState.moveX[eid] = moveX / length;
      InputState.moveY[eid] = moveY / length;
    }

    // TODO: Process Gamepad Input
    // TODO: Read Mouse Input for relevant actions (attack, interact?)

    // TODO: Add configuration loading for key/button mapping (TDD 3.2.2)
  }
}

// --- NEW: Cooldown System ---
export function cooldownSystem(world: InWorld) {
  const { delta } = world.resources;
  const deltaMs = delta * 1000;
  const entities = defineQuery([Cooldown])(world);

  for (const eid of entities) {
    Cooldown.attackLightMs[eid] = Math.max(
      0,
      Cooldown.attackLightMs[eid] - deltaMs
    );
    Cooldown.dodgeMs[eid] = Math.max(0, Cooldown.dodgeMs[eid] - deltaMs);
    // Decrement other cooldowns
  }
}

// --- NEW: Combat System (Handles initiating actions) ---
export function combatSystem(world: InWorld) {
  const { time, delta } = world.resources;
  const deltaMs = delta * 1000;
  const playerEntities = defineQuery([
    PlayerControlled,
    InputState,
    CombatState,
    Cooldown,
    TechniqueCooldowns,
    Velocity,
    PhysicsBody,
    Health,
    QiPool,
    StaminaPool,
  ])(world);

  const LIGHT_ATTACK_WINDOW_MS = 350; // Reduced window to encourage faster combos
  const LIGHT_ATTACK_DURATION_MS = 400; // How long the attack state itself lasts
  const LIGHT_ATTACK_COOLDOWN_MS = 500; // Cooldown after initiating sequence start
  const LIGHT_ATTACK_COMBO_WINDOW_MS = 250; // Window *after* attack hits to input next combo step
  const HEAVY_ATTACK_DURATION_MS = 800;
  const HEAVY_ATTACK_COOLDOWN_MS = 1500;
  const HEAVY_ATTACK_STAMINA_COST = 15; // Example cost
  const MAX_COMBO_SEQUENCE = 3; // Example: 3 light attacks

  const DODGE_STAMINA_COST = 20; // Example Cost - Move to config later
  const DODGE_DURATION_MS = 300; // Total dodge animation/state time
  const DODGE_IFRAME_MS = 200; // Invulnerability time (can be shorter)
  const DODGE_COOLDOWN_MS = 800; // Time before next dodge

  for (const eid of playerEntities) {
    // --- Process Timers FIRST ---
    // Decrement all active timers for the entity
    CombatState.attackWindowMs[eid] = Math.max(
      0,
      CombatState.attackWindowMs[eid] - deltaMs
    );
    CombatState.dodgeDurationMs[eid] = Math.max(
      0,
      CombatState.dodgeDurationMs[eid] - deltaMs
    );
    CombatState.parryWindowMs[eid] = Math.max(
      0,
      CombatState.parryWindowMs[eid] - deltaMs
    );
    CombatState.staggerDurationMs[eid] = Math.max(
      0,
      CombatState.staggerDurationMs[eid] - deltaMs
    );
    CombatState.invulnerableDurationMs[eid] = Math.max(
      0,
      CombatState.invulnerableDurationMs[eid] - deltaMs
    );
    TechniqueCooldowns.slot0Ms[eid] = Math.max(
      0,
      TechniqueCooldowns.slot0Ms[eid] - deltaMs
    );
    TechniqueCooldowns.slot1Ms[eid] = Math.max(
      0,
      TechniqueCooldowns.slot1Ms[eid] - deltaMs
    );

    if (hasComponent(world, Casting, eid)) {
      Casting.castDurationMs[eid] = Math.max(
        0,
        Casting.castDurationMs[eid] - deltaMs
      );
    }

    // --- Reset State Flags based on Timers Ending ---
    // Check if states *were* active and their timers just hit zero
    let justFinishedAttack = false;
    if (
      (CombatState.isAttackingLight[eid] ||
        CombatState.isAttackingHeavy[eid]) &&
      CombatState.attackWindowMs[eid] === 0
    ) {
      if (CombatState.isAttackingLight[eid])
        console.log(`CombatSystem[${eid}]: Light Attack state finished.`);
      if (CombatState.isAttackingHeavy[eid])
        console.log(`CombatSystem[${eid}]: Heavy Attack state finished.`);

      CombatState.isAttackingLight[eid] = 0;
      CombatState.isAttackingHeavy[eid] = 0; // Reset both
      // If we didn't successfully chain a combo, reset sequence
      if (CombatState.attackSequence[eid] < MAX_COMBO_SEQUENCE) {
        // Sequence ended naturally or was interrupted
        // console.log(`CombatSystem[${eid}]: Attack sequence reset.`);
        // CombatState.attackSequence[eid] = 0; // Reset handled below
      }
      CombatState.canAttack[eid] = 1; // Allow next action
      justFinishedAttack = true;

      // Don't reset sequence here if combo window logic handles it
    }

    // Combo window timeout check: Reset sequence if combo window expires *without* a new attack starting
    if (
      CombatState.attackSequence[eid] > 0 &&
      CombatState.attackWindowMs[eid] === 0 &&
      !CombatState.isAttackingLight[eid] &&
      !CombatState.isAttackingHeavy[eid]
    ) {
      // console.log(`CombatSystem[${eid}]: Combo window timed out. Resetting sequence.`);
      CombatState.attackSequence[eid] = 0;
    }

    if (CombatState.isDodging[eid] && CombatState.dodgeDurationMs[eid] === 0) {
      CombatState.isDodging[eid] = 0;
      console.log(`CombatSystem[${eid}]: Dodge state finished.`);
    }
    if (
      CombatState.isStaggered[eid] &&
      CombatState.staggerDurationMs[eid] === 0
    )
      CombatState.isStaggered[eid] = 0;
    if (CombatState.isDodging[eid] && CombatState.dodgeDurationMs[eid] === 0)
      CombatState.isDodging[eid] = 0;
    if (CombatState.isParrying[eid] && CombatState.parryWindowMs[eid] === 0)
      CombatState.isParrying[eid] = 0;
    if (
      CombatState.isInvulnerable[eid] &&
      CombatState.invulnerableDurationMs[eid] === 0
    )
      CombatState.isInvulnerable[eid] = 0;
    if (
      hasComponent(world, Casting, eid) &&
      Casting.castDurationMs[eid] === 0
    ) {
      console.log(`CombatSystem[${eid}]: Casting state finished.`);
      removeComponent(world, Casting, eid);
      CombatState.canAttack[eid] = 1; // Allow actions after casting
    }

    // --- Determine Current Ability to Act/Move ---
    // Start by assuming possible, then restrict based on ACTIVE states
    let canCurrentlyAct =
      !CombatState.isStaggered[eid] &&
      !CombatState.isDodging[eid] &&
      !hasComponent(world, Casting, eid); // Cannot act while casting
    let canCurrentlyMove =
      !CombatState.isStaggered[eid] && !hasComponent(world, Casting, eid); // Cannot move while casting

    // Check states that might prevent actions or movement *right now*
    if (
      CombatState.isAttackingLight[eid] ||
      CombatState.isAttackingHeavy[eid]
    ) {
      // Still in attack (timer > 0)
      canCurrentlyAct = false;
      canCurrentlyMove = false; // Restrict movement DURING attack
    }
    if (CombatState.isDodging[eid]) {
      // Still in dodge
      // canCurrentlyAct = false; // Usually can't attack while dodging
      // Movement is allowed during dodge, so don't set canCurrentlyMove = false
    }
    if (CombatState.isParrying[eid]) {
      // Still in parry
      canCurrentlyAct = false;
      canCurrentlyMove = false; // Usually rooted during parry window
    }
    // Add checks for casting, etc.

    // --- Process Inputs to Initiate NEW Actions ---
    const lightAttackInput = InputState.attackLight[eid] === 1;
    const heavyAttackInput = InputState.attackHeavy[eid] === 1;
    const dodgeInput = InputState.dodge[eid] === 1;
    const technique1Input = InputState.technique1[eid] === 1; // Check technique input
    const technique2Input = InputState.technique2[eid] === 1; // Check technique input
    const technique3Input = InputState.technique3[eid] === 1; // Check technique input
    const technique4Input = InputState.technique4[eid] === 1; // Check technique input

    const lightAttackOnCooldown = Cooldown.attackLightMs[eid] > 0;
    const heavyAttackOnCooldown = Cooldown.attackHeavyMs[eid] > 0;
    const dodgeOnCooldown = Cooldown.dodgeMs[eid] > 0;
    const technique1OnCooldown = TechniqueCooldowns.slot0Ms[eid] > 0;
    const technique2OnCooldown = TechniqueCooldowns.slot1Ms[eid] > 0;
    const technique3OnCooldown = TechniqueCooldowns.slot2Ms[eid] > 0;
    const technique4OnCooldown = TechniqueCooldowns.slot3Ms[eid] > 0;

    // --- Initiate Dodge ---
    if (canCurrentlyAct && dodgeInput && !dodgeOnCooldown) {
      // ... (Dodge logic: check stamina, set states, consume stamina, set cooldown) ...
      const currentStamina = StaminaPool.current[eid];
      if (currentStamina >= DODGE_STAMINA_COST) {
        console.log(`CombatSystem[${eid}]: Initiating Dodge.`);
        StaminaPool.current[eid] = currentStamina - DODGE_STAMINA_COST;
        usePlayerStore.getState().consumeStamina(DODGE_STAMINA_COST);
        CombatState.isDodging[eid] = 1;
        CombatState.dodgeDurationMs[eid] = DODGE_DURATION_MS;
        CombatState.isInvulnerable[eid] = 1;
        CombatState.invulnerableDurationMs[eid] = DODGE_IFRAME_MS;
        Cooldown.dodgeMs[eid] = DODGE_COOLDOWN_MS;
        canCurrentlyAct = false; // Update immediately
        // Optional: Interrupt attacks
        CombatState.isAttackingLight[eid] = 0;
        CombatState.isAttackingHeavy[eid] = 0;
        CombatState.attackWindowMs[eid] = 0;
        CombatState.attackSequence[eid] = 0;
      } else {
        /* not enough stamina */
      }
    } else if (canCurrentlyAct && technique1Input && !technique1OnCooldown) {
      // 1. Get Technique ID from active slots
      const activeTechniques = usePlayerStore.getState().activeTechniques; // Get from Zustand
      const techniqueId = activeTechniques[0]; // Slot 0

      if (techniqueId) {
        // 2. Get Technique Data
        const techData = TechniqueRegistry.get(techniqueId);

        if (techData) {
          // 3. Check Resources (Qi)
          const currentQi = QiPool.current[eid];
          if (currentQi >= techData.qiCost) {
            console.log(
              `CombatSystem[${eid}]: Initiating Technique ${techniqueId} (${techData.name}).`
            );
            // 4. Consume Resources
            QiPool.current[eid] = currentQi - techData.qiCost;
            usePlayerStore.getState().setCoreStats({
              qi: { current: QiPool.current[eid], max: QiPool.max[eid] },
            }); // Update Zustand

            // 5. Set Cooldown

            TechniqueCooldowns.slot0Ms[eid] = techData.cooldown * 1000; // Convert sec to ms

            // 6. Initiate Casting State (Optional, for animations/interrupts)
            // For now, trigger effect immediately. Add Casting component later for charge times.
            // addComponent(world, Casting, eid);
            // Casting.techniqueId[eid] = getTechniqueKeyId(techniqueId);
            // Casting.castDurationMs[eid] = 300; // Example cast time
            // Casting.effectTriggered[eid] = 0;
            CombatState.canAttack[eid] = 0; // Prevent other actions momentarily
            CombatState.canMove[eid] = 0; // Prevent movement momentarily

            // 7. Trigger Technique Effect (Placeholder: Projectile)
            if (techData.effectType === "Projectile" && techData.effectData) {
              // Spawn Projectile Hitbox (using techData.effectData)
              const projData = techData.effectData;
              const hitboxEid = addEntity(world);
              addComponent(world, Hitbox, hitboxEid);
              addComponent(world, Position, hitboxEid);
              addComponent(world, PhysicsBody, hitboxEid);
              addComponent(world, CombatState, hitboxEid);
              // Projectile component later? For unique movement?

              Hitbox.ownerEid[hitboxEid] = eid;
              // Initial offset based on player facing
              const angle = Rotation.angle[eid];
              const spawnDist = 40; // How far in front to spawn
              Hitbox.offsetX[hitboxEid] =
                angle === 180 ? -spawnDist : spawnDist;
              Hitbox.offsetY[hitboxEid] = 5;
              Hitbox.width[hitboxEid] = projData.hitboxW ?? 16;
              Hitbox.height[hitboxEid] = projData.hitboxH ?? 16;
              Hitbox.durationMs[hitboxEid] = projData.lifespanMs ?? 2000; // Use lifespan
              Hitbox.startTimeMs[hitboxEid] = world.resources.time; // Activate immediately
              Hitbox.maxHits[hitboxEid] = projData.maxHits ?? 1; // Allow hitting multiple targets?
              Hitbox.filter[hitboxEid] = 0; // Player projectile

              PhysicsBody.bodyId[hitboxEid] = 0;
              PhysicsBody.width[hitboxEid] = Hitbox.width[hitboxEid];
              PhysicsBody.height[hitboxEid] = Hitbox.height[hitboxEid] 
              PhysicsBody.offsetX[hitboxEid] = 0;
              PhysicsBody.offsetY[hitboxEid] = 0;
              PhysicsBody.collides[hitboxEid] = 0; // Overlap only, maybe collide with walls later?

              // Add initial velocity to the *hitbox* entity (need Velocity component)
              addComponent(world, Velocity, hitboxEid);
              const angleRad = Phaser.Math.DegToRad(angle);
              Velocity.vx[hitboxEid] = Math.cos(angleRad) * projData.speed;
              Velocity.vy[hitboxEid] = Math.sin(angleRad) * projData.speed;

              console.log(
                `CombatSystem: Created PROJECTILE hitbox ${hitboxEid} for tech ${techniqueId}`
              );
            } else {
              console.warn(
                `CombatSystem: Technique ${techniqueId} effect type ${techData.effectType} not implemented yet.`
              );
            }

            // Play cast animation if defined
            // if (techData.animationKey) { ... update Renderable.animationKey ... }

            // Update flags immediately
            canCurrentlyAct = false;
            canCurrentlyMove = false; // Prevent movement during cast/trigger
          } else {
            console.log(
              `CombatSystem[${eid}]: Tried Technique ${techniqueId}, not enough Qi.`
            );
          }
        } else {
          console.error(
            `CombatSystem: Technique data not found for ID: ${techniqueId}`
          );
        }
      } else {
        console.log(`CombatSystem: No technique equipped in slot 0.`);
      }
    } else if (canCurrentlyAct && technique2Input && !technique2OnCooldown) {
      // 1. Get Technique ID from active slots
      const activeTechniques = usePlayerStore.getState().activeTechniques; // Get from Zustand
      const techniqueId = activeTechniques[1]; // Slot 0

      if (techniqueId) {
        // 2. Get Technique Data
        const techData = TechniqueRegistry.get(techniqueId);

        if (techData) {
          // 3. Check Resources (Qi)
          const currentQi = QiPool.current[eid];
          if (currentQi >= techData.qiCost) {
            console.log(
              `CombatSystem[${eid}]: Initiating Technique ${techniqueId} (${techData.name}).`
            );
            // 4. Consume Resources
            QiPool.current[eid] = currentQi - techData.qiCost;
            usePlayerStore.getState().setCoreStats({
              qi: { current: QiPool.current[eid], max: QiPool.max[eid] },
            }); // Update Zustand

            // 5. Set Cooldown
            TechniqueCooldowns.slot1Ms[eid] = techData.cooldown * 1000; // Convert sec to ms

            // 6. Initiate Casting State (Optional, for animations/interrupts)
            // For now, trigger effect immediately. Add Casting component later for charge times.
            // addComponent(world, Casting, eid);
            // Casting.techniqueId[eid] = getTechniqueKeyId(techniqueId);
            // Casting.castDurationMs[eid] = 300; // Example cast time
            // Casting.effectTriggered[eid] = 0;
            CombatState.canAttack[eid] = 0; // Prevent other actions momentarily
            CombatState.canMove[eid] = 0; // Prevent movement momentarily

            // 7. Trigger Technique Effect (Placeholder: Projectile)
            if (techData.effectType === "Projectile" && techData.effectData) {
              // Spawn Projectile Hitbox (using techData.effectData)
              const projData = techData.effectData;
              const hitboxEid = addEntity(world);
              addComponent(world, Hitbox, hitboxEid);
              addComponent(world, Position, hitboxEid);
              addComponent(world, PhysicsBody, hitboxEid);
              // Projectile component later? For unique movement?

              Hitbox.ownerEid[hitboxEid] = eid;
              // Initial offset based on player facing
              const angle = Rotation.angle[eid];
              const spawnDist = 40; // How far in front to spawn
              Hitbox.offsetX[hitboxEid] =
                angle === 180 ? -spawnDist : spawnDist;
              Hitbox.offsetY[hitboxEid] = 5;
              Hitbox.width[hitboxEid] = projData.hitboxW ?? 16;
              Hitbox.height[hitboxEid] = projData.hitboxH ?? 16;
              Hitbox.durationMs[hitboxEid] = projData.lifespanMs ?? 2000; // Use lifespan
              Hitbox.startTimeMs[hitboxEid] = world.resources.time; // Activate immediately
              Hitbox.maxHits[hitboxEid] = projData.maxHits ?? 1; // Allow hitting multiple targets?
              Hitbox.filter[hitboxEid] = 0; // Player projectile

              PhysicsBody.bodyId[hitboxEid] = 0;
              PhysicsBody.width[hitboxEid] = Hitbox.width[hitboxEid];
              PhysicsBody.height[hitboxEid] = Hitbox.height[hitboxEid];
              // ... set other PhysicsBody props ...
              PhysicsBody.offsetX[hitboxEid] = 0;
              PhysicsBody.offsetY[hitboxEid] = 0;
              PhysicsBody.collides[hitboxEid] = 0; // Overlap only, maybe collide with walls later?

              // Add initial velocity to the *hitbox* entity (need Velocity component)
              addComponent(world, Velocity, hitboxEid);
              const angleRad = Phaser.Math.DegToRad(angle);
              Velocity.vx[hitboxEid] = Math.cos(angleRad) * projData.speed;
              Velocity.vy[hitboxEid] = Math.sin(angleRad) * projData.speed;

              console.log(
                `CombatSystem: Created PROJECTILE hitbox ${hitboxEid} for tech ${techniqueId}`
              );
            } else {
              console.warn(
                `CombatSystem: Technique ${techniqueId} effect type ${techData.effectType} not implemented yet.`
              );
            }

            // Play cast animation if defined
            // if (techData.animationKey) { ... update Renderable.animationKey ... }

            // Update flags immediately
            canCurrentlyAct = false;
            canCurrentlyMove = false; // Prevent movement during cast/trigger
          } else {
            console.log(
              `CombatSystem[${eid}]: Tried Technique ${techniqueId}, not enough Qi.`
            );
          }
        } else {
          console.error(
            `CombatSystem: Technique data not found for ID: ${techniqueId}`
          );
        }
      } else {
        console.log(`CombatSystem: No technique equipped in slot 0.`);
      }
    } else if (canCurrentlyAct && technique3Input && !technique3OnCooldown) {
      // 1. Get Technique ID from active slots
      const activeTechniques = usePlayerStore.getState().activeTechniques; // Get from Zustand
      const techniqueId = activeTechniques[2]; // Slot 0

      if (techniqueId) {
        // 2. Get Technique Data
        const techData = TechniqueRegistry.get(techniqueId);

        if (techData) {
          // 3. Check Resources (Qi)
          const currentQi = QiPool.current[eid];
          if (currentQi >= techData.qiCost) {
            console.log(
              `CombatSystem[${eid}]: Initiating Technique ${techniqueId} (${techData.name}).`
            );
            // 4. Consume Resources
            QiPool.current[eid] = currentQi - techData.qiCost;
            usePlayerStore.getState().setCoreStats({
              qi: { current: QiPool.current[eid], max: QiPool.max[eid] },
            }); // Update Zustand

            // 5. Set Cooldown
            TechniqueCooldowns.slot2Ms[eid] = techData.cooldown * 1000; // Convert sec to ms

            // 6. Initiate Casting State (Optional, for animations/interrupts)
            // For now, trigger effect immediately. Add Casting component later for charge times.
            // addComponent(world, Casting, eid);
            // Casting.techniqueId[eid] = getTechniqueKeyId(techniqueId);
            // Casting.castDurationMs[eid] = 300; // Example cast time
            // Casting.effectTriggered[eid] = 0;
            CombatState.canAttack[eid] = 0; // Prevent other actions momentarily
            CombatState.canMove[eid] = 0; // Prevent movement momentarily

            // 7. Trigger Technique Effect (Placeholder: Projectile)
            if (techData.effectType === "Projectile" && techData.effectData) {
              // Spawn Projectile Hitbox (using techData.effectData)
              const projData = techData.effectData;
              const hitboxEid = addEntity(world);
              addComponent(world, Hitbox, hitboxEid);
              addComponent(world, Position, hitboxEid);
              addComponent(world, PhysicsBody, hitboxEid);
              // Projectile component later? For unique movement?

              Hitbox.ownerEid[hitboxEid] = eid;
              // Initial offset based on player facing
              const angle = Rotation.angle[eid];
              const spawnDist = 40; // How far in front to spawn
              Hitbox.offsetX[hitboxEid] =
                angle === 180 ? -spawnDist : spawnDist;
              Hitbox.offsetY[hitboxEid] = 5;
              Hitbox.width[hitboxEid] = projData.hitboxW ?? 16;
              Hitbox.height[hitboxEid] = projData.hitboxH ?? 16;
              Hitbox.durationMs[hitboxEid] = projData.lifespanMs ?? 2000; // Use lifespan
              Hitbox.startTimeMs[hitboxEid] = world.resources.time; // Activate immediately
              Hitbox.maxHits[hitboxEid] = projData.maxHits ?? 1; // Allow hitting multiple targets?
              Hitbox.filter[hitboxEid] = 0; // Player projectile

              PhysicsBody.bodyId[hitboxEid] = 0;
              PhysicsBody.width[hitboxEid] = Hitbox.width[hitboxEid];
              PhysicsBody.height[hitboxEid] = Hitbox.height[hitboxEid];
              // ... set other PhysicsBody props ...
              PhysicsBody.offsetX[hitboxEid] = 0;
              PhysicsBody.offsetY[hitboxEid] = 0;
              PhysicsBody.collides[hitboxEid] = 0; // Overlap only, maybe collide with walls later?

              // Add initial velocity to the *hitbox* entity (need Velocity component)
              addComponent(world, Velocity, hitboxEid);
              const angleRad = Phaser.Math.DegToRad(angle);
              Velocity.vx[hitboxEid] = Math.cos(angleRad) * projData.speed;
              Velocity.vy[hitboxEid] = Math.sin(angleRad) * projData.speed;

              console.log(
                `CombatSystem: Created PROJECTILE hitbox ${hitboxEid} for tech ${techniqueId}`
              );
            } else {
              console.warn(
                `CombatSystem: Technique ${techniqueId} effect type ${techData.effectType} not implemented yet.`
              );
            }

            // Play cast animation if defined
            // if (techData.animationKey) { ... update Renderable.animationKey ... }

            // Update flags immediately
            canCurrentlyAct = false;
            canCurrentlyMove = false; // Prevent movement during cast/trigger
          } else {
            console.log(
              `CombatSystem[${eid}]: Tried Technique ${techniqueId}, not enough Qi.`
            );
          }
        } else {
          console.error(
            `CombatSystem: Technique data not found for ID: ${techniqueId}`
          );
        }
      } else {
        console.log(`CombatSystem: No technique equipped in slot 0.`);
      }
    } else if (canCurrentlyAct && technique4Input && !technique4OnCooldown) {
      // 1. Get Technique ID from active slots
      const activeTechniques = usePlayerStore.getState().activeTechniques; // Get from Zustand
      const techniqueId = activeTechniques[3]; // Slot 0

      if (techniqueId) {
        // 2. Get Technique Data
        const techData = TechniqueRegistry.get(techniqueId);

        if (techData) {
          // 3. Check Resources (Qi)
          const currentQi = QiPool.current[eid];
          if (currentQi >= techData.qiCost) {
            console.log(
              `CombatSystem[${eid}]: Initiating Technique ${techniqueId} (${techData.name}).`
            );
            // 4. Consume Resources
            QiPool.current[eid] = currentQi - techData.qiCost;
            usePlayerStore.getState().setCoreStats({
              qi: { current: QiPool.current[eid], max: QiPool.max[eid] },
            }); // Update Zustand

            // 5. Set Cooldown
            TechniqueCooldowns.slot3Ms[eid] = techData.cooldown * 1000; // Convert sec to ms

            // 6. Initiate Casting State (Optional, for animations/interrupts)
            // For now, trigger effect immediately. Add Casting component later for charge times.
            // addComponent(world, Casting, eid);
            // Casting.techniqueId[eid] = getTechniqueKeyId(techniqueId);
            // Casting.castDurationMs[eid] = 300; // Example cast time
            // Casting.effectTriggered[eid] = 0;
            CombatState.canAttack[eid] = 0; // Prevent other actions momentarily
            CombatState.canMove[eid] = 0; // Prevent movement momentarily

            // 7. Trigger Technique Effect (Placeholder: Projectile)
            if (techData.effectType === "Projectile" && techData.effectData) {
              // Spawn Projectile Hitbox (using techData.effectData)
              const projData = techData.effectData;
              const hitboxEid = addEntity(world);
              addComponent(world, Hitbox, hitboxEid);
              addComponent(world, Position, hitboxEid);
              addComponent(world, PhysicsBody, hitboxEid);
              // Projectile component later? For unique movement?

              Hitbox.ownerEid[hitboxEid] = eid;
              // Initial offset based on player facing
              const angle = Rotation.angle[eid];
              const spawnDist = 40; // How far in front to spawn
              Hitbox.offsetX[hitboxEid] =
                angle === 180 ? -spawnDist : spawnDist;
              Hitbox.offsetY[hitboxEid] = 5;
              Hitbox.width[hitboxEid] = projData.hitboxW ?? 16;
              Hitbox.height[hitboxEid] = projData.hitboxH ?? 16;
              Hitbox.durationMs[hitboxEid] = projData.lifespanMs ?? 2000; // Use lifespan
              Hitbox.startTimeMs[hitboxEid] = world.resources.time; // Activate immediately
              Hitbox.maxHits[hitboxEid] = projData.maxHits ?? 1; // Allow hitting multiple targets?
              Hitbox.filter[hitboxEid] = 0; // Player projectile

              PhysicsBody.bodyId[hitboxEid] = 0;
              PhysicsBody.width[hitboxEid] = Hitbox.width[hitboxEid];
              PhysicsBody.height[hitboxEid] = Hitbox.height[hitboxEid];
              // ... set other PhysicsBody props ...
              PhysicsBody.offsetX[hitboxEid] = 0;
              PhysicsBody.offsetY[hitboxEid] = 0;
              PhysicsBody.collides[hitboxEid] = 0; // Overlap only, maybe collide with walls later?

              // Add initial velocity to the *hitbox* entity (need Velocity component)
              addComponent(world, Velocity, hitboxEid);
              const angleRad = Phaser.Math.DegToRad(angle);
              Velocity.vx[hitboxEid] = Math.cos(angleRad) * projData.speed;
              Velocity.vy[hitboxEid] = Math.sin(angleRad) * projData.speed;

              console.log(
                `CombatSystem: Created PROJECTILE hitbox ${hitboxEid} for tech ${techniqueId}`
              );
            } else {
              console.warn(
                `CombatSystem: Technique ${techniqueId} effect type ${techData.effectType} not implemented yet.`
              );
            }

            // Play cast animation if defined
            // if (techData.animationKey) { ... update Renderable.animationKey ... }

            // Update flags immediately
            canCurrentlyAct = false;
            canCurrentlyMove = false; // Prevent movement during cast/trigger
          } else {
            console.log(
              `CombatSystem[${eid}]: Tried Technique ${techniqueId}, not enough Qi.`
            );
          }
        } else {
          console.error(
            `CombatSystem: Technique data not found for ID: ${techniqueId}`
          );
        }
      } else {
        console.log(`CombatSystem: No technique equipped in slot 0.`);
      }
    }
    // --- Initiate Heavy Attack --- (Checks canCurrentlyAct)
    else if (canCurrentlyAct && heavyAttackInput && !heavyAttackOnCooldown) {
      // Check Stamina (Optional cost for heavy)
      const currentStamina = StaminaPool.current[eid];
      if (currentStamina >= HEAVY_ATTACK_STAMINA_COST) {
        console.log(`CombatSystem[${eid}]: Initiating Heavy Attack.`);
        // Consume Stamina
        StaminaPool.current[eid] = currentStamina - HEAVY_ATTACK_STAMINA_COST;
        usePlayerStore.getState().consumeStamina(HEAVY_ATTACK_STAMINA_COST);

        // Set Heavy Attack State
        CombatState.isAttackingHeavy[eid] = 1;
        CombatState.attackWindowMs[eid] = HEAVY_ATTACK_DURATION_MS; // Use window as duration
        CombatState.attackSequence[eid] = 0; // Heavy attack breaks combo sequence
        CombatState.canAttack[eid] = 0; // Prevent other attacks
        Cooldown.attackHeavyMs[eid] = HEAVY_ATTACK_COOLDOWN_MS; // Set heavy cooldown

        // Update ability flags immediately
        canCurrentlyAct = false;
        canCurrentlyMove = false;

        // Reset velocity
        const bodyId = PhysicsBody.bodyId[eid];
        const body = getPhysicsBody(bodyId) as Phaser.Physics.Arcade.Body;
        if (body) body.setVelocity(0, 0);

        // Spawn Heavy Hitbox (Example - different size/offset/damage potential)
        // ... (Add hitbox spawning logic similar to light attack, but perhaps with different params)
        // Example: spawnHitbox(world, eid, 'heavy', HEAVY_HITBOX_PARAMS);
        const hitboxEid = addEntity(world);
        // ... configure Hitbox component ...
        console.log(
          `CombatSystem: Created HEAVY hitbox entity ${hitboxEid} for owner ${eid}`
        );
      } else {
        console.log(
          `CombatSystem[${eid}]: Tried Heavy Attack, not enough stamina.`
        );
      }
    }
    // --- Initiate Light Attack / Combo --- (Checks canCurrentlyAct)
    else if (
      canCurrentlyAct &&
      lightAttackInput &&
      !lightAttackOnCooldown &&
      CombatState.canAttack[eid]
    ) {
      let currentSequence = CombatState.attackSequence[eid];
      let startNewSequence = true;

      // Check if we are *within* the combo window of the *previous* light attack
      if (currentSequence > 0 && currentSequence < MAX_COMBO_SEQUENCE) {
        // Check if the PREVIOUS attack state just finished within the combo window time frame.
        // This logic is tricky. Easier: Check if attackWindowMs IS the combo window timer.
        // Let's adjust: attackWindowMs becomes the combo window after an attack hits/finishes.

        // Simpler approach: If input occurs and sequence > 0 and canAttack is true (meaning previous attack finished), continue combo.
        // This requires canAttack to be reset more carefully.

        // ---- Alternative Combo Logic ----
        // If input is pressed, AND sequence > 0 AND sequence < MAX_COMBO, AND comboWindow > 0
        // Let's refine state reset: When attack finishes, set a short comboWindowMs timer instead of setting canAttack=1 immediately.

        // Let's stick to the original logic first and refine if needed:
        // Allow starting a new attack if current sequence < max AND not currently attacking
        startNewSequence = true; // Always start sequence for now if possible
      }

      if (startNewSequence) {
        currentSequence = 1; // Start or restart sequence
        console.log(
          `CombatSystem[${eid}]: Initiating Light Attack Sequence ${currentSequence}.`
        );
        CombatState.attackSequence[eid] = currentSequence;
        CombatState.isAttackingLight[eid] = 1;
        CombatState.attackWindowMs[eid] = LIGHT_ATTACK_DURATION_MS; // Duration of this attack animation/state
        CombatState.canAttack[eid] = 0;
        Cooldown.attackLightMs[eid] = LIGHT_ATTACK_COOLDOWN_MS; // Cooldown starts on sequence initiation

        canCurrentlyAct = false; // Update immediately
        canCurrentlyMove = false;

        const bodyId = PhysicsBody.bodyId[eid];
        const body = getPhysicsBody(bodyId) as Phaser.Physics.Arcade.Body;
        if (body) body.setVelocity(0, 0);

        // Spawn Hitbox for Attack 1
        // ... (spawn hitbox logic - potentially vary hitbox based on sequence)
        const hitboxEid = addEntity(world);
        // ... configure Hitbox component ...
        console.log(
          `CombatSystem: Created LIGHT hitbox entity ${hitboxEid} for owner ${eid} (Seq ${currentSequence})`
        );
      }
    }

    // --- Set Final State for Other Systems ---
    // Determine final move restriction based on *active* states
    canCurrentlyMove =
      !CombatState.isStaggered[eid] &&
      !CombatState.isAttackingLight[eid] &&
      !CombatState.isAttackingHeavy[eid]; // Only restrict if actively attacking/staggered
    CombatState.canMove[eid] = canCurrentlyMove ? 1 : 0;

    // Clear one-shot input flags AFTER processing them
    InputState.attackLight[eid] = 0;
    InputState.attackHeavy[eid] = 0;
    InputState.dodge[eid] = 0;
  } // End entity loop
}

// --- NEW: Hitbox System (Manages hitbox lifetime and position) ---
export function hitboxSystem(world: InWorld) {
  const { time } = world.resources;
  const entities = hitboxQuery(world); // Query active hitboxes

  for (const eid of entities) {
    const ownerEid = Hitbox.ownerEid[eid];
    let remove = false;

    if (!hasComponent(world, Position, ownerEid)) {
      remove = true; // Owner gone
      console.log(
        `HitboxSystem: Owner ${ownerEid} not found, scheduling removal for hitbox ${eid}`
      );
    } else {
      // ... (Update hitbox position relative to owner) ...

      const startTime = Hitbox.startTimeMs[eid];
      const duration = Hitbox.durationMs[eid];
      const endTime = startTime + duration;
      const isActive = time >= startTime && time < endTime;

      // Update hitbox position relative to owner
      Position.x[eid] = Position.x[ownerEid] + Hitbox.offsetX[eid];
      Position.y[eid] = Position.y[ownerEid] + Hitbox.offsetY[eid];

      // Update visibility/activation state of the physics body
      const bodyId = PhysicsBody.bodyId[eid];
      const body = getPhysicsBody(bodyId) as Phaser.Physics.Arcade.Body;
      if (body) {
         body.position.set(
          Position.x[eid] - body.width * 0.5 + PhysicsBody.offsetX[eid],
          Position.y[eid] - body.height * 0.5 + PhysicsBody.offsetY[eid]
        ); // Center body on Position + offset
      } else if (isActive) {
        // This might happen if physicsSystem hasn't run yet after hitbox creation
        // console.warn(`HitboxSystem: Hitbox ${eid} is active but physics body ${bodyId} not found.`);
      }

      // Schedule removal if duration expires
      if (time >= endTime) {
        remove = true;
        console.log(`HitboxSystem: Duration expired for hitbox ${eid}`);
      }
    }

    if (remove) {
      // Check if owner still exists
      // Owner gone, remove hitbox
      removeComponent(world, Hitbox, eid); // This will trigger cleanup in physics/render systems
      removeComponent(world, Position, eid);
      removeComponent(world, PhysicsBody, eid); // Ensure physics cleanup
      hitboxHitRegistry.delete(eid);
      console.log(
        `HitboxSystem: Owner ${ownerEid} not found, removing hitbox ${eid}`
      );
      continue;
    }
  }
}

// --- NEW: Damage System (Applies damage from TakeDamage component) ---
export function damageSystem(world: InWorld) {
  const entities = damageQuery(world);
  const playerEntities = playerQuery(world); // Need this to find the player EID easily

  let playerEid = -1;
  if (playerEntities.length > 0) {
    playerEid = playerEntities[0]; // Assuming single player
  }

  const STAGGER_DURATION_MS = 250; // Duration of stagger effect (tune later)
  const MIN_DAMAGE_TO_STAGGER = 5; // Only stagger if damage is significant (tune later)

  for (const eid of entities) {
    if (
      !hasComponent(world, Health, eid) ||
      !hasComponent(world, CombatState, eid)
    ) {
      removeComponent(world, TakeDamage, eid); // Clean up component if entity state is invalid
      continue;
    }

    const damageAmount = TakeDamage.amount[eid];
    Health.current[eid] = Math.max(0, Health.current[eid] - damageAmount);

    console.log(
      `DamageSystem: Entity ${eid} took ${damageAmount} damage. New health: ${Health.current[eid]}/${Health.max[eid]}`
    );

    // Trigger Hurt/Stagger State
    // Don't stagger if already staggered or dead
    if (
      Health.current[eid] > 0 &&
      !CombatState.isStaggered[eid] &&
      damageAmount >= MIN_DAMAGE_TO_STAGGER
    ) {
      console.log(`DamageSystem: Staggering Entity ${eid}`);
      CombatState.isStaggered[eid] = 1;
      CombatState.staggerDurationMs[eid] = STAGGER_DURATION_MS;

      // Interrupt current actions (Attack, Dodge, Parry, etc.)
      CombatState.isAttackingLight[eid] = 0;
      CombatState.isAttackingHeavy[eid] = 0;
      CombatState.attackWindowMs[eid] = 0; // Stop attack timer
      CombatState.isDodging[eid] = 0;
      CombatState.dodgeDurationMs[eid] = 0;
      // CombatState.isParrying[eid] = 0; // Add when parry exists
      // CombatState.parryWindowMs[eid] = 0;

      // Stop movement immediately
      const bodyId = PhysicsBody.bodyId[eid];
      const body = getPhysicsBody(bodyId) as Phaser.Physics.Arcade.Body;
      if (body) {
        body.setVelocity(0, 0);
      }
      // Also update movement state flags
      MovementState.isRunning[eid] = 0;
      MovementState.isIdle[eid] = 0; // Hurt anim takes priority

      // If an AI was targeting something, maybe clear target? Optional.
      // if (hasComponent(world, AIState, eid)) {
      //     AIState.targetEid[eid] = 0;
      // }
    }

    // Check for death
    if (Health.current[eid] === 0) {
      console.log(`DamageSystem: Entity ${eid} died.`);
      // TODO: Set Dead state flag in MovementState or CombatState
      MovementState.isDead[eid] = 1; // Example using MovementState
      CombatState.isStaggered[eid] = 0; // Cannot be staggered if dead
      // TODO: Disable physics collision? Add death effects? Remove entity after delay?
      const bodyId = PhysicsBody.bodyId[eid];
      const body = getPhysicsBody(bodyId);
      if (body) {
        body.enable = false;
      } // Disable physics body
    } else {
      // Ensure dead flag is off if alive (might be needed if resurrection exists later)
      MovementState.isDead[eid] = 0;
    }

    // If the damaged entity is the player, dispatch update to Zustand store
    if (eid === playerEid) {
      usePlayerStore.getState().takeDamage(damageAmount); // Dispatch raw damage amount
      console.log(
        `DamageSystem: Dispatched player damage ${damageAmount} to Zustand store.`
      );
    }

    // Remove TakeDamage component after processing
    removeComponent(world, TakeDamage, eid);
  }
}

// --- Movement System (Basic Ground - TDD 3.2.4, 6.1) ---
export function movementSystem(world: InWorld) {
  // const { delta } = world.resources;
  const speed = 200; // Base speed, move to config/component later
  const sprintMultiplier = 1.5; // Example sprint speed increase
  const DODGE_SPEED_BURST = 450; // Faster than sprint

  // --- Sync Physics Body Position back to ECS Position ---
  // Necessary because Arcade Physics updates the body directly
  const movingEntities = defineQuery([
    Position,
    Rotation,
    PlayerControlled,
    InputState,
    Velocity,
    PhysicsBody,
    MovementState,
    CombatState, // Needed to check 'canMove'
    StaminaPool, // Needed for sprinting cost
  ])(world);

  for (const eid of movingEntities) {
    const bodyId = PhysicsBody.bodyId[eid];
    const body = getPhysicsBody(bodyId);
    if (!body) continue;

    const inputX = InputState.moveX[eid];
    const inputY = InputState.moveY[eid];
    const isSprinting = InputState.sprint[eid] === 1;
    const canMoveStandard = CombatState.canMove[eid] === 1; // Standard movement allowed flag
    const isDodging = CombatState.isDodging[eid] === 1; // Check dodge state

    // Add this log:
    if (inputX !== 0 || inputY !== 0) {
      console.log(
        `MovementSystem[${eid}]: Input=(${inputX},${inputY}), CanMove=${canMoveStandard}, Body=${
          body ? "Exists" : "MISSING!"
        }`
      );
    }

    let targetVelocityX = 0;
    let targetVelocityY = 0;
    let isActuallySprinting = false;

    if (isDodging) {
      // --- Dodge Movement ---
      MovementState.isRunning[eid] = 0; // Not standard running
      MovementState.isIdle[eid] = 0;
      // Determine dodge direction: Use current input if moving, otherwise use facing direction
      let dodgeDirX = inputX;
      let dodgeDirY = inputY;

      if (dodgeDirX === 0 && dodgeDirY === 0) {
        // If no movement input, dodge in facing direction
        const angleRad = Phaser.Math.DegToRad(Rotation.angle[eid]);
        dodgeDirX = Math.cos(angleRad);
        dodgeDirY = Math.sin(angleRad); // Note: Phaser angles often 0 right, 180 left
        if (Rotation.angle[eid] === 180) dodgeDirX = -1; // Simpler for cardinal
        else dodgeDirX = 1; // Default right if angle is 0
        dodgeDirY = 0;
      }

      // Normalize dodge direction if needed (already done for input, but good practice if using angle)
      const len = Math.sqrt(dodgeDirX * dodgeDirX + dodgeDirY * dodgeDirY);
      if (len > 0) {
        dodgeDirX /= len;
        dodgeDirY /= len;
      } else {
        dodgeDirX = Rotation.angle[eid] === 180 ? -1 : 1; // Fallback if len is 0 (shouldn't happen)
      }

      targetVelocityX = dodgeDirX * DODGE_SPEED_BURST;
      targetVelocityY = dodgeDirY * DODGE_SPEED_BURST;
      console.log(
        `MovementSystem[${eid}]: Dodging Vel=(${targetVelocityX}, ${targetVelocityY})`
      );

      // Update MovementState for dodge animation (needs definition)
      // MovementState.isDodging[eid] = 1; // We already have CombatState.isDodging
    } else if (canMoveStandard) {
      // --- Standard Movement & Sprinting ---
      let currentSpeed = speed;
      if (isSprinting && StaminaPool.current[eid] > 0) {
        currentSpeed = speed * sprintMultiplier;
        isActuallySprinting = true;
        // Stamina cost for sprint might be better handled per second in a resource system
        // StaminaPool.current[eid] -= SPRINT_STAMINA_COST_PER_FRAME * world.resources.delta;
        // usePlayerStore.getState().consumeStamina(SPRINT_STAMINA_COST_PER_FRAME * world.resources.delta);
      }

      targetVelocityX = inputX * currentSpeed;
      targetVelocityY = inputY * currentSpeed;

      // Update MovementState for animation
      if (Math.abs(targetVelocityX) > 0 || Math.abs(targetVelocityY) > 0) {
        MovementState.isRunning[eid] = 1;
        MovementState.isIdle[eid] = 0;
        // TODO: Set isSprinting state if needed for animations
      } else {
        MovementState.isRunning[eid] = 0;
        MovementState.isIdle[eid] = 1;
      }

      // Update Rotation based on horizontal movement input
      if (inputX !== 0) {
        // Only update rotation if there's horizontal input
        Rotation.angle[eid] = inputX < 0 ? 180 : 0;
      }
    } else {
      // If movement is blocked (e.g., attacking, staggered)
      MovementState.isRunning[eid] = 0;
      MovementState.isIdle[eid] = 0; // Allow other state animations
      targetVelocityX = 0;
      targetVelocityY = 0;
    }

    // Set final velocity on the Phaser body
    body.setVelocityX(targetVelocityX);
    body.setVelocityY(targetVelocityY);

    // Reset sprint input flag *after* using it
    // InputState.sprint[eid] = 0; // This should be reset in inputSystem if based on key *down*
  }

  const projectileEntities = velocityMovementQuery(world);
  for (const eid of projectileEntities) {
    if (hasComponent(world, PlayerControlled, eid)) continue;
    if (hasComponent(world, Enemy, eid)) continue;

    // Get body - should exist if physicsSystem ran
    const bodyId = PhysicsBody.bodyId[eid];
    const body = getPhysicsBody(bodyId) as Phaser.Physics.Arcade.Body;
    console.log("Projectile:", body.enable)
    if (!body) continue;

    body.setVelocityX(Velocity.vx[eid]);
    body.setVelocityY(Velocity.vy[eid]);

    // Projectiles typically don't change state based on movement, so skip MovementState updates here
    // Update Rotation based on velocity? (Optional for projectiles)
    if (Velocity.vx[eid] < -1) Rotation.angle[eid] = 180;
    else if (Velocity.vx[eid] > 1) Rotation.angle[eid] = 0;
  }

  // TODO: Implement stamina consumption logic (maybe in a separate resourceSystem?)
  // if (isActuallySprinting) { usePlayerStore.getState().consumeStamina(STAMINA_COST); }
}

// --- Render System (TDD 2.5 Bridge, 4.6) ---
export function renderSystem(world: InWorld) {
  const { scene } = world.resources;

  // Handle newly added renderable entities
  const entered = newRenderableQuery(world);
  for (const eid of entered) {
    // Only create sprite if it doesn't already exist in the map
    if (!spriteMap.has(eid) && hasComponent(world, Position, eid)) {
      const spriteKeyId = Renderable.spriteKey[eid];
      const spriteKey = getSpriteKeyById(spriteKeyId);
      const initialAnimId = Renderable.animationKey[eid];
      const initialAnimKey = getAnimationKeyById(initialAnimId);

      if (spriteKey) {
        const x = Position.x[eid];
        const y = Position.y[eid];
        const newSprite = scene.add.sprite(x, y, spriteKey);
        newSprite.setDepth(Renderable.depth[eid] ?? 0);
        newSprite.setAngle(Rotation.angle[eid] ?? 0);
        newSprite.setTint(Renderable.tint[eid] ?? 0xffffff);
        newSprite.setVisible(Renderable.visible[eid] === 1);
        newSprite.setData("eid", eid); // Tag the visual sprite too

        if (initialAnimKey) {
          newSprite.play(initialAnimKey, true);
        }

        spriteMap.set(eid, newSprite); // Add the *visual* sprite to the map
        console.log(
          `RenderSystem: Created visual sprite for entity ${eid} with key ${spriteKey}`
        );
      } else {
        console.error(
          `RenderSystem: Cannot create visual sprite for entity ${eid}, invalid spriteKeyId ${spriteKeyId}`
        );
      }
    }
  }

  // Update existing sprites
  const entities = renderableQuery(world);
  for (const eid of entities) {
    const sprite = spriteMap.get(eid);
    if (!sprite) continue; // Sprite might not exist yet if render ran before physics on first frame

    // Update VISUAL sprite position from ECS Position component
    // (ECS Position is updated by syncPositionSystem from the PHYSICS placeholder body)
    sprite.x = Position.x[eid];
    sprite.y = Position.y[eid];
    sprite.setAngle(Rotation.angle[eid] ?? 0);
    sprite.setDepth(Renderable.depth[eid] ?? 0);
    sprite.setTint(Renderable.tint[eid] ?? 0xffffff);
    sprite.setVisible(Renderable.visible[eid] === 1);

    // Animation Control (as before)
    const animKeyId = Renderable.animationKey[eid];
    const targetAnimKey = getAnimationKeyById(animKeyId);
    if (targetAnimKey && sprite.anims.currentAnim?.key !== targetAnimKey) {
      sprite.play(targetAnimKey, true);
    }

    // Flipping (as before)
    sprite.setFlipX(Rotation.angle[eid] === 180);
  }

  // Handle removed renderable entities (Destroy visual sprite)
  const exited = exitedRenderableQuery(world);
  for (const eid of exited) {
    const sprite = spriteMap.get(eid);
    if (sprite) {
      console.log(`RenderSystem: Destroying visual sprite for entity ${eid}`);
      sprite.destroy();
      spriteMap.delete(eid);
    }
  }
}

// --- Animation System (TDD 4.6) ---
// Determines which animation should play based on MovementState
export function animationSystem(world: InWorld) {
  const { scene } = world.resources;
  const entities = defineQuery([Renderable, MovementState, CombatState])(world); // Entities with state and visuals

  for (const eid of entities) {
    let targetAnimKey = undefined; // Keep current if no state matches

    // Animation Keys (assuming they exist from GameScene.create)
    const idleAnimKey = AssetKeys.Anims.PLAYER_IDLE;
    const runAnimKey = AssetKeys.Anims.PLAYER_RUN;
    const attackLight1AnimKey = AssetKeys.Anims.PLAYER_ATTACK_LIGHT_1;
    const attackLight2AnimKey = AssetKeys.Anims.PLAYER_ATTACK_LIGHT_2; // Placeholder
    const attackLight3AnimKey = AssetKeys.Anims.PLAYER_ATTACK_LIGHT_3; // Placeholder
    const attackHeavyAnimKey = AssetKeys.Anims.PLAYER_ATTACK_HEAVY; // Placeholder
    const dodgeAnimKey = AssetKeys.Anims.PLAYER_DODGE; // Placeholder
    const hurtAnimKey = "player_hurt"; // Placeholder for hurt/stagger
    const deadAnimKey = "player_die";

    // Logic based on MovementState flags (add more states later)
    if (MovementState.isDead[eid]) {
      // Highest priority: Death
      targetAnimKey = deadAnimKey;
    } else if (CombatState.isStaggered[eid]) {
      // Next priority: Staggered/Hurt
      targetAnimKey = hurtAnimKey;
    } else if (CombatState.isDodging[eid]) {
      targetAnimKey = dodgeAnimKey; // Need to define this animation
    } else if (CombatState.isAttackingHeavy[eid]) {
      targetAnimKey = attackHeavyAnimKey; // Need to define this animation
    } else if (CombatState.isAttackingLight[eid]) {
      // Select combo animation based on sequence
      switch (CombatState.attackSequence[eid]) {
        case 1:
          targetAnimKey = attackLight1AnimKey;
          break;
        // case 2: targetAnimKey = attackLight2AnimKey; break; // Add later
        // case 3: targetAnimKey = attackLight3AnimKey; break; // Add later
        default:
          targetAnimKey = attackLight1AnimKey;
          break; // Fallback
      }
    } else if (MovementState.isRunning[eid]) {
      targetAnimKey = runAnimKey;
    } else if (MovementState.isIdle[eid]) {
      targetAnimKey = idleAnimKey;
    } else {
      // Default to idle if no other state matches, but might be falling/jumping etc.
      targetAnimKey = idleAnimKey;
    }

    // Update the Renderable component's animation key ID if it changed
    if (targetAnimKey) {
      const currentAnimId = Renderable.animationKey[eid];
      const targetAnimKeyId = getAnimationKeyId(targetAnimKey); // Ensure key is registered
      if (
        scene.anims.exists(targetAnimKey) &&
        currentAnimId !== targetAnimKeyId
      ) {
        Renderable.animationKey[eid] = targetAnimKeyId;
      } else if (!scene.anims.exists(targetAnimKey)) {
        // Fallback if hurt/dodge/heavy anim doesn't exist yet
        if (
          CombatState.isStaggered[eid] ||
          CombatState.isDodging[eid] ||
          CombatState.isAttackingHeavy[eid]
        ) {
          const idleId = getAnimationKeyId(idleAnimKey);
          if (Renderable.animationKey[eid] !== idleId)
            Renderable.animationKey[eid] = idleId;
        }
        // console.warn(`AnimationSystem: Animation key "${targetAnimKey}" not found.`);
      }
    } else {
      const idleId = getAnimationKeyId(idleAnimKey);
      if (Renderable.animationKey[eid] !== idleId)
        Renderable.animationKey[eid] = idleId;
    }
  }
}

// --- Physics Sync System (TDD 2.5 Bridge) ---
// Manages creation/deletion of Phaser physics bodies based on ECS components
export function physicsSystem(world: InWorld) {
  const { scene } = world.resources;
  // Cast scene to GameScene to access groups easily, or check type
  const gameScene = scene as GameScene; // Assuming GameScene has the groups public/accessible
  // Ensure groups exist before proceeding
  if (
    !gameScene.playerGroup ||
    !gameScene.enemyGroup ||
    !gameScene.playerHitboxGroup ||
    !gameScene.enemyHitboxGroup
  ) {
    // Check new group
    console.warn("PhysicsSystem: Required physics groups not found on scene.");
    return;
  }
  const enteredPhysics = enterQuery(physicsQuery)(world);
  const exitedPhysics = exitQuery(physicsQuery)(world); // Entities losing physics requirement

  for (const eid of enteredPhysics) {
    console.log("Physics System[" + eid + "]");
    // Only process if the body hasn't been created yet
    if (PhysicsBody.bodyId[eid] === 0 && hasComponent(world, Position, eid)) {
      const x = Position.x[eid];
      const y = Position.y[eid];

      const placeholderGO = scene.physics.add.sprite(x, y, "__DEFAULT"); // Use Phaser's default key
      placeholderGO.setVisible(false).setActive(false); // Keep it inactive and invisible
      placeholderGO.setData("eid", eid);
      placeholderGO.setData("isPlaceholder", true); // Mark it

      const bodyInstance = placeholderGO.body as Phaser.Physics.Arcade.Body;

      if (bodyInstance && placeholderGO) {
        const bodyId = registerPhysicsBody(bodyInstance);
        PhysicsBody.bodyId[eid] = bodyId;

        // Configure body properties from component
        bodyInstance.setSize(PhysicsBody.width[eid], PhysicsBody.height[eid]);

        const bodyOffsetX = PhysicsBody.offsetX[eid];
        const bodyOffsetY = PhysicsBody.offsetY[eid];
        placeholderGO.setPosition(x, y); // Set position explicitly
        bodyInstance.setOffset(bodyOffsetX, bodyOffsetY); // Use component offset

        bodyInstance.setCollideWorldBounds(PhysicsBody.collides[eid] === 1);
        bodyInstance.allowGravity = false;
        const shouldMove = hasComponent(world, Velocity, eid) && (Velocity.vx[eid] !== 0 || Velocity.vy[eid] !== 0);
        const isHitbox = hasComponent(world, Hitbox, eid);
        bodyInstance.enable = shouldMove || !isHitbox;
        console.log(shouldMove, isHitbox, bodyInstance.enable);

        console.log(
          `PhysicsSystem: Created placeholder body ID ${bodyId} for EID ${eid}`
        );

        // --- Add Placeholder GameObject to the Correct Group ---
        if (hasComponent(world, PlayerControlled, eid))
          gameScene.playerGroup.add(placeholderGO);
        else if (hasComponent(world, Enemy, eid))
          gameScene.enemyGroup.add(placeholderGO);
        else if (hasComponent(world, Hitbox, eid)) {
          if (Hitbox.filter[eid] === 0)
            gameScene.playerHitboxGroup.add(placeholderGO);
          else if (Hitbox.filter[eid] === 1)
            gameScene.enemyHitboxGroup.add(placeholderGO);
        }
      } else {
        console.error(
          `PhysicsSystem: Failed to create physics body for placeholder GO (EID: ${eid})`
        );
        placeholderGO.destroy(); // Clean up useless placeholder
      }
    }
  }

  // Cleanup exited bodies
  for (const eid of exitedPhysics) {
    const bodyId = PhysicsBody.bodyId[eid];
    if (bodyId !== 0) {
      const body = getPhysicsBody(bodyId);
      if (body) {
        const gameObject = body.gameObject as Phaser.Physics.Arcade.Sprite; // Assume sprite placeholder
        if (gameObject) {
          // Remove placeholder from its Group
          if (hasComponent(world, PlayerControlled, eid))
            gameScene.playerGroup?.remove(gameObject, true, true);
          else if (hasComponent(world, Enemy, eid))
            gameScene.enemyGroup?.remove(gameObject, true, true);
          else if (hasComponent(world, Hitbox, eid)) {
            // Determine group based on filter/owner and remove
            if (Hitbox.filter[eid] === 0)
              gameScene.playerHitboxGroup?.remove(gameObject, true, true);
            else if (Hitbox.filter[eid] === 1)
              gameScene.enemyHitboxGroup?.remove(gameObject, true, true);
            else gameObject.destroy(); // Destroy if filter unknown?
          } else gameObject.destroy(); // Destroy if not in a known group

          console.log(
            `PhysicsSystem: Destroyed placeholder GO & Body ID ${bodyId} (EID ${eid})`
          );

          // Double check if destroy is needed if group removal handles it
          // The `true, true` arguments to group.remove should handle destroy. Test this. If not, call gameObject.destroy() manually.
        } else {
          // Body exists but no GO? Should be rare. Destroy body directly.
          body.destroy();
          console.log(
            `PhysicsSystem: Destroyed standalone body BodyID ${bodyId} (EID ${eid}) (No GO found)`
          );
        }
        removePhysicsBody(bodyId); // Remove mapping
      }
      PhysicsBody.bodyId[eid] = 0; // Reset component's bodyId
    }
  }
}

// --- Update Global Collision Handler ---
// No changes needed here, but ensure ecsWorld is attached to scene
export function handleHitboxOverlap(
  obj1: Phaser.Types.Physics.Arcade.ArcadeColliderType,
  obj2: Phaser.Types.Physics.Arcade.ArcadeColliderType
) {
  const go1 = obj1 as Phaser.Types.Physics.Arcade.GameObjectWithBody;
  const go2 = obj2 as Phaser.Types.Physics.Arcade.GameObjectWithBody;
  const world = go1.scene.ecsWorld;
  if (!world) return;

  const eid1 = go1.getData("eid") as number | undefined;
  const eid2 = go2.getData("eid") as number | undefined;

  if (eid1 === undefined || eid2 === undefined || eid1 === eid2) return;

  // Determine which is the hitbox and which is the target
  let hitboxEid: number | undefined;
  let targetEid: number | undefined;
  let hitboxFilter: number | undefined;

  if (hasComponent(world, Hitbox, eid1)) {
    hitboxEid = eid1;
    targetEid = eid2;
    hitboxFilter = Hitbox.filter[hitboxEid];
  } else if (hasComponent(world, Hitbox, eid2)) {
    hitboxEid = eid2;
    targetEid = eid1;
    hitboxFilter = Hitbox.filter[hitboxEid];
  } else {
    return; // Neither object involved is a hitbox entity
  }

  if (hitboxEid === undefined || targetEid === undefined || hitboxEid === targetEid) return;

  const hitboxStartTime = Hitbox.startTimeMs[hitboxEid];
  const hitboxDuration = Hitbox.durationMs[hitboxEid];
  const currentTime = world.resources.time; // Get current time
  const isHitboxActive = currentTime >= hitboxStartTime && currentTime < (hitboxStartTime + hitboxDuration);

  if (!isHitboxActive) {
      // console.log(`Collision Handler: Hitbox EID ${hitboxEid} is not active. Time: ${currentTime}`);
      return; // Ignore overlap if the hitbox isn't supposed to be active
  }

  // Basic Target Filtering (Player hitboxes hit Enemies, Enemy hitboxes hit Player)
  const targetIsPlayer = hasComponent(world, PlayerControlled, targetEid);
  const targetIsEnemy = hasComponent(world, Enemy, targetEid);

  // Proceed only if hitbox filter matches target type
  if (hitboxFilter === 0 && !targetIsEnemy) return; // Player hitbox didn't hit an enemy
  if (hitboxFilter === 1 && !targetIsPlayer) return; // Enemy hitbox didn't hit the player

  // Check if hitbox component still exists and target has Health
  if (
    !hasComponent(world, Hitbox, hitboxEid) ||
    !hasComponent(world, Health, targetEid)
  ) {
    return;
  }

  // Hit registry logic (prevent multiple hits from same hitbox instance)
  let hitSet = hitboxHitRegistry.get(hitboxEid);
  if (!hitSet) {
    hitSet = new Set<number>();
    hitboxHitRegistry.set(hitboxEid, hitSet);
  }
  const maxHits = Hitbox.maxHits[hitboxEid];
  if (
    Hitbox.ownerEid[hitboxEid] === targetEid ||
    hitSet.has(targetEid) ||
    hitSet.size >= maxHits
  ) {
    return; // Prevent self-hits, double-hits, or exceeding max hits
  }

  // --- Process Hit ---
  console.log(
    `Collision Handler: Hitbox EID ${hitboxEid} (Owner: ${Hitbox.ownerEid[hitboxEid]}, Filter: ${hitboxFilter}) hit Target EID ${targetEid}`
  );
  hitSet.add(targetEid);

  // Add TakeDamage component if target doesn't have it
  if (!hasComponent(world, TakeDamage, targetEid)) {
    addComponent(world, TakeDamage, targetEid);
    // TODO: Get actual damage based on hitbox owner/type
    TakeDamage.amount[targetEid] = hitboxFilter === 0 ? 15 : 10; // Example: Player hits harder
    TakeDamage.sourceEid[targetEid] = Hitbox.ownerEid[hitboxEid];
    console.log(
      `Collision Handler: Added TakeDamage (${TakeDamage.amount[targetEid]}) to Target EID ${targetEid}`
    );
  }
}
declare module "phaser" {
  interface Scene {
    ecsWorld?: InWorld;
  }
}
