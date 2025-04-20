// src/scenes/GameScene.ts
import Phaser from "phaser";
import { createWorld, addEntity, addComponent, hasComponent } from "bitecs";
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
  CombatState,
  Cooldown,
  Enemy,
  AIState,
  EnemyAIState,
  TechniqueCooldowns,
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
  handleHitboxOverlap,
  aiSystem,
  resourceRegenSystem,
} from "@/features/common/systems";
import { InWorld } from "@/types";
import * as AssetKeys from "@/constants/assets"; // Import constants

import EasyStar from "easystarjs";

const aiPathMap = new Map<number, { x: number; y: number }[]>();

export default class GameScene extends Phaser.Scene {
  public playerGroup!: Phaser.Physics.Arcade.Group; // Use '!' - we initialize in create()
  public enemyGroup!: Phaser.Physics.Arcade.Group;
  public enemyHitboxGroup!: Phaser.Physics.Arcade.Group;
  public playerHitboxGroup!: Phaser.Physics.Arcade.Group;

  private world?: InWorld;
  private playerEid?: number; // Player Entity ID

  // Store input instance for systems
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;

  private collisionLayer?: Phaser.Tilemaps.TilemapLayer | null;
  private map!: Phaser.Tilemaps.Tilemap; // Store the map reference
  public easystar!: EasyStar.js; // <-- Make easystar instance public or pass via resources

  // Flag to ensure colliders/overlaps are added only once
  private physicsSetupDone = false;

  constructor() {
    super(AssetKeys.Scenes.GAME);
  }

  preload() {
    // Load player spritesheet/atlas if not global
    this.load.spritesheet(
      AssetKeys.Textures.PLAYER,
      "assets/images/placeholder_player_strip.png",
      {
        frameWidth: 32,
        frameHeight: 48,
      }
    );

    this.load.image(
      AssetKeys.Textures.ENEMY,
      "assets/images/placeholder_enemy.png"
    );

    this.load.image("game_bg", "assets/images/game_bg.png");
    this.load.image("tileset_main", "assets/images/spritesheet.png");
    this.load.tilemapTiledJSON("tilemap_main", "assets/data/map.json");
  }

