import Phaser from 'phaser';
import { ASSET_KEYS, PLAYER_STATS, REGISTRY_KEYS, INPUT_KEYS } from '../utils/constants';
import { Projectile } from './Projectile';
import { TimeStopSystem } from '../systems/TimeStopSystem'; // Import TimeStopSystem type

export class Player extends Phaser.Physics.Arcade.Sprite {
    public health: number;
    public maxHealth: number;
    public qi: number;
    public maxQi: number;

    private speed: number;
    private flightSpeed: number;
    private isFlying: boolean = false;
    private canBlink: boolean = true;
    private canAttack: boolean = true;

    private keys: { [key: string]: Phaser.Input.Keyboard.Key };
    private projectiles: Phaser.Physics.Arcade.Group; // Group to manage player projectiles
    private timeStopSystem: TimeStopSystem; // Reference to the TimeStopSystem

    constructor(scene: Phaser.Scene, x: number, y: number, timeStopSystem: TimeStopSystem) {
        super(scene, x, y, ASSET_KEYS.PLAYER);
        this.timeStopSystem = timeStopSystem; // Store reference

        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.maxHealth = PLAYER_STATS.HEALTH;
        this.health = this.maxHealth;
        this.maxQi = PLAYER_STATS.QI;
        this.qi = this.maxQi;
        this.speed = PLAYER_STATS.SPEED;
        this.flightSpeed = PLAYER_STATS.FLIGHT_SPEED;

        this.setCollideWorldBounds(true);
        this.setBounce(0.1);

        // Initialize Registry values
        this.scene.registry.set(REGISTRY_KEYS.PLAYER_HEALTH, this.health);
        this.scene.registry.set(REGISTRY_KEYS.PLAYER_MAX_HEALTH, this.maxHealth);
        this.scene.registry.set(REGISTRY_KEYS.PLAYER_QI, this.qi);
        this.scene.registry.set(REGISTRY_KEYS.PLAYER_MAX_QI, this.maxQi);

        // Input setup
        this.keys = this.scene.input.keyboard!.addKeys({
            up: INPUT_KEYS.UP,
            down: INPUT_KEYS.DOWN,
            left: INPUT_KEYS.LEFT,
            right: INPUT_KEYS.RIGHT,
            flight: INPUT_KEYS.FLIGHT_TOGGLE,
            blink: INPUT_KEYS.BLINK,
            attack: INPUT_KEYS.ATTACK, // Using 'E' for demo
            timeStop: INPUT_KEYS.TIME_STOP,
        }) as { [key: string]: Phaser.Input.Keyboard.Key };

        // Projectile Group
        this.projectiles = this.scene.physics.add.group({
            classType: Projectile,
            runChildUpdate: true, // Important for projectiles to update themselves
        });
    }

    getProjectiles(): Phaser.Physics.Arcade.Group {
        return this.projectiles;
    }

    consumeQi(amount: number): boolean {
        if (this.qi >= amount) {
            this.qi -= amount;
            this.scene.registry.set(REGISTRY_KEYS.PLAYER_QI, this.qi);
            return true;
        }
        return false;
    }

    restoreQi(amount: number) {
        this.qi = Math.min(this.maxQi, this.qi + amount);
        this.scene.registry.set(REGISTRY_KEYS.PLAYER_QI, this.qi);
    }

    takeDamage(amount: number) {
        // Add resilience calculations here later
        this.health -= amount;
        this.scene.registry.set(REGISTRY_KEYS.PLAYER_HEALTH, this.health);
        this.scene.cameras.main.shake(100, 0.01); // Camera shake on hit
        this.setTint(0xff0000); // Red flash
        this.scene.time.delayedCall(100, () => this.clearTint());

        console.log(`Player took ${amount} damage, ${this.health} HP left`);

        if (this.health <= 0) {
            this.die();
        }
    }

    die() {
        console.error("Player Died! Game Over (not implemented)");
        // Add proper game over handling (e.g., restart scene, show menu)
        this.setActive(false);
        this.setVisible(false);
        // Maybe stop the scene or transition
        // this.scene.scene.pause(SCENE_KEYS.GAME);
        // this.scene.scene.launch('GameOverScene');
    }

