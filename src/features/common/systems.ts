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
import { CultivationRealm, DaoType, InWorld } from "@/types";
import * as AssetKeys from "@/constants/assets"; // Import constants
import GameScene from "@/scenes/GameScene";
import { TechniqueRegistry } from "@/config/technique";

import EasyStar from "easystarjs";
import { calculateRegenRates } from "@/config/realms";
import { DAO_PASSIVE_FACTORS } from "@/config/progression";

// --- System Inputs/Resources ---
// Define interfaces for resources systems need, like Phaser scene or input manager
export interface SystemResources {
  time: number;
  delta: number;
  scene: Phaser.Scene; // For accessing input, physics, rendering
  playerGroup: Phaser.Physics.Arcade.Group;
  enemyGroup: Phaser.Physics.Arcade.Group;
  playerHitboxGroup: Phaser.Physics.Arcade.Group;
  collisionLayer?: Phaser.Tilemaps.TilemapLayer;
  easystar?: EasyStar.js; // <-- Add EasyStar instance
  aiPathMap?: Map<number, { x: number; y: number }[]>; // <-- Add Path Map
  map?: Phaser.Tilemaps.Tilemap; // <-- Add Tilemap
}

// --- Queries ---
const resourceRegenQuery = defineQuery([
  PlayerControlled,
  QiPool,
  StaminaPool,
  Health,
]);
const velocityMovementQuery = defineQuery([
  Position,
  Velocity,
  PhysicsBody,
  CombatState,
]);
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
const physicsQuery = defineQuery([PhysicsBody]); // Query entities needing physics handling
const renderableQuery = defineQuery([Position, Rotation, Renderable]);
const newRenderableQuery = enterQuery(renderableQuery);
const exitedRenderableQuery = exitQuery(renderableQuery);
const hitboxQuery = defineQuery([Hitbox, Position, PhysicsBody]);
const damageQuery = defineQuery([TakeDamage, Health]);

const spriteMap = new Map<number, Phaser.GameObjects.Sprite>();
const hitboxHitRegistry = new Map<number, Set<number>>();
let regenTimer = 0;
const REGEN_INTERVAL_MS = 1000;
const FLIGHT_UNLOCK_REALM = CultivationRealm.FoundationEstablishment; // TDD 6.2.2
const FLIGHT_SPEED = 180; // Slightly slower than ground sprint? Tune later
const FLIGHT_QI_COST_PER_SEC = 5; // Example Qi cost
const BLINK_DISTANCE = 150; // Pixels
const BLINK_STAMINA_COST = 15; // Example cost
const BLINK_COOLDOWN_MS = 1000; // Example cooldown

