// src/features/common/systems.ts
import {
  IWorld,
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
const movementQuery = defineQuery([Position, Velocity, PhysicsBody]);
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

// --- Input System (TDD 3.2) ---
export function inputSystem(world: IWorld, resources: SystemResources) {
  const { scene } = resources;
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
export function cooldownSystem(world: IWorld, resources: SystemResources) {
  const { delta } = resources;
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
export function combatSystem(world: IWorld, resources: SystemResources) {
  const { time, delta } = resources;
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
export function hitboxSystem(world: IWorld, resources: SystemResources) {
  const { time } = resources;
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
export function damageSystem(world: IWorld) {
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
export function movementSystem(world: IWorld){ //resources: SystemResources) {
  // const { delta } = resources;
  const speed = 200; // Base speed, move to config/component later
  const sprintMultiplier = 1.5; // Example sprint speed increase

  const playerEntities = playerInputQuery(world); // Get player specifically
  for (const eid of playerEntities) {
    const bodyId = PhysicsBody.bodyId[eid];
    const body = getPhysicsBody(bodyId) as Phaser.Physics.Arcade.Body; // Assuming body exists
    if (!body) continue;

    const inputX = InputState.moveX[eid];
    const inputY = InputState.moveY[eid];
    const canMove = CombatState.canMove[eid] === 1;
    // TODO: Check Stamina (TDD 4.2.1 - Sprint) before applying sprint speed

   
    let targetVelocityX = 0;
    let targetVelocityY = 0;
    if (canMove) {
        const isSprinting = InputState.sprint[eid] === 1;
        const currentSpeed = isSprinting ? speed * sprintMultiplier : speed;
        targetVelocityX = inputX * currentSpeed;
        targetVelocityY = inputY * currentSpeed;

         // --- LOGGING START ---
        if (targetVelocityX !== 0 || targetVelocityY !== 0) {
            console.log(`MovementSystem[${eid}]: Setting Velocity=(${targetVelocityX}, ${targetVelocityY})`);
        }
         // --- LOGGING END ---
    } else if (inputX !== 0 || inputY !== 0) { // Log if trying to move but can't
         console.log(`MovementSystem[${eid}]: Movement blocked by CombatState.canMove=${CombatState.canMove[eid]}`);
    }

    // Set velocity on the actual Phaser body
    body.setVelocityX(targetVelocityX);
    body.setVelocityY(targetVelocityY);

    // Update MovementState for animation (Basic Idle/Run)
    if (Math.abs(targetVelocityX) > 0 || Math.abs(targetVelocityY) > 0) {
      MovementState.isRunning[eid] = 1;
      MovementState.isIdle[eid] = 0;
    } else {
      MovementState.isRunning[eid] = 0;
      MovementState.isIdle[eid] = 1;
    }

    // Basic Rotation based on horizontal movement
    if (inputX < 0) {
      // Flip sprite (handled in render system or directly on body)
      // body.gameObject.setFlipX(true); // If using sprite directly
      Rotation.angle[eid] = 180; // Or use flip flag in Renderable
    } else if (inputX > 0) {
      // body.gameObject.setFlipX(false);
      Rotation.angle[eid] = 0;
    }

    // TODO: Add flight logic (TDD 6.2) based on a flag (e.g., MovementState.isFlying)
    // TODO: Add dodge movement impulse (TDD 4.2.1)
  }

  // --- Sync Physics Body Position back to ECS Position ---
  // Necessary because Arcade Physics updates the body directly
  const movingEntities = movementQuery(world);
  for (const eid of movingEntities) {
    const bodyId = PhysicsBody.bodyId[eid];
    const body = getPhysicsBody(bodyId);
    if (body?.gameObject instanceof Phaser.GameObjects.Sprite) {
      Position.x[eid] = body.gameObject.x;
      Position.y[eid] = body.gameObject.y;
    } else if (body) {
      // Handle case where body might not be attached to a sprite? Unlikely for dynamic objects.
      Position.x[eid] = body.x + body.width * body.offset.x; // Adjust for body origin/offset if needed
      Position.y[eid] = body.y + body.height * body.offset.y;
    }
  }

  const playerCombatEntities = playerCombatQuery(world); // Ensure this query includes CombatState
  for (const eid of playerCombatEntities) {
    const bodyId = PhysicsBody.bodyId[eid];
    const body = getPhysicsBody(bodyId) as Phaser.Physics.Arcade.Body;
    if (!body) continue;

    const moveX = InputState.moveX[eid];
    const moveY = InputState.moveY[eid];
    const isSprinting = InputState.sprint[eid] === 1;
    const canMove = CombatState.canMove[eid] === 1; // Check CombatState flag

    // --- Apply movement only if allowed ---
    let targetVelocityX = 0;
    let targetVelocityY = 0;
    if (canMove) {
      const currentSpeed = isSprinting ? speed * sprintMultiplier : speed;
      targetVelocityX = moveX * currentSpeed;
      targetVelocityY = moveY * currentSpeed;
    }
    body.setVelocityX(targetVelocityX);
    body.setVelocityY(targetVelocityY);

    // Update MovementState for animation (Basic Idle/Run) - Only if not attacking/etc.
    if (
      canMove &&
      (Math.abs(targetVelocityX) > 0 || Math.abs(targetVelocityY) > 0)
    ) {
      MovementState.isRunning[eid] = 1;
      MovementState.isIdle[eid] = 0;
    } else if (canMove) {
      // Only set idle if allowed to move but not moving
      MovementState.isRunning[eid] = 0;
      MovementState.isIdle[eid] = 1;
    } else {
      // If cannot move (e.g., attacking), force idle animation state? Or attacking state handles anim?
      MovementState.isRunning[eid] = 0;
      MovementState.isIdle[eid] = 0; // Attacking state will override this in animation system
    }

    // Basic Rotation based on horizontal movement (only if canMove?)
    if (canMove) {
      if (moveX < 0) Rotation.angle[eid] = 180;
      else if (moveX > 0) Rotation.angle[eid] = 0;
    }
  }
}

// --- Render System (TDD 2.5 Bridge, 4.6) ---
export function renderSystem(world: IWorld, resources: SystemResources) {
  const { scene } = resources;

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
export function animationSystem(world: IWorld) {
  const entities = defineQuery([Renderable, MovementState])(world); // Entities with state and visuals

  for (const eid of entities) {
    let targetAnimKeyId = Renderable.animationKey[eid]; // Keep current if no state matches

    // TODO: Get actual animation keys ('player_idle', 'player_run')
    const idleAnimId = getAnimationKeyId("player_idle"); // Replace with actual keys
    const runAnimId = getAnimationKeyId("player_run"); // Replace with actual keys
    const attackLight1AnimId = getAnimationKeyId("player_attack_light1");

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
export function physicsSystem(world: IWorld, resources: SystemResources) {
  const { scene } = resources;
  // Query for entities that SHOULD have a physics body but might not yet
  const physicsQuery = defineQuery([Position, PhysicsBody]);
  const enteredPhysics = enterQuery(physicsQuery)(world);
  const exitedPhysics = exitQuery(physicsQuery)(world); // Entities losing physics requirement

  for (const eid of enteredPhysics) {
    if (PhysicsBody.bodyId[eid] === 0) {
      let targetGameObject: Phaser.GameObjects.GameObject | null = null;

      if (hasComponent(world, Renderable, eid)) {
        // Is it a visible entity?
        targetGameObject = spriteMap.get(eid) ?? null; // Check if sprite exists first
      }

      if (targetGameObject || hasComponent(world, Hitbox, eid)) {
        // Or is it just a hitbox?
        let bodyInstance: Phaser.Physics.Arcade.Body | null = null;

        if (targetGameObject) {
          // Add physics body TO the existing sprite
          scene.physics.world.enable(targetGameObject);
          bodyInstance = targetGameObject.body as Phaser.Physics.Arcade.Body;
          console.log(
            `PhysicsSystem: Enabled physics body on sprite for entity ${eid}`
          );
        } else {
          // It's a hitbox without a sprite, create an invisible body
          // We need a way to manage these non-sprite bodies. Add them to a group?
          // Simplest for now: use an invisible sprite (less efficient)
          const x = Position.x[eid];
          const y = Position.y[eid];
          const w = PhysicsBody.width[eid];
          const h = PhysicsBody.height[eid];
          // WORKAROUND: Create temporary invisible sprite to hold the body
          const hitboxSprite = scene.add
            .sprite(x, y, "")
            .setVisible(false)
            .setActive(false);
          scene.physics.world.enable(hitboxSprite);
          bodyInstance = hitboxSprite.body as Phaser.Physics.Arcade.Body;
          bodyInstance.setSize(w, h); // Set correct size
          // Store reference to this temporary sprite? Or just the body? Store body.
          console.log(`PhysicsSystem: Created physics body for hitbox ${eid}`);
        }

        if (bodyInstance) {
          const bodyId = registerPhysicsBody(bodyInstance);
          PhysicsBody.bodyId[eid] = bodyId;
          // Configure body from component data
          bodyInstance.setSize(PhysicsBody.width[eid], PhysicsBody.height[eid]);
          bodyInstance.setOffset(
            PhysicsBody.offsetX[eid],
            PhysicsBody.offsetY[eid]
          );
          bodyInstance.setCollideWorldBounds(false); // Hitboxes usually shouldn't collide with world bounds
          bodyInstance.allowGravity = false; // Hitboxes ignore gravity
          bodyInstance.enable = false; // Start disabled, hitboxSystem enables it based on time
          // Add overlap setup here? Or in a dedicated collision system? Let's do it here for now.

          if (hasComponent(world, Hitbox, eid) && Hitbox.filter[eid] === 0) {
            // Player hitbox
            // Find enemy physics group/entities to overlap with
            // This is inefficient - better to use groups.
            const enemyEntities = enemyQuery(world);
            for (const enemyEid of enemyEntities) {
              const enemyBodyId = PhysicsBody.bodyId[enemyEid];
              const enemyBody = getPhysicsBody(enemyBodyId);
              if (enemyBody?.gameObject) {
                scene.physics.add.overlap(
                  bodyInstance.gameObject,
                  enemyBody.gameObject,
                  handleHitboxOverlap,
                  undefined,
                  scene
                );
              }
            }
            console.log(
              `PhysicsSystem: Added overlap detection for player hitbox ${eid}`
            );
          }
          // TODO: Add overlap setup for enemy hitboxes hitting player
        } else {
          console.error(
            `PhysicsSystem: Failed to enable/create physics for entity ${eid}`
          );
        }
      } else {
        // console.warn(`PhysicsSystem: Entity ${eid} needs physics but Renderable sprite/Hitbox component not found yet.`);
      }
    }
  }

  // Clean up physics bodies for entities that no longer need them
  for (const eid of exitedPhysics) {
    const bodyId = PhysicsBody.bodyId[eid];
    if (bodyId !== 0) {
      const body = getPhysicsBody(bodyId);
      if (body) {
        if (body.gameObject) {
          // Check if it's attached to a GO we can disable
          scene.physics.world.disable(body.gameObject);
          if (!body.gameObject.scene) {
            // If the GO was destroyed (e.g., hitbox sprite workaround)
            // Body might already be gone
          } else if (
            !hasComponent(world, Renderable, eid) &&
            hasComponent(world, Hitbox, eid)
          ) {
            // If it was the temporary hitbox sprite, destroy it
            body.gameObject.destroy();
            console.log(
              `PhysicsSystem: Destroyed temp sprite for hitbox body ${bodyId}`
            );
          }
          console.log(
            `PhysicsSystem: Disabled/removed physics body ${bodyId} for entity ${eid}`
          );
        } else {
          // Standalone body? Destroy directly.
          body.destroy();
          console.log(
            `PhysicsSystem: Destroyed standalone physics body ${bodyId} for entity ${eid}`
          );
        }
        removePhysicsBody(bodyId);
        // PhysicsBody.bodyId[eid] = 0; // Component is being removed anyway
      }
    }
  }
}
// --- State Sync System (TDD 3.1, 3.3) ---
// Syncs ECS stat components (Health, Qi, Stamina) with Zustand store
// Runs less frequently or only when changes occur?
export function stateSyncSystem(world: IWorld) {
  const playerEntities = defineQuery([
    PlayerControlled,
    Health,
    QiPool,
    StaminaPool,
  ])(world);
  // const { setCoreStats } = usePlayerStore.getState(); // Get action outside loop

  for (const eid of playerEntities) {
    // Read from ECS, write to Zustand
    // This direction might be less common; usually it's Zustand -> ECS initialization
    // Or ECS systems directly modify Zustand on significant events (like taking damage)
    // const currentECSHealth = Health.current[eid];
    // const currentECSMaxHealth = Health.max[eid];
    // Compare with Zustand state? Or just push ECS state?
    Health.current[eid];

    // Example: Combat system detects hit, updates Health component, THEN dispatches to Zustand
    // Example: Resource regeneration system updates QiPool/StaminaPool, THEN dispatches to Zustand

    // Let's assume for now initialization happens GameScene -> ECS
    // And updates happen ECS System -> Zustand Action
  }

  // Initialization direction (Zustand -> ECS) could happen once in GameScene.create
}

declare module "phaser" {
  interface Scene {
    ecsWorld?: IWorld;
  }
}

// --- Update Global Collision Handler ---
function handleHitboxOverlap(
    hitboxGO: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    targetGO: Phaser.Types.Physics.Arcade.GameObjectWithBody
) {
    const world = hitboxGO.scene.ecsWorld;
    if (!world) return;

    let hitboxEid: number | undefined;
    let targetEid: number | undefined;

    // ... (Find hitboxEid and targetEid as before, potentially using setData optimisation) ...
     const physicsEntities = defineQuery([PhysicsBody])(world);
     for (const eid of physicsEntities) {
          const bodyId = PhysicsBody.bodyId[eid];
          const body = getPhysicsBody(bodyId);
          // Check if eid is already set via setData for performance
          const goEid = body?.gameObject?.getData('eid');
          if (goEid !== undefined) {
              if (body?.gameObject === hitboxGO) hitboxEid = goEid;
              if (body?.gameObject === targetGO) targetEid = goEid;
          } else { // Fallback to checking body reference (less ideal)
              if (body?.gameObject === hitboxGO) hitboxEid = eid;
              if (body?.gameObject === targetGO) targetEid = eid;
          }
          if (hitboxEid !== undefined && targetEid !== undefined) break;
     }


    if (hitboxEid === undefined || targetEid === undefined) return;

    // --- Use the External Registry ---
    if (!hasComponent(world, Hitbox, hitboxEid)) return; // Check if hitbox component still exists

    // Get or create the hit set for this hitbox instance
    let hitSet = hitboxHitRegistry.get(hitboxEid);
    if (!hitSet) {
        hitSet = new Set<number>();
        hitboxHitRegistry.set(hitboxEid, hitSet);
    }

    // Check max hits if needed (using Hitbox.maxHits[hitboxEid])
    const maxHits = Hitbox.maxHits[hitboxEid];
    if (hitSet.size >= maxHits) {
        // console.log(`Hitbox ${hitboxEid} already reached max hits (${maxHits})`);
        return; // Max hits reached for this hitbox instance
    }

    // Check if target already hit by this instance
    if (hitSet.has(targetEid)) {
        // console.log(`Hitbox ${hitboxEid} already hit target ${targetEid}`);
        return; // Already hit
    }

    // --- Process the Hit ---
    console.log(`Collision: Hitbox ${hitboxEid} hit Target ${targetEid} (Registry Check Passed)`);

    // Add target to the set for this hitbox instance
    hitSet.add(targetEid);

    // Add TakeDamage component to the target
    if (!hasComponent(world, TakeDamage, targetEid)) {
        addComponent(world, TakeDamage, targetEid);
        TakeDamage.amount[targetEid] = 10; // Placeholder damage
        TakeDamage.sourceEid[targetEid] = Hitbox.ownerEid[hitboxEid];
        console.log(`Collision: Added TakeDamage component to target ${targetEid}`);
    }
}
