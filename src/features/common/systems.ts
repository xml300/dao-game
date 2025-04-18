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
} from "./components";
import { Health, QiPool, StaminaPool } from "./components";
import { usePlayerStore } from "@/state/player.store";
import { InWorld } from "@/types";
import * as AssetKeys from "@/constants/assets"; // Import constants

// --- System Inputs/Resources ---
// Define interfaces for resources systems need, like Phaser scene or input manager
export interface SystemResources {
  time: number;
  delta: number;
  scene: Phaser.Scene; // For accessing input, physics, rendering
}

// --- Queries ---
const playerInputQuery = defineQuery([
  PlayerControlled,
  InputState,
  Velocity,
  PhysicsBody,
  MovementState,
]);
const movementQuery = defineQuery([
  Position,
  Velocity,
  PhysicsBody,
  MovementState,
]);
const physicsQuery = defineQuery([Position, PhysicsBody]); // Query for position sync
const combatStateQuery = defineQuery([CombatState]); // Can be useful
const renderableQuery = defineQuery([Position, Rotation, Renderable]);
const newRenderableQuery = enterQuery(renderableQuery); // Entities newly matching renderableQuery
const exitedRenderableQuery = exitQuery(renderableQuery); // Entities no longer matching
const playerCombatQuery = defineQuery([
  PlayerControlled,
  InputState,
  CombatState,
  Cooldown,
  Velocity,
  PhysicsBody,
  Health,
]);
// const combatStateQuery = defineQuery([CombatState]);
const hitboxQuery = defineQuery([Hitbox, Position, PhysicsBody]); // Hitboxes have physics bodies
const enemyQuery = defineQuery([
  Enemy,
  Health,
  Position,
  PhysicsBody,
  CombatState,
]); // Enemies can take damage and have state
const damageQuery = defineQuery([TakeDamage, Health]); // Entities that should take damage

// Sprite management within the RenderSystem
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

