// src/scenes/GameScene.ts
import Phaser from "phaser";
import {
  createWorld,
  addEntity,
  addComponent,
  pipe,
  IWorld,
  System,
} from "bitecs";
import { usePlayerStore } from "@/state/player.store";
import {
  Position,
  Velocity,
  Rotation,
  PlayerControlled,
  InputState,
  Renderable,
  PhysicsBody,
  Health,
  QiPool,
  StaminaPool,
  MovementState,
  getSpriteKeyId,
  getAnimationKeyId,
  getPhysicsBody,
  CombatState,
  Cooldown,
} from "@/features/common/components";
import {
  inputSystem,
  cooldownSystem, // Moved up
  combatSystem, // Process actions
  movementSystem, // Calculate intended movement
  hitboxSystem, // Manage hitbox state/timing BEFORE physics sync
  physicsSystem, // Create/destroy/configure Phaser bodies & setup overlaps
  syncPositionSystem, // NEW: Sync Phaser body pos -> ECS Position
  damageSystem, // Process damage AFTER physics overlaps occur
  animationSystem, // Determine animations based on final state
  renderSystem, // Update Phaser sprites based on final ECS state 
} from "@/features/common/systems";
import { InWorld } from "@/types";
import * as AssetKeys from "@/constants/assets"; // Import constants



export default class GameScene extends Phaser.Scene {
  private world?: InWorld;
  private pipeline?: System; // bitECS system pipeline
  private playerEid?: number; // Player Entity ID

  // Store input instance for systems
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;

  constructor() {
    super("GameScene");
  }

  preload() {
    // Load player spritesheet/atlas if not global
    this.load.spritesheet(
     AssetKeys.Textures.PLAYER,
      "assets/images/placeholder_player_strip.png",
      {
        // Example spritesheet
        frameWidth: 32, // Adjust dimensions
        frameHeight: 48,
      }
    );
  }

