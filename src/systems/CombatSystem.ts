import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { Projectile } from '../entities/Projectile';

export class CombatSystem {
    private scene: Phaser.Scene;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    setupCollisions(player: Player, enemies: Phaser.Physics.Arcade.Group) {
        // Player Projectiles vs Enemies
        this.scene.physics.add.overlap(player.getProjectiles(), enemies, this.handleProjectileHitEnemy, undefined, this);

        // Enemies vs Player (simple proximity damage handled by overlap)
        this.scene.physics.add.overlap(player, enemies, this.handleEnemyHitPlayer, undefined, this);
    }

    private handleProjectileHitEnemy(projectile: Phaser.GameObjects.GameObject, enemy: Phaser.GameObjects.GameObject) {
        const proj = projectile as Projectile;
        const en = enemy as Enemy;

        if (!proj.active || !en.active) return; // Prevent multiple hits from same projectile

        en.takeDamage(proj.getDamage());
        proj.destroy(); // Destroy projectile on hit
    }

    private handleEnemyHitPlayer(player: Phaser.GameObjects.GameObject, enemy: Phaser.GameObjects.GameObject) {
        const p = player as Player;
        const en = enemy as Enemy;

        if (!p.active || !en.active) return;

        // Apply damage from enemy - add cooldown here to prevent rapid damage
        // For simplicity, we apply damage directly. A real system needs timers.
        // Check if enemy is currently attacking and if player is not invulnerable (e.g., after being hit)
        // For this basic version, let's assume direct damage on touch, which is not ideal.
        // A better approach: Enemy triggers an 'attack' state, creates a hitbox/timer,
        // and only then does the overlap cause damage.
        // p.takeDamage(ENEMY_STATS.DAMAGE); // This would cause instant death on touch

         // --- TEMPORARY: Add a simple cooldown on player side after being hit ---
        if (!(p as any).isInvulnerable) {
            p.takeDamage((en as any).attackDamage || 10); // Use enemy's damage property if available
            (p as any).isInvulnerable = true;
            p.setAlpha(0.5); // Visual feedback for invulnerability
            p.scene.time.delayedCall(500, () => { // 500ms invulnerability
                (p as any).isInvulnerable = false;
                p.setAlpha(1.0);
            });
        }
    }
}