  create() {
    // const { width, height } = this.scale;
    console.log("GameScene started");
    aiPathMap.clear();

    // this.add
    //   .image(width / 2, height / 2, "game_bg")
    //   .setDisplaySize(width, height);

    this.physicsSetupDone = false;
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.world = createWorld();
    this.scene.get(AssetKeys.Scenes.UI).scene.restart();
    this.ecsWorld = this.world;

    // --- CREATE TILEMAP ---
    this.map = this.make.tilemap({ key: "tilemap_main" });
    const tileset = this.map.addTilesetImage(
      "Tileset",
      "tileset_main"
    ); // Match names

    if (!tileset) {
      console.error("Failed to load tileset! Check names in Tiled vs code.");
      return; // Stop create if tileset fails
    }

    this.map.createLayer("Background", tileset, 0, 0);
    this.collisionLayer = this.map.createLayer("Collision", tileset, 0, 0); // Assign to the class property

    if (!this.collisionLayer) {
      console.error(
        "Failed to create Collision tilemap layer! Check layer name in Tiled."
      );
      return; // Stop create if layer fails
    }
    this.collisionLayer.setCollisionByProperty({ collides: true });
    console.log("Collision layer created and collision set by property.");

    // --- Initialize EasyStar ---
    this.easystar = new EasyStar.js();
    const grid: number[][] = [];
    const acceptableTiles: number[] = [];

    console.log(1, this.map.width, this.map.height);

    // Create grid and identify walkable tiles
    for (let y = 0; y < this.map.height; y++) {
      const row: number[] = [];
      for (let x = 0; x < this.map.width; x++) {
        const tile = this.map.getTileAt(x, y, false, "Collision"); // Get tile from Collision layer
        const tileIndex = tile ? tile.index : -1; // Use tile.index (-1 if no tile)
        row.push(tileIndex);

        // Tile is acceptable if it exists AND does NOT have the 'collides' property
        // Or if there's no tile at all on the collision layer (empty space is walkable)
        if ((tile && !tile.properties.collides) || !tile) {
          // Make sure we don't add duplicates or -1 if it's not used as a tile index
          if (tileIndex !== -1 && !acceptableTiles.includes(tileIndex)) {
            acceptableTiles.push(tileIndex);
          }
          // Handle empty space: we need to tell EasyStar to accept a specific value for empty grid cells if its index is -1
          // Let's assume index -1 represents empty walkable space.
          if (tileIndex === -1 && !acceptableTiles.includes(-1)) {
            acceptableTiles.push(-1); // Accept "no tile" index
          }
        }
      }
      grid.push(row);
    }

    this.easystar.setGrid(grid);
    this.easystar.setAcceptableTiles(acceptableTiles);
    this.easystar.enableDiagonals(); // Optional: Allow diagonal movement
    // this.easystar.disableCornerCutting(); // Optional: Prevent cutting corners
    this.easystar.setIterationsPerCalculation(1000); // Prevent blocking

    console.log("EasyStar initialized. Acceptable tiles:", acceptableTiles);
    // console.log("EasyStar Grid:", grid); // Log grid for debugging if needed

    this.playerGroup = this.physics.add.group({
      classType: Phaser.GameObjects.Sprite,
    });
    this.playerHitboxGroup = this.physics.add.group({
      classType: Phaser.GameObjects.Sprite,
    });
    this.enemyHitboxGroup = this.physics.add.group({
      classType: Phaser.GameObjects.Sprite,
    });
    this.enemyGroup = this.physics.add.group({
      classType: Phaser.GameObjects.Sprite,
    });
    console.log("Physics groups created.");

    // --- Player Creation (Hybrid ECS - TDD 3.1) ---
    this.playerEid = addEntity(this.world);

    // Core Components
    addComponent(this.world, PlayerControlled, this.playerEid);

    addComponent(this.world, Position, this.playerEid);
    Position.x[this.playerEid] = this.scale.width / 2;
    Position.y[this.playerEid] = this.scale.height / 2;

    addComponent(this.world, Velocity, this.playerEid);
    addComponent(this.world, Rotation, this.playerEid);
    addComponent(this.world, InputState, this.playerEid);

    addComponent(this.world, PhysicsBody, this.playerEid);
    PhysicsBody.bodyId[this.playerEid] = 0;
    PhysicsBody.width[this.playerEid] = 32; // Match sprite/collision area
    PhysicsBody.height[this.playerEid] = 48;
    PhysicsBody.offsetX[this.playerEid] = 0; // Center alignment assumed
    PhysicsBody.offsetY[this.playerEid] = 0;
    PhysicsBody.collides[this.playerEid] = 1; // Collide with world bounds/static geometry

    addComponent(this.world, MovementState, this.playerEid);
    MovementState.isIdle[this.playerEid] = 1;

    addComponent(this.world, CombatState, this.playerEid);
    CombatState.canAttack[this.playerEid] = 1;
    CombatState.canMove[this.playerEid] = 1;

    addComponent(this.world, Cooldown, this.playerEid);

    const playerSpriteKey = AssetKeys.Textures.PLAYER;
    const playerSpriteId = getSpriteKeyId(playerSpriteKey);
    const playerIdleAnimKey = AssetKeys.Anims.PLAYER_IDLE; // Use constant
    const playerIdleAnimId = getAnimationKeyId(playerIdleAnimKey);

    addComponent(this.world, Renderable, this.playerEid);
    Renderable.spriteKey[this.playerEid] = playerSpriteId;
    Renderable.animationKey[this.playerEid] = playerIdleAnimId;
    Renderable.visible[this.playerEid] = 1;
    Renderable.depth[this.playerEid] = 10;
    Renderable.tint[this.playerEid] = 0xffffff;

    addComponent(this.world, Health, this.playerEid);
    addComponent(this.world, QiPool, this.playerEid);
    addComponent(this.world, StaminaPool, this.playerEid);
    addComponent(this.world, TechniqueCooldowns, this.playerEid);
    this.syncStatsFromZustand(this.playerEid);

    this.spawnEnemy(this.scale.width * 0.75, this.scale.height / 2);

    // --- Define Animations (TDD 4.6) ---
    if (!this.anims.exists("player_hurt")) {
      // Define Hurt Animation
      this.anims.create({
        key: "player_hurt",
        // Use frames that show impact - often just one or two frames
        frames: this.anims.generateFrameNumbers(AssetKeys.Textures.PLAYER, {
          frames: [12, 13],
        }), // EXAMPLE frames
        frameRate: 8,
        repeat: 0, // Don't loop hurt animation
      });
    }
    if (!this.anims.exists("player_die")) {
      // Define Death Animation
      this.anims.create({
        key: "player_die",
        // Use frames showing death sequence
        frames: this.anims.generateFrameNumbers(AssetKeys.Textures.PLAYER, {
          frames: [14, 15, 16],
        }), // EXAMPLE frames
        frameRate: 6,
        repeat: 0, // Don't loop death animation
      });
    }

    if (!this.anims.exists("player_fly")) {
      this.anims.create({
        key: "player_fly",
        frames: this.anims.generateFrameNumbers(AssetKeys.Textures.PLAYER, {
          frames: [12, 14, 16],
        }),
        frameRate: 4,
        repeat: 0,
      });
    }

    if (!this.anims.exists(AssetKeys.Anims.PLAYER_IDLE)) {
      // Prevent duplicate creation if scene restarts
      this.anims.create({
        key: AssetKeys.Anims.PLAYER_IDLE,
        frames: this.anims.generateFrameNumbers(AssetKeys.Textures.PLAYER, {
          start: 0,
          end: 3,
        }),
        frameRate: 6,
        repeat: -1,
      });
    }
    if (!this.anims.exists(AssetKeys.Anims.PLAYER_RUN)) {
      this.anims.create({
        key: AssetKeys.Anims.PLAYER_RUN,
        frames: this.anims.generateFrameNumbers(AssetKeys.Textures.PLAYER, {
          start: 4,
          end: 7,
        }),
        frameRate: 10,
        repeat: -1,
      });
    }
    if (!this.anims.exists(AssetKeys.Anims.PLAYER_ATTACK_LIGHT_1)) {
      // Define attack anim
      this.anims.create({
        key: AssetKeys.Anims.PLAYER_ATTACK_LIGHT_1,
        frames: this.anims.generateFrameNumbers(AssetKeys.Textures.PLAYER, {
          start: 8,
          end: 11,
        }), // Adjust frames
        frameRate: 12,
        repeat: 0, // Play once
      });
      // Add animation complete event listener IF NEEDED (TDD 4.6.4)
      // this.anims.get(AssetKeys.Anims.PLAYER_ATTACK_LIGHT_1).on('complete', () => { /* Reset state? */ });
    }
    if (!this.anims.exists(AssetKeys.Anims.PLAYER_ATTACK_HEAVY)) {
      this.anims.create({
        key: AssetKeys.Anims.PLAYER_ATTACK_HEAVY,
        frames: this.anims.generateFrameNumbers(AssetKeys.Textures.PLAYER, {
          start: 12,
          end: 15,
        }),
        frameRate: 12,
        repeat: 0,
      });
    }
    if (!this.anims.exists(AssetKeys.Anims.PLAYER_DODGE)) {
      this.anims.create({
        key: AssetKeys.Anims.PLAYER_DODGE,
        frames: this.anims.generateFrameNumbers(AssetKeys.Textures.PLAYER, {
          start: 16,
          end: 19,
        }),
        frameRate: 12,
        repeat: 0,
      });
    }

    // --- World Setup ---
    // Create static ground platform (ensure it doesn't get added multiple times if scene restarts)
    if (this.physics.world.staticBodies.size === 0) {
      const platforms = this.physics.add.staticGroup();
      platforms
        .create(640, 1060, AssetKeys.Textures.ENEMY) // Use undefined texture key for invisible platform
        .setDisplaySize(1280, 40)
        .refreshBody(); // Use refreshBody() for static bodies after scaling
      console.log("Static platform created.");
    } else {
      console.log("Static platform already exists.");
    }

    // --- Setup Physics Colliders & Overlaps (deferring to first update) ---
    // We defer this to the first run of physicsSystem or update to ensure groups are populated.
    console.log(`Player entity ${this.playerEid} created.`);
  }