  create() {
    console.log("GameScene started");
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.world = createWorld();
    // TDD 2.5: Define system execution order
    // this.pipeline = pipe(
    //   inputSystem, // Read raw input -> InputState
    //   cooldownSystem, // Update cooldowns
    //   combatSystem, // InputState -> CombatState flags, spawn Hitbox entities
    //   movementSystem, // InputState + CombatState -> Set Velocity on PhysicsBody
    //   hitboxSystem, // Update hitbox position/timing/active state on PhysicsBody
    //   physicsSystem, // Create/Destroy Phaser bodies, setup overlaps
    //   syncPositionSystem, // Read physics body position -> Position component
    //   damageSystem, // Process TakeDamage added by overlaps
    //   animationSystem, // CombatState/MovementState -> Renderable.animationKey
    //   renderSystem // Position/Rotation/Renderable -> Update Sprites
    // );

    // --- Player Creation (Hybrid ECS - TDD 3.1) ---
    this.playerEid = addEntity(this.world);

    // Core Components
    addComponent(this.world, PlayerControlled, this.playerEid);
    addComponent(this.world, Position, this.playerEid);

    Position.x[this.playerEid] = this.scale.width / 2;
    Position.y[this.playerEid] = this.scale.height / 2;

    addComponent(this.world, Velocity, this.playerEid);
    Velocity.vx[this.playerEid] = 0;
    Velocity.vy[this.playerEid] = 0;

    addComponent(this.world, Rotation, this.playerEid); // Initialize rotation
    Rotation.angle[this.playerEid] = 0;

    // Input State
    addComponent(this.world, InputState, this.playerEid); // Initialized to 0 by default

    // Physics Body (Placeholder Data - PhysicsSystem will create the actual body)
    addComponent(this.world, PhysicsBody, this.playerEid);
    PhysicsBody.bodyId[this.playerEid] = 0; // No body initially
    PhysicsBody.width[this.playerEid] = 32; // Example size
    PhysicsBody.height[this.playerEid] = 48;
    PhysicsBody.offsetX[this.playerEid] = 0; // Adjust offset if needed
    PhysicsBody.offsetY[this.playerEid] = 0;
    PhysicsBody.collides[this.playerEid] = 1; // Enable world bounds collision

    // Movement State
    addComponent(this.world, MovementState, this.playerEid);
    MovementState.isIdle[this.playerEid] = 1; // Start idle

    // NEW: Add Combat State
    addComponent(this.world, CombatState, this.playerEid);
    CombatState.canAttack[this.playerEid] = 1; // Can attack initially
    CombatState.canMove[this.playerEid] = 1; // Can move initially

    // NEW: Add Cooldowns
    addComponent(this.world, Cooldown, this.playerEid); // Initialized to 0

    // Renderable
    const playerSpriteKey = "player_char"; // Match loaded asset key
    const playerSpriteId = getSpriteKeyId(playerSpriteKey);
    const playerIdleAnimId = getAnimationKeyId("player_idle"); // Will define this next

    addComponent(this.world, Renderable, this.playerEid);
    Renderable.spriteKey[this.playerEid] = playerSpriteId;
    Renderable.animationKey[this.playerEid] = playerIdleAnimId;
    Renderable.visible[this.playerEid] = 1;
    Renderable.depth[this.playerEid] = 10; // Example depth
    Renderable.tint[this.playerEid] = 0xffffff; // No tint

    // Stats Components (Sync from Zustand - TDD 3.1, 3.3)
    addComponent(this.world, Health, this.playerEid);
    addComponent(this.world, QiPool, this.playerEid);
    addComponent(this.world, StaminaPool, this.playerEid);
    this.syncStatsFromZustand(this.playerEid); // Use helper

    // --- Define Animations (TDD 4.6) ---
    this.anims.create({
      key: AssetKeys.Anims.PLAYER_IDLE,
      frames: this.anims.generateFrameNumbers("player_char", {
        start: 0,
        end: 3,
      }), // Adjust frame numbers
      frameRate: 6,
      repeat: -1,
    });
    this.anims.create({
      key: AssetKeys.Anims.PLAYER_RUN,
      frames: this.anims.generateFrameNumbers("player_char", {
        start: 4,
        end: 7,
      }), // Adjust frame numbers
      frameRate: 10,
      repeat: -1,
    });
    // Define other animations (attack, hurt, fly) later

    // --- World Setup ---
    const platforms = this.physics.add.staticGroup();
    platforms
      .create(640, 700, undefined)
      .setDisplaySize(1280, 40)
      .setImmovable(true)
      .setVisible(false); // Invisible ground

    console.log(`Player entity ${this.playerEid} created.`);
  }

  // Helper for initial stat sync
  syncStatsFromZustand(eid: number) {
    if (!this.world) return;
    const playerState = usePlayerStore.getState();
    Health.current[eid] = playerState.coreStats.health.current;
    Health.max[eid] = playerState.coreStats.health.max;
    QiPool.current[eid] = playerState.coreStats.qi.current;
    QiPool.max[eid] = playerState.coreStats.qi.max;
    StaminaPool.current[eid] = playerState.coreStats.stamina.current;
    StaminaPool.max[eid] = playerState.coreStats.stamina.max;
  }

  update(time: number, delta: number) {
    if (!this.world){ //|| !this.pipeline) {
        return;
    }

 
    this.world.resources = {
        time,
        delta: delta / 1000,
        scene: this
    };

    inputSystem(this.world); 
    cooldownSystem(this.world); 
    combatSystem(this.world); 
    movementSystem(this.world); 
    hitboxSystem(this.world); 
    physicsSystem(this.world); 
    syncPositionSystem(this.world); 
    damageSystem(this.world); 
    animationSystem(this.world); 
    renderSystem(this.world)

    // Execute the entire pipeline
    // this.pipeline(this.world);
  }

  // --- Collision Handlers (To be implemented based on TDD 4.4.5) ---
  // Example:
  // handlePlayerEnemyOverlap(playerEid: number, enemyEid: number) {
  //    // Apply damage via ECS components & dispatch to Zustand
  // }
}
