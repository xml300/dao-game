import Phaser from 'phaser';
import { SCENE_KEYS, ASSET_KEYS } from '../utils/constants';

export class PreloaderScene extends Phaser.Scene {
    constructor() {
        super(SCENE_KEYS.PRELOADER);
    }

    preload() {
        console.log("PreloaderScene: Preload");

        // Display a loading bar / text
        const { width, height } = this.scale;
        const progressBar = this.add.graphics();
        const progressBox = this.add.graphics();
        progressBox.fillStyle(0x222222, 0.8);
        progressBox.fillRect(width / 4, height / 2 - 30, width / 2, 50);

        const loadingText = this.make.text({
            x: width / 2,
            y: height / 2 - 50,
            text: 'Loading...',
            style: { font: '20px monospace', color: '#ffffff' }
        }).setOrigin(0.5, 0.5);

        const percentText = this.make.text({
            x: width / 2,
            y: height / 2 - 5,
            text: '0%',
            style: { font: '18px monospace', color: '#ffffff' }
        }).setOrigin(0.5, 0.5);

        // Listen to progress event
        this.load.on('progress', (value: number) => {
            percentText.setText(parseInt(String(value * 100)) + '%');
            progressBar.clear();
            progressBar.fillStyle(0xffffff, 1);
            progressBar.fillRect(width / 4 + 10, height / 2 - 20, (width / 2 - 20) * value, 30);
        });

        // Listen to complete event
        this.load.on('complete', () => {
            console.log("PreloaderScene: Load Complete");
            progressBar.destroy();
            progressBox.destroy();
            loadingText.destroy();
            percentText.destroy();
            this.startGame();
        });

        // --- Load Assets ---
        this.load.image(ASSET_KEYS.PLAYER, 'assets/images/player.png'); // Ensure you have these files
        this.load.image(ASSET_KEYS.ENEMY, 'assets/images/enemy.png');
        this.load.image(ASSET_KEYS.PROJECTILE, 'assets/images/projectile.png');
        this.load.image(ASSET_KEYS.BACKGROUND, 'assets/images/background.png'); // A tileable background is good

        // Load audio if needed
        // this.load.audio('theme', 'assets/audio/theme.mp3');
    }

    startGame() {
        // Start the main game scene and the UI scene in parallel
        console.log("Starting Game and UI scenes...");
        this.scene.start(SCENE_KEYS.GAME);
        this.scene.start(SCENE_KEYS.UI);
    }
}