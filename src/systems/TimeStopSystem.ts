import { GameScene } from '../scenes/GameScene';
import { REGISTRY_KEYS, PLAYER_STATS } from '../utils/constants';

export class TimeStopSystem {
    private scene: GameScene;
    private isActive: boolean = false;
    private cooldownTimer: Phaser.Time.TimerEvent | null = null;
    private durationTimer: Phaser.Time.TimerEvent | null = null;

    constructor(scene: GameScene) {
        this.scene = scene;
        this.scene.registry.set(REGISTRY_KEYS.TIME_STOP_READY, true);
        this.scene.registry.set(REGISTRY_KEYS.TIME_STOP_ACTIVE, false);
    }

    canActivate(): boolean {
        return this.scene.registry.get(REGISTRY_KEYS.TIME_STOP_READY) && !this.isActive;
    }

    activate(): boolean {
        if (!this.canActivate() || !this.scene.player) {
            return false;
        }

        const currentQi = this.scene.registry.get(REGISTRY_KEYS.PLAYER_QI) || 0;
        if (currentQi < PLAYER_STATS.TIME_STOP_COST) {
            console.log("Not enough Qi for Time Stop!");
            // Add visual/audio feedback if possible
            return false;
        }

        console.log('TIME STOP ACTIVATED!');
        this.isActive = true;
        this.scene.registry.set(REGISTRY_KEYS.TIME_STOP_ACTIVE, true);
        this.scene.registry.set(REGISTRY_KEYS.TIME_STOP_READY, false); // On cooldown now

        // Reduce Player Qi
        this.scene.player.consumeQi(PLAYER_STATS.TIME_STOP_COST);

        // --- Apply Effect ---
        // Slow down enemies
        this.scene.enemies?.getChildren().forEach((enemyGO) => {
            const enemy = enemyGO as Phaser.Physics.Arcade.Sprite;
            if (enemy.body) {
                 // Store original speed if needed for restoration
                (enemy as any).originalVelocityX = enemy.body.velocity.x;
                (enemy as any).originalVelocityY = enemy.body.velocity.y;
                enemy.setVelocity(0, 0); // Stop them
                enemy.setTint(0xaaaaaa); // Visual indicator (grayscale)
                // Potentially pause animations too: enemy.anims.pause();
            }
        });

        // Slow down enemy projectiles (if any) - requires a projectile group
        // this.scene.enemyProjectiles?.getChildren().forEach(...)

        // Set timer to end the effect
        this.durationTimer = this.scene.time.delayedCall(PLAYER_STATS.TIME_STOP_DURATION, this.deactivate, [], this);

        // Set cooldown timer
        this.cooldownTimer = this.scene.time.delayedCall(PLAYER_STATS.TIME_STOP_COOLDOWN, () => {
            console.log('Time Stop Ready!');
            this.scene.registry.set(REGISTRY_KEYS.TIME_STOP_READY, true);
            this.cooldownTimer = null;
        }, [], this);

        // Optional: Add screen effect (e.g., tint, post-processing pipeline)
        this.scene.cameras.main.flash(300, 150, 150, 150); // Simple flash effect

        return true;
    }

    deactivate() {
        if (!this.isActive) return;

        console.log('TIME STOP DEACTIVATED.');
        this.isActive = false;
        this.scene.registry.set(REGISTRY_KEYS.TIME_STOP_ACTIVE, false);
        this.durationTimer = null; // Clear duration timer

        // --- Remove Effect ---
        // Restore enemy speed/state
        this.scene.enemies?.getChildren().forEach((enemyGO) => {
            const enemy = enemyGO as Phaser.Physics.Arcade.Sprite;
            if (enemy.body) {
                // Restore velocity (or let AI recalculate)
                 // enemy.setVelocity((enemy as any).originalVelocityX ?? 0, (enemy as any).originalVelocityY ?? 0);
                 // Simpler: Let AI take over again in next update
                enemy.clearTint();
                // Resume animations: enemy.anims.resume();
            }
        });

        // Restore projectile speed (if any)

        // Optional: Remove screen effect
        // this.scene.cameras.main.clearFlash(); // Or remove pipeline

        // Optional: Apply self-debuff (e.g., slowed Qi regen) - requires more logic
    }

    update() {
        // Can add checks here if needed, but most logic is timer-based
    }

    isTimeStopped(): boolean {
        return this.isActive;
    }
}