  // Example enemy spawn function
  spawnEnemy(x: number, y: number) {
    if (!this.world) return;
    const enemyEid = addEntity(this.world);

    addComponent(this.world, Enemy, enemyEid);
    Enemy.archetypeId[enemyEid] = 1; // Example ID

    addComponent(this.world, Position, enemyEid);
    Position.x[enemyEid] = x;
    Position.y[enemyEid] = y;

    addComponent(this.world, Velocity, enemyEid); // Needed for movement later
    addComponent(this.world, Rotation, enemyEid);
    Rotation.angle[enemyEid] = 180; // Face left initially

    addComponent(this.world, PhysicsBody, enemyEid);
    PhysicsBody.bodyId[enemyEid] = 0;
    PhysicsBody.width[enemyEid] = 32; // Example size
    PhysicsBody.height[enemyEid] = 32;
    PhysicsBody.offsetX[enemyEid] = 0;
    PhysicsBody.offsetY[enemyEid] = 0;
    PhysicsBody.collides[enemyEid] = 1;

    addComponent(this.world, MovementState, enemyEid); // Basic state needed
    MovementState.isIdle[enemyEid] = 1;

    addComponent(this.world, CombatState, enemyEid); // Needed for taking damage/reactions
    CombatState.canMove[enemyEid] = 1; // Allow movement initially
    CombatState.canAttack[enemyEid] = 1; // Allow actions initially

    addComponent(this.world, Cooldown, enemyEid); // Needed for enemy actions

    addComponent(this.world, Health, enemyEid);
    Health.current[enemyEid] = 50; // Example health
    Health.max[enemyEid] = 50;

    const enemySpriteKey = AssetKeys.Textures.ENEMY; // Placeholder
    const enemySpriteId = getSpriteKeyId(enemySpriteKey);
    // Define enemy idle anim later if needed
    const enemyIdleAnimId = getAnimationKeyId("enemy_idle"); // Placeholder

    addComponent(this.world, Renderable, enemyEid);
    Renderable.spriteKey[enemyEid] = enemySpriteId;
    Renderable.animationKey[enemyEid] = enemyIdleAnimId; // Default animation
    Renderable.visible[enemyEid] = 1;
    Renderable.depth[enemyEid] = 9; // Slightly behind player
    Renderable.tint[enemyEid] = 0xffffff;

    addComponent(this.world, AIState, enemyEid);
    AIState.currentState[enemyEid] = EnemyAIState.Idle; // Start Idle
    AIState.stateDurationMs[enemyEid] = 0;
    AIState.targetEid[enemyEid] = 0; // No target initially
    AIState.perceptionRadiusSq[enemyEid] = 300 * 300; // Example range (squared)
    AIState.attackRadiusSq[enemyEid] = 50 * 50; // Example range (squared)
    AIState.actionCooldownMs[enemyEid] = 0; // Ready for action

    console.log(
      `Spawned enemy entity ${enemyEid} with AIState at (${x}, ${y})`
    );
    return enemyEid;
  }

