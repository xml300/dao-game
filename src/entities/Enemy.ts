import Phaser from 'phaser';
import { Player } from './Player';
import { ENEMY_STATS } from '../utils/constants';
import { TimeStopSystem } from '../systems/TimeStopSystem'; // Import TimeStopSystem type

export class Enemy extends Phaser.Physics.Arcade.Sprite {
    public health: number;
    private maxHealth: number;
    private speed: number;
    private attackRange: number;
    private attackDamage: number;
    private player: Player; // Reference to the player
    private timeStopSystem: TimeStopSystem; // Reference to the TimeStopSystem

    constructor(scene: Phaser.Scene, x: number, y: number, texture: string, player: Player, timeStopSystem: TimeStopSystem) {
        super(scene, x, y, texture);
        this.player = player;
        this.timeStopSystem = timeStopSystem; // Store the reference

        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.maxHealth = ENEMY_STATS.HEALTH;
        this.health = this.maxHealth;
        this.speed = ENEMY_STATS.SPEED;
        this.attackRange = ENEMY_STATS.ATTACK_RANGE;
        this.attackDamage = ENEMY_STATS.DAMAGE;

        this.setCollideWorldBounds(true);
        this.setImmovable(false); // Can be pushed slightly
    }

    takeDamage(amount: number) {
        this.health -= amount;
        console.log(`Enemy took ${amount} damage, ${this.health} HP left`);
        this.setTint(0xff0000); // Red flash
        this.scene.time.delayedCall(100, () => this.clearTint());

        if (this.health <= 0) {
            this.die();
        }
    }

    die() {
        console.log("Enemy defeated!");
        // Add death effects (particles, sound)
        this.destroy();
        // Potentially drop loot or grant experience
        // cultivationSystem.addExperience(10); // Example
    }

    update(time: number, delta: number): void {
        if (!this.active || !this.player.active) return; // Do nothing if inactive

        // --- Check if Time Stop is active ---
        if (this.timeStopSystem.isTimeStopped()) {
            // If time is stopped, freeze movement and AI
            this.setVelocity(0, 0);
            // Optionally pause animations here if they exist
            // this.anims.pause();
            return; // Skip normal AI update
        } else {
            // If time is not stopped, ensure animations are playing
            // this.anims.resume();
        }

        // --- Basic AI: Move towards player ---
        const distance = Phaser.Math.Distance.Between(this.x, this.y, this.player.x, this.player.y);

        if (distance < this.attackRange * 5) { // Engage range
            const angle = Phaser.Math.Angle.Between(this.x, this.y, this.player.x, this.player.y);
            this.scene.physics.velocityFromRotation(angle, this.speed, this.body?.velocity);

            // Basic Attack (simple proximity damage for demo)
            if (distance < this.attackRange) {
                // Add cooldown for attacks later
                 // this.player.takeDamage(this.attackDamage); // Placeholder direct damage
                // A better way is via overlap checks in GameScene
                 this.setVelocity(0, 0); // Stop moving when attacking
            }
        } else {
            this.setVelocity(0, 0); // Idle if player is too far
        }
    }
}