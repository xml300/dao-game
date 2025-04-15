import Phaser from 'phaser';
import { SCENE_KEYS, REGISTRY_KEYS } from '../utils/constants';

export class UIScene extends Phaser.Scene {
    private healthBar!: Phaser.GameObjects.Graphics;
    private healthText!: Phaser.GameObjects.Text;
    private qiBar!: Phaser.GameObjects.Graphics;
    private qiText!: Phaser.GameObjects.Text;
    private timeStopStatusText!: Phaser.GameObjects.Text;

    constructor() {
        super({ key: SCENE_KEYS.UI, active: false }); // Start inactive, GameScene will start it
    }

    create() {
        console.log("UIScene: Create");
        const barWidth = 200;
        const barHeight = 20;

        // --- Health Bar ---
        this.healthBar = this.add.graphics();
        this.add.text(10, 10, 'HP', { fontSize: '16px', color: '#ff0000' });
        this.healthText = this.add.text(10 + barWidth + 10, 15, '', { fontSize: '14px', color: '#ffffff' }).setOrigin(0, 0.5);

        // --- Qi Bar ---
        this.qiBar = this.add.graphics();
        this.add.text(10, 40, 'Qi', { fontSize: '16px', color: '#00aaff' });
        this.qiText = this.add.text(10 + barWidth + 10, 45, '', { fontSize: '14px', color: '#ffffff' }).setOrigin(0, 0.5);

        // --- Time Stop Status ---
        this.timeStopStatusText = this.add.text(this.scale.width - 10, 10, 'Time Stop: READY', { fontSize: '16px', color: '#00ff00', align: 'right' }).setOrigin(1, 0);


        // --- Listen for Registry Changes ---
        // Use the main game scene's registry (common practice when scenes run in parallel)
        const gameSceneRegistry = this.scene.get(SCENE_KEYS.GAME).registry;

        gameSceneRegistry.events.on('changedata', this.updateUI, this);

        // Initialize UI with current values
        this.updateUI();
    }

    updateUI() {
        const gameSceneRegistry = this.scene.get(SCENE_KEYS.GAME)?.registry;
        if (!gameSceneRegistry) return; // Scene might not be ready yet

        const currentHealth = gameSceneRegistry.get(REGISTRY_KEYS.PLAYER_HEALTH) || 0;
        const maxHealth = gameSceneRegistry.get(REGISTRY_KEYS.PLAYER_MAX_HEALTH) || 1;
        const currentQi = gameSceneRegistry.get(REGISTRY_KEYS.PLAYER_QI) || 0;
        const maxQi = gameSceneRegistry.get(REGISTRY_KEYS.PLAYER_MAX_QI) || 1;
        const timeStopReady = gameSceneRegistry.get(REGISTRY_KEYS.TIME_STOP_READY);
        const timeStopActive = gameSceneRegistry.get(REGISTRY_KEYS.TIME_STOP_ACTIVE);

        const barWidth = 200;
        const barHeight = 20;

        // Update Health Bar
        this.healthBar.clear();
        this.healthBar.fillStyle(0x555555); // Background
        this.healthBar.fillRect(40, 10, barWidth, barHeight);
        this.healthBar.fillStyle(0xff0000); // Foreground (HP color)
        this.healthBar.fillRect(40, 10, barWidth * (currentHealth / maxHealth), barHeight);
        this.healthText.setText(`${Math.max(0, Math.round(currentHealth))} / ${maxHealth}`);

        // Update Qi Bar
        this.qiBar.clear();
        this.qiBar.fillStyle(0x555555); // Background
        this.qiBar.fillRect(40, 40, barWidth, barHeight);
        this.qiBar.fillStyle(0x00aaff); // Foreground (Qi color)
        this.qiBar.fillRect(40, 40, barWidth * (currentQi / maxQi), barHeight);
        this.qiText.setText(`${Math.max(0, Math.round(currentQi))} / ${maxQi}`);

         // Update Time Stop Status
        if (timeStopActive) {
            this.timeStopStatusText.setText('Time Stop: ACTIVE');
            this.timeStopStatusText.setColor('#ffaa00'); // Orange when active
        } else if (timeStopReady) {
            this.timeStopStatusText.setText('Time Stop: READY');
            this.timeStopStatusText.setColor('#00ff00'); // Green when ready
        } else {
            this.timeStopStatusText.setText('Time Stop: COOLDOWN');
            this.timeStopStatusText.setColor('#ff0000'); // Red when on cooldown
        }
    }
}