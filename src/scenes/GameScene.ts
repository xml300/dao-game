import Phaser from 'phaser';
import { SCENE_KEYS, ASSET_KEYS, REGISTRY_KEYS } from '../utils/constants';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { CombatSystem } from '../systems/CombatSystem';
import { TimeStopSystem } from '../systems/TimeStopSystem';
// Import cultivation system if needed for direct interaction, or manage via events/registry
// import { cultivationSystem } from '../systems/CultivationSystem';

export class GameScene extends Phaser.Scene {
    public player!: Player; // Use definite assignment assertion
    public enemies!: Phaser.Physics.Arcade.Group; // Use definite assignment assertion
    private combatSystem!: CombatSystem; // Use definite assignment assertion
    private timeStopSystem!: TimeStopSystem; // Use definite assignment assertion

    constructor() {
        super(SCENE_KEYS.GAME);
    }

    create() {
        console.log("GameScene: Create");

        // --- World Setup ---
        // Basic background tiling
        this.add.tileSprite(0, 0, this.scale.width * 2, this.scale.height * 2, ASSET_KEYS.BACKGROUND)
            .setOrigin(0, 0).setScrollFactor(0.5); // Parallax effect

        // Set world bounds (larger than screen for exploration)
        this.physics.world.setBounds(0, 0, this.scale.width * 2, this.scale.height * 2);

        // --- Systems Initialization ---
        this.timeStopSystem = new TimeStopSystem(this); // Pass scene reference
        this.combatSystem = new CombatSystem(this);

        // --- Player Creation ---
        // Pass the TimeStopSystem instance to the Player
        this.player = new Player(this, this.scale.width / 2, this.scale.height / 2, this.timeStopSystem);

        // --- Enemy Creation ---
        this.enemies = this.physics.add.group({
            classType: Enemy,
            runChildUpdate: true, // Enemies update themselves
        });

        // Spawn some enemies
        for (let i = 0; i < 5; i++) {
            const x = Phaser.Math.Between(100, this.scale.width * 2 - 100);
            const y = Phaser.Math.Between(100, this.scale.height * 2 - 100);
             // Pass player and timeStopSystem references to each enemy
            const enemy = new Enemy(this, x, y, ASSET_KEYS.ENEMY, this.player, this.timeStopSystem);
            this.enemies.add(enemy);
        }

        // --- Physics & Collisions Setup ---
        this.physics.add.collider(this.player, this.enemies); // Player bumps into enemies
        this.physics.add.collider(this.enemies, this.enemies); // Enemies bump into each other

        // Setup combat interactions (overlaps) via CombatSystem
        this.combatSystem.setupCollisions(this.player, this.enemies);

        // --- Camera ---
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
        this.cameras.main.setBounds(0, 0, this.scale.width * 2, this.scale.height * 2);
        this.cameras.main.setZoom(1.2); // Slight zoom in

        // --- Ensure UI Scene is running ---
        // It should have been started by Preloader, but double-check/start if needed
        if (!this.scene.isActive(SCENE_KEYS.UI)) {
             this.scene.run(SCENE_KEYS.UI);
        }

        console.log("GameScene: Setup Complete");
        // Example: Access cultivation data
        // console.log("Initial Cultivation:", cultivationSystem.getData());
    }

    update(time: number, delta: number): void {
        if (this.player?.active) {
             this.player.update(time, delta);
        }
         // Enemies update themselves via the group's runChildUpdate setting
         // this.timeStopSystem.update(); // Update TimeStopSystem if needed
    }
}