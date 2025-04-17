// src/scenes/GameScene.ts
import Phaser from 'phaser';
import { createWorld, addEntity, addComponent, pipe, IWorld, System } from 'bitecs';
import { usePlayerStore } from '@/state/player.store';
import {
    Position, Velocity, Rotation, PlayerControlled, InputState, Renderable, PhysicsBody, Health, QiPool, StaminaPool, MovementState,
    getSpriteKeyId, getAnimationKeyId, getPhysicsBody
} from '@/features/common/components';
import {
    inputSystem, movementSystem, renderSystem, animationSystem, physicsSystem, stateSyncSystem,
    SystemResources
} from '@/features/common/systems';


export default class GameScene extends Phaser.Scene {
    private world?: IWorld;
    private pipeline?: System; // bitECS system pipeline
    private playerEid?: number; // Player Entity ID

    // Store input instance for systems
    private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;


    constructor() {
        super('GameScene');
    }

    preload() {
        // Load player spritesheet/atlas if not global
        this.load.spritesheet('player_char', 'assets/images/placeholder_player_strip.png', { // Example spritesheet
             frameWidth: 32, // Adjust dimensions
             frameHeight: 48
         });
    }

    create() {
        console.log('GameScene started');
        this.cursors = this.input.keyboard?.createCursorKeys();

        // --- ECS Setup ---
        this.world = createWorld();
        // TDD 2.5: Define system execution order
        // this.pipeline = pipe(
        //     inputSystem,      // Read input -> InputState component
        //     animationSystem,  // Determine target animation -> Renderable component
        //     movementSystem,   // Apply velocity based on InputState -> Physics Body
        //     physicsSystem,    // Create/destroy Phaser physics bodies
        //     stateSyncSystem,  // Sync ECS state to global state (if needed)
        //     renderSystem      // Update Phaser sprites from components
        // );


        // --- Player Creation (Hybrid ECS - TDD 3.1) ---
        this.playerEid = addEntity(this.world);

        // Core Components
        addComponent(this.world, PlayerControlled, this.playerEid);
        addComponent(this.world, Position, this.playerEid);
        addComponent(this.world, Velocity, this.playerEid);
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

        // Renderable
        const playerSpriteKey = 'player_char'; // Match loaded asset key
        const playerSpriteId = getSpriteKeyId(playerSpriteKey);
        const playerIdleAnimId = getAnimationKeyId('player_idle'); // Will define this next

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

        // Initial sync from Zustand -> ECS
        const playerState = usePlayerStore.getState();
        Health.current[this.playerEid] = playerState.coreStats.health.current;
        Health.max[this.playerEid] = playerState.coreStats.health.max;
        QiPool.current[this.playerEid] = playerState.coreStats.qi.current;
        QiPool.max[this.playerEid] = playerState.coreStats.qi.max;
        StaminaPool.current[this.playerEid] = playerState.coreStats.stamina.current;
        StaminaPool.max[this.playerEid] = playerState.coreStats.stamina.max;

        // --- Define Animations (TDD 4.6) ---
        this.anims.create({
            key: 'player_idle',
            frames: this.anims.generateFrameNumbers('player_char', { start: 0, end: 3 }), // Adjust frame numbers
            frameRate: 6,
            repeat: -1
        });
        this.anims.create({
            key: 'player_run',
            frames: this.anims.generateFrameNumbers('player_char', { start: 4, end: 7 }), // Adjust frame numbers
            frameRate: 10,
            repeat: -1
        });
        // Define other animations (attack, hurt, fly) later

        // --- World Setup ---
        // Add platforms, enemies, etc. later
        // Example static platform:
        const platforms = this.physics.add.staticGroup();
        platforms.create(640, 700, undefined).setDisplaySize(1280, 40).setImmovable(true).setVisible(false); // Invisible ground

        // Setup collision between player's physics body and platforms
        // Need to get the player sprite created by RenderSystem for collider setup.
        // This creates a dependency: RenderSystem needs to run at least once before colliders are set,
        // OR PhysicsSystem handles collider creation after body creation.
        // Let's handle it after the first renderSystem run.
        this.time.delayedCall(5000, () => { // Wait a tiny bit for first render
             if (this.playerEid !== undefined) {
                const bodyId = PhysicsBody.bodyId[this.playerEid];
                const playerBody = getPhysicsBody(bodyId);
                console.log(playerBody)
                if (playerBody?.gameObject) { // Check if GO exists
                    this.physics.add.collider(playerBody.gameObject, platforms);
                    console.log("Added player-platform collider.");
                } else {
                     console.warn("Could not add collider: Player physics body or sprite not found after delay.");
                }
             }
        });


        console.log(`Player entity ${this.playerEid} created.`);
    }

    update(time: number, delta: number) {
        if (!this.world) {
            return;
        }

        // Pass resources to the system pipeline
        const resources: SystemResources = {
            time,
            delta: delta / 1000, // Pass delta in seconds
            scene: this
        }; 

        inputSystem(this.world, resources);
        animationSystem(this.world, resources); // Pass resources even if not strictly needed by this specific system for consistency
        physicsSystem(this.world, resources);
        movementSystem(this.world, resources);
        stateSyncSystem(this.world, resources); // Pass resources
        renderSystem(this.world, resources);
    }

    // --- Collision Handlers (To be implemented based on TDD 4.4.5) ---
    // Example:
    // handlePlayerEnemyOverlap(playerEid: number, enemyEid: number) {
    //    // Apply damage via ECS components & dispatch to Zustand
    // }
}