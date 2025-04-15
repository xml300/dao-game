import Phaser from 'phaser';

export class Projectile extends Phaser.Physics.Arcade.Sprite {
    private damage: number;
    private lifeSpan: number;
    private timer: Phaser.Time.TimerEvent | null = null;

    constructor(scene: Phaser.Scene, x: number, y: number, texture: string, damage: number, lifeSpan: number = 1000) {
        super(scene, x, y, texture);
        this.damage = damage;
        this.lifeSpan = lifeSpan;

        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.setCollideWorldBounds(true); // Or handle destruction on bounds collision
        (this.body as Phaser.Physics.Arcade.Body).onWorldBounds = true;

        this.timer = this.scene.time.delayedCall(this.lifeSpan, () => {
            this.destroy();
        });

        // Handle world bounds collision
        this.scene.physics.world.on('worldbounds', (body: Phaser.Physics.Arcade.Body) => {
            if (body.gameObject === this) {
                this.destroy();
            }
        });
    }

    getDamage(): number {
        return this.damage;
    }

    // Override destroy to clean up timer
    destroy(fromScene?: boolean): void {
        if (this.timer) {
            this.timer.remove(false); // Remove timer without firing callback
            this.timer = null;
        }
        super.destroy(fromScene);
    }
}