  // Helper for initial stat sync
  syncStatsFromZustand(eid: number) {
    if (!this.world || !hasComponent(this.world, Health, eid)) return;
    const playerState = usePlayerStore.getState();
    Health.current[eid] = playerState.coreStats.health.current;
    Health.max[eid] = playerState.coreStats.health.max;
    QiPool.current[eid] = playerState.coreStats.qi.current;
    QiPool.max[eid] = playerState.coreStats.qi.max;
    StaminaPool.current[eid] = playerState.coreStats.stamina.current;
    StaminaPool.max[eid] = playerState.coreStats.stamina.max;
  }

  setupPhysicsInteractions() {
    if (this.physicsSetupDone || !this.collisionLayer) return;
    console.log("Setting up physics interactions...");

    // --- Colliders ---
    const platformLayer = this.physics.world.staticBodies.getArray()[0]; // Assuming ground is first static object

    if (platformLayer) {
      // Collide player group with platforms
      this.physics.add.collider(this.playerGroup, platformLayer);
      // Collide enemy group with platforms
      this.physics.add.collider(this.enemyGroup, platformLayer);
      console.log("Added Player/Enemy <> Platform colliders.");
    } else {
      console.warn("Platform layer not found for collision setup.");
    }
    // Collide player with enemies (optional, based on gameplay - maybe only overlap?)
    // this.physics.add.collider(this.playerGroup, this.enemyGroup);

    this.physics.add.collider(this.playerGroup, this.collisionLayer);
    // Collide enemy group with the tilemap collision layer
    this.physics.add.collider(this.enemyGroup, this.collisionLayer);
    console.log("Added Player/Enemy <> Tilemap colliders.");

    // --- Overlaps (TDD 4.4.4) ---
    // Player Hitbox vs Enemy Group
    this.physics.add.overlap(
      this.playerHitboxGroup,
      this.enemyGroup,
      handleHitboxOverlap,
      undefined,
      this
    );

    // Enemy Hitbox vs Player Group  <--- ADD THIS
    this.physics.add.overlap(
      this.enemyHitboxGroup,
      this.playerGroup,
      handleHitboxOverlap,
      undefined,
      this
    );

    console.log("Added PlayerHitbox<>Enemy and EnemyHitbox<>Player overlaps.");
    this.physicsSetupDone = true;
  }

  update(time: number, delta: number) {
    if (!this.world || !this.easystar || !this.collisionLayer) return; // Ensure essentials exist

    this.world.resources = {
      time,
      delta: delta / 1000,
      scene: this,
      playerGroup: this.playerGroup,
      enemyGroup: this.enemyGroup,
      playerHitboxGroup: this.playerHitboxGroup,
      easystar: this.easystar,
      collisionLayer: this.collisionLayer,
      aiPathMap: aiPathMap,
      map: this.map
    };

    if (!this.physicsSetupDone) {
      this.setupPhysicsInteractions();
    }

    inputSystem(this.world);
    resourceRegenSystem(this.world);
    cooldownSystem(this.world);
    aiSystem(this.world);
    combatSystem(this.world);
    physicsSystem(this.world);
    movementSystem(this.world);
    hitboxSystem(this.world);
    syncPositionSystem(this.world);
    damageSystem(this.world);
    animationSystem(this.world);
    renderSystem(this.world);

    this.easystar.calculate();
  }

  // --- Collision Handlers (To be implemented based on TDD 4.4.5) ---
  // Example:
  // handlePlayerEnemyOverlap(playerEid: number, enemyEid: number) {
  //    // Apply damage via ECS components & dispatch to Zustand
  // }
}