// --- New System Function ---
export function resourceRegenSystem(world: InWorld) {
  const { delta } = world.resources; // Get delta time in seconds
  const deltaMs = delta * 1000;

  regenTimer += deltaMs;

  // Only run the logic at the specified interval
  if (regenTimer >= REGEN_INTERVAL_MS) {
    const elapsedSeconds = regenTimer / 1000.0; // Get the actual time passed for accurate rates
    const entities = resourceRegenQuery(world);
    const playerState = usePlayerStore.getState(); 

    const { qiRegen, staminaRegen } = calculateRegenRates(playerState.realm, playerState.soulAspects);
    const finalQiRegen = qiRegen; // Using base calc for now
    const finalStaminaRegen = staminaRegen;

    for (const eid of entities) {
      // Basic check: Don't regenerate if dead
      if (Health.current[eid] <= 0) continue;

      let qiChanged = false;
      let staminaChanged = false;

      // Calculate amounts to regenerate for this interval
      const qiToRegen = finalQiRegen * elapsedSeconds;
      const staminaToRegen = finalStaminaRegen * elapsedSeconds;

      // Qi Regeneration
      const currentQi = QiPool.current[eid];
      const maxQi = QiPool.max[eid];  
      if (currentQi < maxQi) {
        const newQi = Math.min(maxQi, currentQi + qiToRegen);
        if (newQi !== currentQi) {
          // Only update if value actually changes
          QiPool.current[eid] = newQi;
          qiChanged = true;
        }
      }

      // --- Stamina Regeneration ---
      const currentStamina = StaminaPool.current[eid];
      const maxStamina = StaminaPool.max[eid];
      if (currentStamina < maxStamina) {
        const newStamina = Math.min(
          maxStamina,
          currentStamina + staminaToRegen
        );
        if (newStamina !== currentStamina) {
          // Only update if value actually changes
          StaminaPool.current[eid] = newStamina;
          staminaChanged = true;
        }
      }

      // --- Dispatch to Zustand if changes occurred ---
      // We only need to dispatch if the player entity (which has PlayerControlled) changed.
      // Using the existing setCoreStats action in Zustand store.
      if (qiChanged || staminaChanged) {
        // Dispatch the *new current state* of the relevant stat pool
        usePlayerStore.getState().setCoreStats({
          // Only include the stat that changed in the update object
          ...(qiChanged && {
            qi: { current: QiPool.current[eid], max: QiPool.max[eid] },
          }),
          ...(staminaChanged && {
            stamina: {
              current: StaminaPool.current[eid],
              max: StaminaPool.max[eid],
            },
          }),
        });
        // Optional: Log the regeneration event
        // console.log(`RegenSystem: Player ${eid} - Qi: ${QiPool.current[eid].toFixed(1)}, Stamina: ${StaminaPool.current[eid].toFixed(1)}`);
      }
    }

    // Reset timer: Subtract the interval duration, keeping any leftover time
    // This handles cases where delta causes the timer to overshoot the interval slightly
    regenTimer -= REGEN_INTERVAL_MS;
  }
}

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
  const { scene, time, delta, easystar, aiPathMap, collisionLayer, map } =
    world.resources;
  const deltaMs = delta * 1000;

  const aiEntities = aiQuery(world);
  const players = playerQuery(world);

  // Simple check: Assume single player for targeting
  if (players.length === 0) return; // No player to react to
  const playerEid = players[0];
  const playerWorldX = Position.x[playerEid] + PhysicsBody.width[playerEid] / 2; // Player center X
  const playerWorldY =
    Position.y[playerEid] + PhysicsBody.height[playerEid] / 2; // Player center Y

  // Ensure needed resources are available
  if (!easystar || !aiPathMap || !collisionLayer || !map) {
    console.log("AI System: ", easystar, aiPathMap, collisionLayer, map);
    console.warn(
      "AI System: Missing required resources (easystar, pathMap, collisionLayer, map). Skipping."
    );
    return;
  }

  const worldToTile = (
    worldX: number,
    worldY: number
  ): { x: number; y: number } | null => {
    const tile = collisionLayer.worldToTileXY(worldX, worldY);
    return tile ? { x: tile.x, y: tile.y } : null;
  };

  const tileToWorldCenter = (
    tileX: number,
    tileY: number
  ): { x: number; y: number } | null => {
    const worldX = collisionLayer.tileToWorldX(tileX);
    const worldY = collisionLayer.tileToWorldY(tileY);
    return worldX !== null && worldY !== null
      ? { x: worldX + map.tileWidth / 2, y: worldY + map.tileHeight / 2 }
      : null;
  };

  for (const eid of aiEntities) {
    const aiWorldX = Position.x[eid] + PhysicsBody.width[eid] / 2; // AI center X
    const aiWorldY = Position.y[eid] + PhysicsBody.height[eid] / 2; // AI center Y

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
      aiWorldX,
      aiWorldY,
      playerWorldX,
      playerWorldY
    );
    const canAct =
      AIState.actionCooldownMs[eid] === 0 && !CombatState.isStaggered[eid];
    const bodyId = PhysicsBody.bodyId[eid];
    const body = getPhysicsBody(bodyId) as Phaser.Physics.Arcade.Body; // Cast for easier access

    let nextState = currentState;

    switch (currentState) {
      case EnemyAIState.Idle:
        if (distSq < perceptionRadiusSq) {
          console.log(`AI[${eid}]: Player detected. Switching to Chase.`);
          nextState = EnemyAIState.Chasing;
          AIState.targetEid[eid] = playerEid;
          AIState.currentPathIndex[eid] = -1; // Reset path state
          aiPathMap.delete(eid); // Clear any old path
          AIState.lastTargetTileX[eid] = -1; // Force recalc
          AIState.lastTargetTileY[eid] = -1;
        } else {
          if (body) body.setVelocity(0, 0);
        }
        break;

      case EnemyAIState.Chasing:
        // Transition conditions from Chasing
        if (distSq < attackRadiusSq) {
          console.log(`AI[${eid}]: Reached attack range. Switching to Attack.`);
          nextState = EnemyAIState.Attacking;
          AIState.actionCooldownMs[eid] = 1500;
          aiPathMap.delete(eid); // Clear path when switching to attack
          AIState.currentPathIndex[eid] = -1;
          if (body) body.setVelocity(0, 0); // Stop moving
        } else if (distSq > perceptionRadiusSq * 1.5) {
          console.log(`AI[${eid}]: Player lost. Switching to Idle.`);
          nextState = EnemyAIState.Idle;
          AIState.targetEid[eid] = 0;
          aiPathMap.delete(eid);
          AIState.currentPathIndex[eid] = -1;
          if (body) body.setVelocity(0, 0);
        } else {
          // --- Pathfinding Chase Behavior ---
          const currentPath = aiPathMap.get(eid);
          const isCalculating = AIState.isCalculatingPath[eid] === 1;

          // -- Request Path if Needed --
          const aiTilePos = worldToTile(aiWorldX, aiWorldY);
          const playerTilePos = worldToTile(playerWorldX, playerWorldY);

          let needsNewPath = false;
          if (aiTilePos && playerTilePos) {
            if (
              playerTilePos.x !== AIState.lastTargetTileX[eid] ||
              playerTilePos.y !== AIState.lastTargetTileY[eid]
            ) {
              needsNewPath = true;
            }
          }
          // Also needs path if currentPath is missing/empty and not calculating
          if (!currentPath && !isCalculating) needsNewPath = true;

          if (needsNewPath && !isCalculating && aiTilePos && playerTilePos) {
            console.log(
              `AI[${eid}]: Requesting path from (${aiTilePos.x},${aiTilePos.y}) to (${playerTilePos.x},${playerTilePos.y})`
            );
            AIState.isCalculatingPath[eid] = 1;
            AIState.lastTargetTileX[eid] = playerTilePos.x; // Store target tile
            AIState.lastTargetTileY[eid] = playerTilePos.y;
            aiPathMap.delete(eid); // Clear old path before requesting new one
            AIState.currentPathIndex[eid] = -1;

            easystar.findPath(
              aiTilePos.x,
              aiTilePos.y,
              playerTilePos.x,
              playerTilePos.y,
              (path) => {
                // Check if the entity still exists and needs this path
                if (!hasComponent(world, AIState, eid)) return; // Entity might be gone

                if (path === null) {
                  console.warn(`AI[${eid}]: Path not found!`);
                  // Decide action: Go idle? Try again?
                  AIState.currentState[eid] = EnemyAIState.Idle; // Go idle if stuck
                } else {
                  console.log(`AI[${eid}]: Path found (${path.length} nodes).`);
                  if (path.length > 1) {
                    path.shift(); // Remove the first node (current position)
                    aiPathMap.set(eid, path);
                    AIState.currentPathIndex[eid] = 0; // Start following
                  } else {
                    AIState.currentPathIndex[eid] = -1; // Path too short or already there
                  }
                }
                AIState.isCalculatingPath[eid] = 0; // Calculation finished (success or fail)
              }
            );
            // Calculation is triggered in GameScene.update

            // Stop current movement while calculating? Optional.
            if (body) body.setVelocity(0, 0);
          } else if (
            currentPath &&
            AIState.currentPathIndex[eid] !== -1 &&
            !isCalculating
          ) {
            // --- Follow Path ---
            const pathIndex = AIState.currentPathIndex[eid];
            if (pathIndex < currentPath.length) {
              const targetNode = currentPath[pathIndex];
              const targetWorldPos = tileToWorldCenter(
                targetNode.x,
                targetNode.y
              );

              if (targetWorldPos && body) {
                const chaseSpeed = 100; // Move to config/component
                scene.physics.moveTo(
                  body.gameObject,
                  targetWorldPos.x,
                  targetWorldPos.y,
                  chaseSpeed
                );

                // Update rotation to face next node (approx)
                const angleToNode = Phaser.Math.Angle.Between(
                  aiWorldX,
                  aiWorldY,
                  targetWorldPos.x,
                  targetWorldPos.y
                );
                Rotation.angle[eid] = Phaser.Math.RadToDeg(angleToNode);
                // Basic flipping
                if (targetWorldPos.x < aiWorldX) Rotation.angle[eid] = 180;
                else Rotation.angle[eid] = 0;

                // Check if close enough to the current target node
                const distToNodeSq = Phaser.Math.Distance.Squared(
                  aiWorldX,
                  aiWorldY,
                  targetWorldPos.x,
                  targetWorldPos.y
                );
                const closeEnoughThresholdSq =
                  map.tileWidth * 0.5 * (map.tileHeight * 0.5); // Approx half tile dist sq
                if (distToNodeSq < closeEnoughThresholdSq) {
                  AIState.currentPathIndex[eid]++; // Move to next node
                  //  console.log(`AI[${eid}]: Reached node ${pathIndex}, moving to ${pathIndex + 1}`);
                  if (AIState.currentPathIndex[eid] >= currentPath.length) {
                    // Reached end of path
                    console.log(`AI[${eid}]: Reached end of path.`);
                    aiPathMap.delete(eid);
                    AIState.currentPathIndex[eid] = -1;
                    // Force recalculation next frame if still chasing
                    AIState.lastTargetTileX[eid] = -1;
                    AIState.lastTargetTileY[eid] = -1;
                  }
                }
              } else {
                // Invalid target world pos, maybe clear path?
                aiPathMap.delete(eid);
                AIState.currentPathIndex[eid] = -1;
              }
            } else {
              // Path index out of bounds, should have been cleared above
              aiPathMap.delete(eid);
              AIState.currentPathIndex[eid] = -1;
            }
          } else if (!isCalculating) {
            // Not calculating, no path, and not needing a new one yet - likely waiting for player tile to change
            if (body) body.setVelocity(0, 0); // Stop moving
          }
        }
        break;

      case EnemyAIState.Attacking:
        // (Existing attack logic - unchanged for now)
        // ... Attack transitions and behavior ...
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

  // --- Cleanup for removed AI entities ---
  const exitedAI = exitQuery(aiQuery)(world); // Use existing query or create specific exit query
  for (const eid of exitedAI) {
    aiPathMap.delete(eid); // Remove path data when AI entity is removed 
    console.log(`AI[${eid}]: Entity removed, cleaning up path data.`);
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
  const keyQ = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
  const keyE = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.E);
  const keyP = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.P);

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
    InputState.toggleFlight[eid] = 0;
    InputState.blink[eid] = 0;

    if(Phaser.Input.Keyboard.JustDown(keyP!)){
      const progressAmount = 15; // Example fixed amount
      console.log(`DamageSystem: Granting ${progressAmount} Realm Progress for killing Enemy ${eid}`);
      usePlayerStore.getState().addRealmProgress(progressAmount);
    }
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

    if (Phaser.Input.Keyboard.JustDown(keyQ!)) {
      // <-- CHECK FLIGHT KEY
      InputState.toggleFlight[eid] = 1;
      console.log("Input: Toggle Flight Key Pressed");
    }
    if (Phaser.Input.Keyboard.JustDown(keyE!)) {
      InputState.blink[eid] = 1;
      console.log("Input: Blink Key Pressed");
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
    Cooldown.blinkMs[eid] = Math.max(0, Cooldown.blinkMs[eid] - deltaMs); // <-- DECREMENT BLINK COOLDOWN
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
              PhysicsBody.height[hitboxEid] = Hitbox.height[hitboxEid];
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

// --- Conceptual calculateDamage Function (Helper for damageSystem) ---
function calculateDamage(
  attackerEid: number,
  defenderEid: number,
  baseDamage: number,
  isTechnique: boolean, // Flag if damage is from a technique
  techniqueDaoType: DaoType | null, // Optional: Dao type of the technique used
  world: InWorld
): number {
  let finalDamage = baseDamage;
  let mitigation = 0;
  const attackerIsPlayer = hasComponent(world, PlayerControlled, attackerEid);
  const defenderIsPlayer = hasComponent(world, PlayerControlled, defenderEid);
  const playerState = usePlayerStore.getState(); // Get latest player state

  // 1. Defender Mitigation (Resilience)
  if (defenderIsPlayer) {
      const resilienceLevel = playerState.soulAspects.resilience;
      const resilienceDefenseFactor = 0.05; // Example: 5% reduction per point
      mitigation += resilienceLevel * resilienceDefenseFactor;
  } else {
      // TODO: Get enemy base defense/resilience
  }
  // Apply Dao specific defense? e.g., Earth Dao reduces physical damage taken?

  // 2. Attacker Bonuses
  if (attackerIsPlayer) {
      // Affinity (for techniques)
      if (isTechnique) {
          const affinityLevel = playerState.soulAspects.affinity;
          const affinityPowerFactor = 1.0 + (affinityLevel * 0.08); // Example: +8% technique power
          finalDamage *= affinityPowerFactor;
      }

      // Dao Bonuses (e.g., Sword Dao for basic/sword attacks)
      const swordComprehension = playerState.daoProgress.comprehension.get(DaoType.Sword) || 0;
      // Need to know if attack was physical/sword type
      // Assuming for now basic attacks benefit:
      if (!isTechnique) { // Apply to basic attacks?
           finalDamage *= (1.0 + swordComprehension * DAO_PASSIVE_FACTORS.SWORD_DAMAGE_PER_LEVEL);
      } else if (techniqueDaoType === DaoType.Sword) { // Apply to Sword techniques
           finalDamage *= (1.0 + swordComprehension * DAO_PASSIVE_FACTORS.SWORD_DAMAGE_PER_LEVEL);
      }
      // Add checks for other Daos affecting damage (e.g., Fire Dao adding burn is separate, in status effect logic)

      // Crits (Perception)
      const perceptionLevel = playerState.soulAspects.perception;
      const critChanceFactor = 0.02;
      const critDamageFactor = 0.1;
      const critChance = perceptionLevel * critChanceFactor;
      if (Math.random() < critChance) {
           const critMultiplier = 1.5 + (perceptionLevel * critDamageFactor);
           finalDamage *= critMultiplier;
           console.log("Player CRITICAL HIT!");
           // TODO: Add visual effect trigger
      }

  } else {
      // TODO: Get enemy attacker bonuses (base stats, maybe simplified Dao effects)
  }

  // 3. Apply Mitigation
  mitigation = Math.min(0.95, Math.max(0, mitigation)); // Cap mitigation
  finalDamage *= (1.0 - mitigation);

  // 4. Final Clamping
  return Math.max(1, Math.round(finalDamage));
}

// --- NEW: Damage System (Applies damage from TakeDamage component) ---
export function damageSystem(world: InWorld) {
  const entities = damageQuery(world);
  const playerEntities = playerQuery(world); // Need this to find the player EID easily
  const playerEid = playerEntities.length > 0 ? playerEntities[0] : -1;

  const STAGGER_DURATION_MS = 250; // Duration of stagger effect (tune later)
  const MIN_DAMAGE_TO_STAGGER = 5; // Only stagger if damage is significant (tune later)


  for (const eid of entities) {
    if (
      !hasComponent(world, Health, eid) ||
      !hasComponent(world, TakeDamage, eid)
    ) {
      if (hasComponent(world, TakeDamage, eid)) removeComponent(world, TakeDamage, eid);
      continue;
    }

    const damageAmount = TakeDamage.amount[eid];
    const sourceEid = TakeDamage.sourceEid[eid];
    // TODO: Determine if damage was from a technique and its Dao type
    const isFromTechnique = false; // Placeholder
    const techniqueDao = null;     // Placeholder

    // Calculate final damage using the helper
    const finalDamage = calculateDamage(sourceEid, eid, damageAmount, isFromTechnique, techniqueDao, world);

    Health.current[eid] = Math.max(0, Health.current[eid] - finalDamage)

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

    if (Health.current[eid] === 0 && hasComponent(world, Enemy, eid) && sourceEid === playerEid) {
      const progressAmount = 15; // Example fixed amount
      console.log(`DamageSystem: Granting ${progressAmount} Realm Progress for killing Enemy ${eid}`);
      usePlayerStore.getState().addRealmProgress(progressAmount);
      // Potentially discover/gain comprehension for specific enemy types
      // Example: if (Enemy.archetypeId[eid] === FIRE_SLIME_ID) { discoverDao(DaoType.Fire); }
  }

    // Remove TakeDamage component after processing
    removeComponent(world, TakeDamage, eid);
  }
}

// --- Movement System (Basic Ground - TDD 3.2.4, 6.1) ---
export function movementSystem(world: InWorld) {
  const { delta, collisionLayer } = world.resources;
  const speed = 200; // Base speed, move to config/component later
  const sprintMultiplier = 1.5; // Example sprint speed increase
  const DODGE_SPEED_BURST = 450; // Faster than sprint
  const playerState = usePlayerStore.getState(); // Get state for Dao checks


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
    QiPool,
  ])(world);

  for (const eid of movingEntities) {
    const bodyId = PhysicsBody.bodyId[eid];
    const body = getPhysicsBody(bodyId);
    if (!body) continue;

    const inputX = InputState.moveX[eid];
    const inputY = InputState.moveY[eid];
    const isSprinting = InputState.sprint[eid] === 1;
    const toggleFlightInput = InputState.toggleFlight[eid] === 1;
    const blinkInput = InputState.blink[eid] === 1; // <-- GET BLINK INPUT
    const canMoveStandard = CombatState.canMove[eid] === 1; // Standard movement allowed flag
    const isDodging = CombatState.isDodging[eid] === 1; // Check dodge state
    let isFlying = MovementState.isFlying[eid] === 1;
    const blinkOnCooldown = Cooldown.blinkMs[eid] > 0;
    let blinkCost = BLINK_STAMINA_COST;
    let blinkCooldown = BLINK_COOLDOWN_MS;

    const spaceComprehension = playerState.daoProgress.comprehension.get(DaoType.Space) || 0;
    blinkCost *= (1.0 - spaceComprehension * DAO_PASSIVE_FACTORS.SPACE_BLINK_COST_REDUCTION_PER_LEVEL);
    blinkCooldown *= (1.0 - spaceComprehension * 0.005); // Example: 0.5% cooldown reduction per point
    blinkCost = Math.max(5, Math.round(blinkCost)); // Minimum cost
    blinkCooldown = Math.max(200, blinkCooldown); // Minimum cooldown

    // Add this log:
    if (inputX !== 0 || inputY !== 0) {
      console.log(
        `MovementSystem[${eid}]: Input=(${inputX},${inputY}), CanMove=${canMoveStandard}, Body=${
          body ? "Exists" : "MISSING!"
        }`
      );
    }

    if (
      blinkInput &&
      canMoveStandard &&
      !blinkOnCooldown &&
      !isFlying /* Optional: disable blink while flying? */
    ) {
      const currentStamina = StaminaPool.current[eid];
      if (currentStamina >= blinkCost) {
        // Determine Blink Direction
        let blinkDirX = inputX;
        let blinkDirY = inputY;
        if (blinkDirX === 0 && blinkDirY === 0) {
          // If no input, use facing direction
          blinkDirX = Rotation.angle[eid] === 180 ? -1 : 1;
          blinkDirY = 0;
        }
        // Normalize direction
        const len = Math.sqrt(blinkDirX * blinkDirX + blinkDirY * blinkDirY);
        if (len > 0) {
          blinkDirX /= len;
          blinkDirY /= len;
        }

        // Calculate Target Position
        const currentX = Position.x[eid] + PhysicsBody.width[eid] / 2; // Approx center X
        const currentY = Position.y[eid] + PhysicsBody.height[eid] / 2; // Approx center Y
        const targetX = currentX + blinkDirX * BLINK_DISTANCE;
        const targetY = currentY + blinkDirY * BLINK_DISTANCE;

        // --- Collision Check (Option B: Tile Check) ---
        let canBlink = true;
        if (collisionLayer) {
          // Check the tile at the target center point
          const targetTile = collisionLayer.getTileAtWorldXY(
            targetX,
            targetY,
            true
          ); // Use non-dynamic layer
          if (targetTile && targetTile.collides) {
            // Check the 'collides' property we set earlier
            canBlink = false;
            console.log(
              `MovementSystem[${eid}]: Blink blocked by tile at (${targetX.toFixed(
                0
              )}, ${targetY.toFixed(0)})`
            );
          }
          // OPTIONAL: Add more checks (e.g., check corners of player bounds at target location)
        } else {
          console.warn(
            "MovementSystem: Collision Layer not available for blink check."
          );
          // Decide behavior: allow blink without check, or disallow? Let's allow for now.
        }

        if (canBlink) {
          console.log(
            `MovementSystem[${eid}]: Blinking to (${targetX.toFixed(
              0
            )}, ${targetY.toFixed(0)})`
          );
          // Consume Stamina
          StaminaPool.current[eid] = currentStamina - blinkCost;
          usePlayerStore.getState().consumeStamina(blinkCost);

          // Set Cooldown
          Cooldown.blinkMs[eid] = blinkCooldown;

          // --- Perform Blink ---
          // Use body.reset to instantly move physics body AND sprite placeholder
          const resetX = targetX - PhysicsBody.width[eid] / 2; // Adjust back to top-left for reset
          const resetY = targetY - PhysicsBody.height[eid] / 2;
          body.reset(resetX, resetY);

          // Update ECS position immediately as well
          Position.x[eid] = resetX;
          Position.y[eid] = resetY;

          // Stop current movement from input
          body.setVelocity(0, 0);

          // TODO: Trigger visual/audio effects here
          // world.resources.scene.events.emit('playerBlinked', eid, targetX, targetY);

          // Reset input flag (important!)
          InputState.blink[eid] = 0;
          continue; // Skip the rest of the movement logic for this frame
        } else {
          // TODO: Add feedback if blink failed (sound?)
        }
      } else {
        // Not enough stamina feedback?
      }
    } // End Blink Logic

    if (toggleFlightInput && canMoveStandard) {
      // Can only toggle flight if not staggered/attacking etc.
      const currentRealm = usePlayerStore.getState().realm;
      const canFly = currentRealm >= FLIGHT_UNLOCK_REALM; // Check progression gate

      if (isFlying) {
        // Deactivate flight
        console.log(`MovementSystem[${eid}]: Deactivating Flight.`);
        isFlying = false;
      } else if (canFly && QiPool.current[eid] > 0) {
        // Only activate if allowed and has some Qi
        // Activate flight
        console.log(`MovementSystem[${eid}]: Activating Flight.`);
        isFlying = true;
        // Optional: Consume initial burst of Qi?
        // Optional: Interrupt ground actions like running?
        MovementState.isRunning[eid] = 0;
        MovementState.isIdle[eid] = 0;
      } else if (!canFly) {
        console.log(
          `MovementSystem[${eid}]: Cannot fly, Realm not high enough.`
        );
        // TODO: Add user feedback (sound effect, message?)
      } else {
        console.log(`MovementSystem[${eid}]: Cannot fly, no Qi.`);
        // TODO: Add user feedback
      }
      MovementState.isFlying[eid] = isFlying ? 1 : 0; // Update component state
    }

    // --- Flight Qi Consumption & Auto-Deactivation ---
    if (isFlying) {
      const qiCost = FLIGHT_QI_COST_PER_SEC * delta;
      const currentQi = QiPool.current[eid];

      if (currentQi >= qiCost) {
        const newQi = currentQi - qiCost;
        QiPool.current[eid] = newQi;
        // Dispatch update to Zustand store
        usePlayerStore.getState().setCoreStats({
          qi: { current: newQi, max: QiPool.max[eid] },
        });
      } else {
        // Not enough Qi, disable flight
        console.log(`MovementSystem[${eid}]: Ran out of Qi, disabling flight.`);
        QiPool.current[eid] = 0; // Set to 0
        usePlayerStore.getState().setCoreStats({
          qi: { current: 0, max: QiPool.max[eid] },
        });
        isFlying = false;
        MovementState.isFlying[eid] = 0;
      }
    }

    let targetVelocityX = 0;
    let targetVelocityY = 0;

    if (isFlying) {
      // --- Flying Physics ---
      body.setAllowGravity(false); // Disable Phaser's gravity
      // Direct velocity control for flight
      targetVelocityX = inputX * FLIGHT_SPEED;
      targetVelocityY = inputY * FLIGHT_SPEED; // Use Y input for vertical flight

      // Reset ground-specific states
      MovementState.isRunning[eid] = 0;
      MovementState.isIdle[eid] = 0;

      // Set Rotation (Optional: maybe flying sprite doesn't rotate?)
      if (inputX !== 0) Rotation.angle[eid] = inputX < 0 ? 180 : 0;
    } else {
      // --- Ground Physics (or falling) ---
      body.setAllowGravity(true); // Re-enable Phaser's gravity (if world has gravity > 0)
      MovementState.isFlying[eid] = 0; // Ensure flying state is off if not flying

      if (isDodging) {
        // --- Dodge Movement (Ground) ---
        MovementState.isRunning[eid] = 0;
        MovementState.isIdle[eid] = 0;
        // ... (existing dodge velocity logic) ...
        let dodgeDirX = inputX;
        let dodgeDirY = inputY;
        if (dodgeDirX === 0 && dodgeDirY === 0) {
          const angleRad = Phaser.Math.DegToRad(Rotation.angle[eid]);
          dodgeDirX = Rotation.angle[eid] === 180 ? -1 : 1;
          dodgeDirY = 0;
        }
        const len = Math.sqrt(dodgeDirX * dodgeDirX + dodgeDirY * dodgeDirY);
        if (len > 0) {
          dodgeDirX /= len;
          dodgeDirY /= len;
        } else {
          dodgeDirX = Rotation.angle[eid] === 180 ? -1 : 1;
        }
        targetVelocityX = dodgeDirX * DODGE_SPEED_BURST;
        targetVelocityY = dodgeDirY * DODGE_SPEED_BURST; // Ground dodge likely horizontal only? Or allow diagonal?
      } else if (canMoveStandard) {
        // --- Standard Ground Movement & Sprinting ---
        let currentSpeed = speed;
        if (isSprinting && StaminaPool.current[eid] > 0) {
          currentSpeed = speed * sprintMultiplier;
          // TODO: Add stamina cost for sprinting here or in resource system
        }
        targetVelocityX = inputX * currentSpeed;
        targetVelocityY = 0; // No vertical movement from input on ground (gravity handles Y)

        // Update MovementState for ground animation
        if (Math.abs(targetVelocityX) > 0) {
          MovementState.isRunning[eid] = 1;
          MovementState.isIdle[eid] = 0;
        } else {
          MovementState.isRunning[eid] = 0;
          MovementState.isIdle[eid] = 1;
        }
        // Update Rotation based on horizontal movement input
        if (inputX !== 0) Rotation.angle[eid] = inputX < 0 ? 180 : 0;
      } else {
        // --- Movement Blocked (Attacking, Staggered on Ground) ---
        MovementState.isRunning[eid] = 0;
        MovementState.isIdle[eid] = 0; // Allow attack/stagger animations
        targetVelocityX = 0;
        // Keep existing Y velocity (gravity will apply)
        targetVelocityY = body.velocity.y; // Don't zero out Y velocity if blocked horizontally
      }
      // For ground movement, let gravity control Y unless explicitly jumping/falling logic is added
      // If your game has Y gravity, targetVelocityY might be overridden by physics unless jumping.
      // Since default gravity is 0,0, setting targetVelocityY = 0 for ground movement is okay.
    }

    // Set final velocity on the Phaser body
    body.setVelocityX(targetVelocityX);
    body.setVelocityY(targetVelocityY); // Apply calculated Y velocity (for flight or ground)

    InputState.toggleFlight[eid] = 0;
    InputState.blink[eid] = 0;
  }

  const projectileEntities = velocityMovementQuery(world);
  for (const eid of projectileEntities) {
    if (hasComponent(world, PlayerControlled, eid)) continue;
    if (hasComponent(world, Enemy, eid)) continue;

    // Get body - should exist if physicsSystem ran
    const bodyId = PhysicsBody.bodyId[eid];
    const body = getPhysicsBody(bodyId) as Phaser.Physics.Arcade.Body;
    console.log("Projectile:", body.enable);
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
    const flyAnimKey = "player_fly";
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
    } else if (MovementState.isFlying[eid]) {
      targetAnimKey = flyAnimKey;
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
          CombatState.isAttackingHeavy[eid] ||
          MovementState.isFlying[eid]
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
        const shouldMove =
          hasComponent(world, Velocity, eid) &&
          (Velocity.vx[eid] !== 0 || Velocity.vy[eid] !== 0);
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

  if (
    hitboxEid === undefined ||
    targetEid === undefined ||
    hitboxEid === targetEid
  )
    return;

  const hitboxStartTime = Hitbox.startTimeMs[hitboxEid];
  const hitboxDuration = Hitbox.durationMs[hitboxEid];
  const currentTime = world.resources.time; // Get current time
  const isHitboxActive =
    currentTime >= hitboxStartTime &&
    currentTime < hitboxStartTime + hitboxDuration;

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
    easyStar?: EasyStar.js;
  }
}