// --- Input System (TDD 3.2) ---
export function inputSystem(world: InWorld) { 
  const { scene } = world.resources;
  const cursors = scene.input.keyboard?.createCursorKeys();
  const keySpace = scene.input.keyboard?.addKey(
    Phaser.Input.Keyboard.KeyCodes.SPACE
  ); // Example specific key

  const entities = playerInputQuery(world); // Use existing query, ensure it includes CombatState or add it

  for (const eid of entities) {
    // Reset flags/axes
    InputState.moveX[eid] = 0;
    InputState.moveY[eid] = 0;
    InputState.attackLight[eid] = 0;
    InputState.dodge[eid] = 0;
    InputState.sprint[eid] = 0;
    // ... reset others
    InputState.attackLight[eid] = 0; // Reset attack flags each frame

    if (Phaser.Input.Keyboard.JustDown(keySpace!)) {
      // Use JustDown for single trigger
      InputState.attackLight[eid] = 1;
    }

    // Read Keyboard Input (Example)
    if (cursors?.left.isDown) InputState.moveX[eid] = -1;
    else if (cursors?.right.isDown) InputState.moveX[eid] = 1;

    if (cursors?.up.isDown) InputState.moveY[eid] = -1;
    else if (cursors?.down.isDown) InputState.moveY[eid] = 1;

    if (cursors?.space.isDown) InputState.attackLight[eid] = 1; // Example mapping
    if (cursors?.shift.isDown) InputState.sprint[eid] = 1; // Example mapping
    // Add more key checks (A, S, D, W, custom keys) for actions based on TDD 3.2.2 mapping

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
  const playerEntities = playerCombatQuery(world); // Query entities that can perform combat actions

  for (const eid of playerEntities) {
    CombatState.canMove[eid] = 1; // Allow movement

    const canAct =
      !CombatState.isStaggered[eid] &&
      !CombatState.isParrying[eid]; /* && !CombatState.isCasting[eid] */ // Basic action gating
    const attackInput = InputState.attackLight[eid] === 1;
    const isOnCooldown = Cooldown.attackLightMs[eid] > 0;

    // --- Process Timers ---
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

    // Reset states based on timers ending
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

    // Reset attack state if window closes (simplistic, combo logic needed later TDD 4.2.3)
    if (
      CombatState.isAttackingLight[eid] &&
      CombatState.attackWindowMs[eid] === 0
    ) {
      CombatState.isAttackingLight[eid] = 0;
      CombatState.attackSequence[eid] = 0;
      CombatState.canAttack[eid] = 1; // Allow next attack
      CombatState.canMove[eid] = 1; // Allow movement
    }

    // --- Initiate Light Attack (TDD 4.2.1) ---
    if (canAct && attackInput && !isOnCooldown && CombatState.canAttack[eid]) {
      console.log(`CombatSystem: Entity ${eid} initiating Light Attack`);
      CombatState.isAttackingLight[eid] = 1;
      CombatState.attackSequence[eid] = 1; // Start sequence
      CombatState.attackWindowMs[eid] = 500; // Example duration for the attack animation/hitbox activation
      CombatState.canAttack[eid] = 0; // Prevent spamming during this attack
      CombatState.canMove[eid] = 1; // Prevent movement during attack (configurable later)
      Cooldown.attackLightMs[eid] = 600; // Set cooldown (example value)

      // Reset velocity to prevent sliding attack (optional)
      const bodyId = PhysicsBody.bodyId[eid];
      const body = getPhysicsBody(bodyId) as Phaser.Physics.Arcade.Body;
      if (body) {
        body.setVelocity(0, 0);
      }

      // --- Spawn Hitbox (handled by animation events or hitboxSystem based on state) ---
      // For simplicity now, let's trigger hitbox creation here, timed relative to attack start
      // More robust: Use animation events (TDD 4.6.4) or check state in hitboxSystem
      const hitboxDuration = 200; // ms - How long the hitbox stays active
      const hitboxDelay = 100; // ms - Delay after attack starts before hitbox appears

      // Use a timer or flag for the hitboxSystem to pick up
      // Or directly add a "PendingHitbox" component? Let's try adding Hitbox component directly with a start time.
      const hitboxEid = addEntity(world);
      addComponent(world, Hitbox, hitboxEid);
      addComponent(world, Position, hitboxEid); // Position will be updated relative to owner
      addComponent(world, PhysicsBody, hitboxEid); // Hitbox needs physics body for overlap checks

      Hitbox.ownerEid[hitboxEid] = eid;
      Hitbox.offsetX[hitboxEid] = Rotation.angle[eid] === 180 ? -40 : 40; // Offset based on facing direction
      Hitbox.offsetY[hitboxEid] = 0; // Example offset
      Hitbox.width[hitboxEid] = 50; // Example size
      Hitbox.height[hitboxEid] = 40;
      Hitbox.durationMs[hitboxEid] = hitboxDuration;
      Hitbox.startTimeMs[hitboxEid] = time + hitboxDelay; // Activate after delay
      Hitbox.maxHits[hitboxEid] = 1; // Single target hit for basic attack
      Hitbox.filter[hitboxEid] = 0; // 0 = Player attack, hits enemies

      // PhysicsBody for hitbox (will be created by physicsSystem)
      PhysicsBody.bodyId[hitboxEid] = 0;
      PhysicsBody.width[hitboxEid] = Hitbox.width[hitboxEid];
      PhysicsBody.height[hitboxEid] = Hitbox.height[hitboxEid];
      PhysicsBody.offsetX[hitboxEid] = 0; // Body offset relative to hitbox center
      PhysicsBody.offsetY[hitboxEid] = 0;
      PhysicsBody.collides[hitboxEid] = 0; // Hitbox shouldn't collide, only overlap

      hitboxHitRegistry.delete(hitboxEid);

      console.log(
        `CombatSystem: Created hitbox entity ${hitboxEid} for owner ${eid}`
      );
    }
    // TODO: Implement Heavy Attack, Dodge, Parry initiation
  }
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
        body.enable = isActive; // Enable/disable physics body based on timing
        // Update position AFTER enabling/disabling? Phaser might reset pos on enable.
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
  const playerEntities = playerCombatQuery(world); // Need this to find the player EID easily

  let playerEid = -1;
  if (playerEntities.length > 0) {
    playerEid = playerEntities[0]; // Assuming single player
  }

  for (const eid of entities) {
    const damageAmount = TakeDamage.amount[eid];
    Health.current[eid] = Math.max(0, Health.current[eid] - damageAmount);

    console.log(
      `DamageSystem: Entity ${eid} took ${damageAmount} damage. New health: ${Health.current[eid]}/${Health.max[eid]}`
    );

    // Check for death
    if (Health.current[eid] === 0) {
      // TODO: Add Dead component/state flag
      console.log(`DamageSystem: Entity ${eid} died.`);
      // Trigger death animation/logic
    } else {
      // TODO: Trigger Hurt animation/state (e.g., set CombatState.isStaggered)
    }

    // If the damaged entity is the player, dispatch update to Zustand store
    if (eid === playerEid) {
      usePlayerStore.getState().takeDamage(damageAmount);
      console.log(`DamageSystem: Dispatched player damage to Zustand store.`);
    }

    // Remove TakeDamage component after processing
    removeComponent(world, TakeDamage, eid);
  }
}

// --- Movement System (Basic Ground - TDD 3.2.4, 6.1) ---
export function movementSystem(world: InWorld) {
  //resources: SystemResources) {
  // const { delta } = world.resources;
  const speed = 200; // Base speed, move to config/component later
  const sprintMultiplier = 1.5; // Example sprint speed increase

  // --- Sync Physics Body Position back to ECS Position ---
  // Necessary because Arcade Physics updates the body directly
  const movingEntities = defineQuery([
    PlayerControlled,
    InputState,
    Velocity,
    PhysicsBody,
    MovementState,
    CombatState, // Needed to check 'canMove'
    StaminaPool, // Needed for sprinting cost
  ])(world);
  for (const eid of movingEntities) {
    console.log(eid);
    const bodyId = PhysicsBody.bodyId[eid];
    const body = getPhysicsBody(bodyId) as Phaser.Physics.Arcade.Body;
    if (!body) continue;

    const inputX = InputState.moveX[eid];
    const inputY = InputState.moveY[eid];
    const isSprinting = InputState.sprint[eid] === 1;
    const canMove = CombatState.canMove[eid] === 1;
    console.log(InputState.moveX);

    // Add this log:
if (inputX !== 0 || inputY !== 0) {
  console.log(`MovementSystem[${eid}]: Input=(${inputX},${inputY}), CanMove=${canMove}, Body=${body ? 'Exists' : 'MISSING!'}`);
}

    let targetVelocityX = 0;
    let targetVelocityY = 0;
    let isActuallySprinting = false;

    if (canMove) {
      let currentSpeed = speed;
      // Check stamina for sprint (TDD 4.2.1) - Basic check
      if (isSprinting && StaminaPool.current[eid] > 0) {
        currentSpeed = speed * sprintMultiplier;
        isActuallySprinting = true;
        // TODO: Dispatch stamina consumption action to Zustand or update component directly
        // StaminaPool.current[eid] -= STAMINA_COST_PER_FRAME; // Requires delta time if done here
      }

      targetVelocityX = inputX * currentSpeed;
      targetVelocityY = inputY * currentSpeed;

      // --- Update MovementState (for animation) ---
      if (Math.abs(targetVelocityX) > 0 || Math.abs(targetVelocityY) > 0) {
        MovementState.isRunning[eid] = 1;
        MovementState.isIdle[eid] = 0;
        // TODO: Add isSprinting state if needed for animations
      } else {
        MovementState.isRunning[eid] = 0;
        MovementState.isIdle[eid] = 1;
      }

      // --- Update Rotation ---
      if (inputX < 0) Rotation.angle[eid] = 180;
      else if (inputX > 0) Rotation.angle[eid] = 0;
    } else {
      // If movement is blocked (e.g., attacking), ensure movement state reflects not moving
      MovementState.isRunning[eid] = 0;
      MovementState.isIdle[eid] = 0; // Allow attack/other animations to take priority
    }

    if (targetVelocityX !== 0 || targetVelocityY !== 0 || (inputX !==0 || inputY !==0)) { // Log even if target is 0 but input wasn't
      console.log(`MovementSystem[${eid}]: Setting Body Velocity=(${targetVelocityX}, ${targetVelocityY})`);
  }

    // Set velocity on the actual Phaser body
    body.setVelocityX(targetVelocityX);
    body.setVelocityY(targetVelocityY);

    // TODO: Implement stamina consumption logic (maybe in a separate resourceSystem?)
    // if (isActuallySprinting) { usePlayerStore.getState().consumeStamina(STAMINA_COST); }
  }
}

// --- Render System (TDD 2.5 Bridge, 4.6) ---
export function renderSystem(world: InWorld) {
  const { scene } = world.resources;

  // Handle newly added renderable entities
  const entered = newRenderableQuery(world);
  for (const eid of entered) {
    const spriteKeyId = Renderable.spriteKey[eid];
    const spriteKey = getSpriteKeyById(spriteKeyId);
    const initialAnimId = Renderable.animationKey[eid]; // Should be set when adding component
    const initialAnimKey = getAnimationKeyById(initialAnimId);

    if (spriteKey && !spriteMap.has(eid)) {
      const x = Position.x[eid];
      const y = Position.y[eid];
      const newSprite = scene.add.sprite(x, y, spriteKey);
      newSprite.setDepth(Renderable.depth[eid] ?? 0);
      newSprite.setAngle(Rotation.angle[eid] ?? 0);
      newSprite.setTint(Renderable.tint[eid] ?? 0xffffff);
      newSprite.setVisible(Renderable.visible[eid] === 1);

      if (initialAnimKey) {
        newSprite.play(initialAnimKey, true); // Start default animation
      }

      spriteMap.set(eid, newSprite);
      console.log(
        `RenderSystem: Created sprite for entity ${eid} with key ${spriteKey}`
      );
      scene.physics.world.enable(newSprite); // Enable physics here
    } else if (!spriteKey) {
      console.error(
        `RenderSystem: Cannot create sprite for entity ${eid}, invalid spriteKeyId ${spriteKeyId}`
      );
    }
  }

  // Update existing sprites
  const entities = renderableQuery(world);
  for (const eid of entities) {
    const sprite = spriteMap.get(eid);
    if (!sprite) continue; // Should not happen if entered logic is correct

    sprite.x = Position.x[eid];
    sprite.y = Position.y[eid];
    sprite.setAngle(Rotation.angle[eid] ?? 0); // Update rotation
    sprite.setDepth(Renderable.depth[eid] ?? 0);
    sprite.setTint(Renderable.tint[eid] ?? 0xffffff);
    sprite.setVisible(Renderable.visible[eid] === 1);

    // TDD 4.6: Animation Control based on state
    const animKeyId = Renderable.animationKey[eid]; // Animation system should update this
    const targetAnimKey = getAnimationKeyById(animKeyId);

    if (targetAnimKey && sprite.anims.currentAnim?.key !== targetAnimKey) {
      sprite.play(targetAnimKey, true); // Play new animation, ignore if already playing
    }

    // Handle flipping based on Rotation or a dedicated flip component later
    if (Rotation.angle[eid] === 180) {
      // Basic flip example
      sprite.setFlipX(true);
    } else {
      sprite.setFlipX(false);
    }
  }

  // Handle removed renderable entities
  const exited = exitedRenderableQuery(world);
  for (const eid of exited) {
    const sprite = spriteMap.get(eid);
    if (sprite) {
      console.log(`RenderSystem: Destroying sprite for entity ${eid}`);
      sprite.destroy();
      spriteMap.delete(eid);
    }
    // Also ensure physics body is cleaned up if tied to this entity
    // (Could be handled by a dedicated PhysicsSync system or on entity deletion)
  }
}

// --- Animation System (TDD 4.6) ---
// Determines which animation should play based on MovementState
export function animationSystem(world: InWorld) {
  const entities = defineQuery([Renderable, MovementState, CombatState])(world); // Entities with state and visuals

  for (const eid of entities) {
    let targetAnimKeyId = Renderable.animationKey[eid]; // Keep current if no state matches

    // TODO: Get actual animation keys ('player_idle', 'player_run')
    const idleAnimId = getAnimationKeyId(AssetKeys.Anims.PLAYER_IDLE); // Replace with actual keys
    const runAnimId = getAnimationKeyId(AssetKeys.Anims.PLAYER_RUN); // Replace with actual keys
    const attackLight1AnimId = getAnimationKeyId(AssetKeys.Anims.PLAYER_ATTACK_LIGHT_1);

    // Logic based on MovementState flags (add more states later)
    if (CombatState.isAttackingLight[eid]) {
      // Check combat states first
      // TODO: Check CombatState.attackSequence for different combo animations
      targetAnimKeyId = attackLight1AnimId;
    } else if (MovementState.isRunning[eid]) {
      targetAnimKeyId = runAnimId;
    } else if (MovementState.isIdle[eid]) {
      targetAnimKeyId = idleAnimId;
    }
    // Add checks for Attack, Hurt, Fly, etc. later, considering priority

    // Update the Renderable component's animation key if it changed
    if (Renderable.animationKey[eid] !== targetAnimKeyId) {
      Renderable.animationKey[eid] = targetAnimKeyId;
    }
  }
}

// --- Physics Sync System (TDD 2.5 Bridge) ---
// Manages creation/deletion of Phaser physics bodies based on ECS components
export function physicsSystem(world: InWorld) {
  const { scene } = world.resources;
  const enteredPhysics = enterQuery(physicsQuery)(world);
  const exitedPhysics = exitQuery(physicsQuery)(world); // Entities losing physics requirement

  if (!(scene as any).playerColliderAdded) {
    (scene as any).playerColliderAdded = false;
  }

  for (const eid of enteredPhysics) {
    // Only process if the body hasn't been created yet
    if (PhysicsBody.bodyId[eid] === 0) {
      let targetGameObject:
        | Phaser.GameObjects.Sprite
        | Phaser.GameObjects.Image
        | null = null;
      let isSpriteRenderable = false;

      if (hasComponent(world, Renderable, eid)) {
        targetGameObject = spriteMap.get(eid) ?? null;
        isSpriteRenderable = true;
      }

      if (targetGameObject || hasComponent(world, Hitbox, eid)) {
        let bodyInstance: Phaser.Physics.Arcade.Body | null = null;

        if (targetGameObject) {
          scene.physics.world.enable(targetGameObject);
          bodyInstance = targetGameObject.body as Phaser.Physics.Arcade.Body;
          // Set data on the GO for easier lookup in callbacks
          targetGameObject.setData("eid", eid);
          console.log(
            `PhysicsSystem: Enabled physics on existing GO for EID ${eid}`
          );
        } else {
          // Hitbox without a sprite
          // Using a sensor body (no sprite needed) is more complex to manage.
          // Stick with invisible sprite workaround for now unless performance dictates otherwise.
          const x = Position.x[eid];
          const y = Position.y[eid];
          const hitboxSprite = scene.add
            .sprite(x, y, "")
            .setVisible(false)
            .setActive(false);
          hitboxSprite.setData("eid", eid); // Tag the temp sprite too
          scene.physics.world.enable(hitboxSprite);
          bodyInstance = hitboxSprite.body as Phaser.Physics.Arcade.Body;
          console.log(
            `PhysicsSystem: Created temp sprite & body for hitbox EID ${eid}`
          );
        }

        if (bodyInstance) {
          const bodyId = registerPhysicsBody(bodyInstance);
          PhysicsBody.bodyId[eid] = bodyId;

          // Configure body properties
          bodyInstance.setSize(PhysicsBody.width[eid], PhysicsBody.height[eid]);
          bodyInstance.setOffset(
            PhysicsBody.offsetX[eid],
            PhysicsBody.offsetY[eid]
          );
          bodyInstance.setCollideWorldBounds(PhysicsBody.collides[eid] === 1); // Use component flag
          bodyInstance.allowGravity = false; // Default for this game type
          bodyInstance.enable = !hasComponent(world, Hitbox, eid); // Enable immediately unless it's a hitbox

          // --- Overlap Setup ---
          if (hasComponent(world, Hitbox, eid)) {
            bodyInstance.enable = false; // Ensure hitbox body starts disabled
            if (Hitbox.filter[eid] === 0) {
              // Player hitbox
              // Find enemy physics group (MORE EFFICIENT - requires enemy group)
              // const enemyGroup = scene.enemyGroup; // Assuming group exists
              // scene.physics.add.overlap(bodyInstance.gameObject, enemyGroup, handleHitboxOverlap, undefined, scene);

              // Less efficient fallback (iterate known enemies)
              const enemyEntities = enemyQuery(world);
              for (const enemyEid of enemyEntities) {
                const enemyBodyId = PhysicsBody.bodyId[enemyEid];
                const enemyBody = getPhysicsBody(enemyBodyId);
                if (enemyBody?.gameObject) {
                  scene.physics.add.overlap(
                    bodyInstance.gameObject,
                    enemyBody.gameObject,
                    handleHitboxOverlap
                  );
                }
              }
              console.log(
                `PhysicsSystem: Added overlap for Player Hitbox EID ${eid}`
              );
            } // Add else block for enemy hitboxes targeting player group/entity
          }

          // --- Scene Collider Setup (Example for Player) ---
          // Add scene specific colliders here when the body is created
          if (
            hasComponent(world, PlayerControlled, eid) &&
            bodyInstance.gameObject
          ) {
            // Assuming platforms group exists on the scene
            const platforms = scene.physics.world.staticBodies.getArray()[0]; // Find static group (brittle)
            if (platforms && !(scene as any).playerColliderAdded) {
              scene.physics.add.collider(bodyInstance.gameObject, platforms);
              (scene as any).playerColliderAdded = true; // Add only once
              console.log(
                `PhysicsSystem: Added player-platform collider for EID ${eid}`
              );
            }
          }
        } else {
          console.error(
            `PhysicsSystem: Failed to create/enable physics body for EID ${eid}`
          );
        }
      } else if (isSpriteRenderable && !targetGameObject) {
        console.warn(
          `PhysicsSystem: EID ${eid} has Renderable but sprite not found in map yet. Physics body creation delayed.`
        );
      }
    }
  }

  // Cleanup exited bodies
  for (const eid of exitedPhysics) {
    const bodyId = PhysicsBody.bodyId[eid];
    if (bodyId !== 0) {
      const body = getPhysicsBody(bodyId);
      if (body) {
        const gameObject = body.gameObject;
        if (gameObject) {
          scene.physics.world.disable(gameObject);
           // Check if it was a temporary hitbox sprite
          if (
            !hasComponent(world, Renderable, eid) &&
            gameObject.texture?.key === ""
          ) {
            gameObject.destroy(); // Clean up the temporary sprite
            console.log(
              `PhysicsSystem: Destroyed temp sprite for BodyID ${bodyId} (EID ${eid})`
            );
          }
          console.log(
            `PhysicsSystem: Disabled physics for BodyID ${bodyId} (EID ${eid})`
          );
        } else {
          // Body might not have a GO if managed differently (less likely with current setup)
          body.destroy();
          console.log(
            `PhysicsSystem: Destroyed standalone body BodyID ${bodyId} (EID ${eid})`
          );
        }
        removePhysicsBody(bodyId);
      }
    }
    // Ensure playerColliderAdded flag is reset if the player entity is removed
    if (hasComponent(world, PlayerControlled, eid)) {
      (scene as any).playerColliderAdded = false;
    }
  }
}
 
declare module "phaser" {
  interface Scene {
    ecsWorld?: InWorld;
  }
}

// --- Update Global Collision Handler ---
function handleHitboxOverlap(
  hitGO: Phaser.Types.Physics.Arcade.ArcadeColliderType | Phaser.Tilemaps.Tile,
  tarGO: Phaser.Types.Physics.Arcade.ArcadeColliderType | Phaser.Tilemaps.Tile
) {
  const hitboxGO = hitGO as Phaser.Types.Physics.Arcade.GameObjectWithBody;
  const targetGO = tarGO as Phaser.Types.Physics.Arcade.GameObjectWithBody;

  const world = hitboxGO.scene.ecsWorld; // Assumes world is attached to scene
  if (!world) return;

  // --- Use getData for efficient EID lookup ---
  const hitboxEid = hitboxGO.getData('eid') as number | undefined;
  const targetEid = targetGO.getData('eid') as number | undefined;

  if (hitboxEid === undefined || targetEid === undefined || hitboxEid === targetEid) {
      // console.warn(`Collision: Missing EID on GO or self-collision`, hitboxGO, targetGO);
      return;
  }

  // Check if hitbox component still exists (it might be expiring this frame)
  if (!hasComponent(world, Hitbox, hitboxEid)) return;

  // Get or create the hit set for this specific hitbox instance
  let hitSet = hitboxHitRegistry.get(hitboxEid);
  if (!hitSet) {
      hitSet = new Set<number>();
      hitboxHitRegistry.set(hitboxEid, hitSet);
  }

  const maxHits = Hitbox.maxHits[hitboxEid];
  if (hitSet.size >= maxHits) return; // Max hits reached
  if (hitSet.has(targetEid)) return;  // Already hit this target with this hitbox

  // --- Process the Hit ---
  console.log(`Collision: Hitbox EID ${hitboxEid} hit Target EID ${targetEid}`);
  hitSet.add(targetEid);

  // Add TakeDamage component to the target if it doesn't have it already
  if (hasComponent(world, Health, targetEid) && !hasComponent(world, TakeDamage, targetEid)) {
      addComponent(world, TakeDamage, targetEid);
      // TODO: Get damage from technique/weapon data associated with the hitbox owner
      TakeDamage.amount[targetEid] = 15; // Example damage
      TakeDamage.sourceEid[targetEid] = Hitbox.ownerEid[hitboxEid];
      console.log(`Collision: Added TakeDamage to Target EID ${targetEid}`);
  }
}