    private handleMovement(delta: number) {
        const currentSpeed = this.isFlying ? this.flightSpeed : this.speed;
        let velocityX = 0;
        let velocityY = 0;

        if (this.keys.left.isDown) velocityX = -currentSpeed;
        else if (this.keys.right.isDown) velocityX = currentSpeed;

        if (this.keys.up.isDown) velocityY = -currentSpeed;
        else if (this.keys.down.isDown) velocityY = currentSpeed;

        this.setVelocity(velocityX, velocityY);

        // Normalize diagonal movement
        if (velocityX !== 0 && velocityY !== 0) {
            this.body?.velocity.normalize().scale(currentSpeed);
        }

        // Stop movement if no keys pressed
        if (!this.keys.left.isDown && !this.keys.right.isDown && !this.keys.up.isDown && !this.keys.down.isDown) {
             this.setVelocity(0, 0);
        }
    }

    private handleActions() {
        // --- Flight Toggle ---
        if (Phaser.Input.Keyboard.JustDown(this.keys.flight)) {
            this.isFlying = !this.isFlying;
            console.log(`Flight Toggled: ${this.isFlying}`);
            // Add visual indicator for flight (e.g., tint, different sprite/animation)
            this.setTint(this.isFlying ? 0x00aaff : 0xffffff); // Blue tint for flying
            // In a real game: change collision layers, play effects, check cultivation level
        }

        // --- Blink / Short Teleport ---
        if (Phaser.Input.Keyboard.JustDown(this.keys.blink) && this.canBlink) {
            if (this.consumeQi(PLAYER_STATS.BLINK_COST)) {
                console.log("Blink!");
                this.canBlink = false;

                let targetX = this.x;
                let targetY = this.y;
                const moveDirection = this.body!.velocity.clone().normalize();

                if (moveDirection.length() > 0) {
                    // Blink in movement direction
                    targetX += moveDirection.x * PLAYER_STATS.BLINK_DISTANCE;
                    targetY += moveDirection.y * PLAYER_STATS.BLINK_DISTANCE;
                } else {
                    // Blink forward if standing still (assuming sprite rotation or facing direction)
                     // For simplicity, blink right if no direction
                     targetX += PLAYER_STATS.BLINK_DISTANCE;
                }

                // Add tween for visual effect? Or just teleport:
                this.setPosition(targetX, targetY);

                // Cooldown
                this.scene.time.delayedCall(PLAYER_STATS.BLINK_COOLDOWN, () => {
                    this.canBlink = true;
                });
            } else {
                console.log("Not enough Qi to Blink!");
                // Add feedback (sound, visual)
            }
        }

        // --- Basic Attack ---
        if (Phaser.Input.Keyboard.JustDown(this.keys.attack) && this.canAttack) {
            if (this.consumeQi(PLAYER_STATS.ATTACK_COST)) {
                this.canAttack = false;
                console.log("Attack!");

                // Determine attack direction (based on mouse or movement)
                // Simple: attack in last moved direction or default right
                const angle = this.body!.velocity.angle(); // Use velocity angle
                const projectileSpeed = 500;
                const projectileOffset = 30; // Distance from player center

                const startX = this.x + Math.cos(angle) * projectileOffset;
                const startY = this.y + Math.sin(angle) * projectileOffset;

                const projectile = this.projectiles.get(startX, startY, ASSET_KEYS.PROJECTILE, 10) as Projectile; // Damage: 10
                if (projectile) {
                    projectile.setActive(true);
                    projectile.setVisible(true);
                    this.scene.physics.velocityFromRotation(angle, projectileSpeed, projectile.body!.velocity);
                }

                // Cooldown
                this.scene.time.delayedCall(PLAYER_STATS.ATTACK_COOLDOWN, () => {
                    this.canAttack = true;
                });
            } else {
                console.log("Not enough Qi to Attack!");
            }
        }

        // --- Time Stop ---
        if (Phaser.Input.Keyboard.JustDown(this.keys.timeStop)) {
             this.timeStopSystem.activate();
        }
    }

    update(time: number, delta: number): void {
        if (!this.active) return;

        // Regenerate Qi slowly over time (example)
        // Needs to be delta-time based for consistency
        this.restoreQi(0.1 * (delta / 16.66)); // ~6 Qi per second at 60fps

        this.handleMovement(delta);
        this.handleActions();

        // Update registry continuously (if needed, otherwise just on change)
        // this.scene.registry.set(REGISTRY_KEYS.PLAYER_QI, this.qi);
        // this.scene.registry.set(REGISTRY_KEYS.PLAYER_HEALTH, this.health);
    }
}