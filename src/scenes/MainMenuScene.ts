import Phaser from 'phaser';

export default class MainMenuScene extends Phaser.Scene {
    constructor() {
        super('MainMenuScene');
    }

    create() {
        const { width, height } = this.scale;

        // Basic background
        this.add.image(width / 2, height / 2, 'main_menu_bg').setDisplaySize(width, height);

        // Title
        this.add.text(width / 2, height * 0.2, 'Ascension: Echoes of the Dao', {
            fontSize: '48px',
            color: '#ffffff',
            // Add font family if loaded
        }).setOrigin(0.5);

        // Start Button Example
        const startButton = this.add.text(width / 2, height * 0.6, 'Start Journey', {
            fontSize: '32px',
            color: '#aaaaaa',
            backgroundColor: '#333333',
            padding: { left: 15, right: 15, top: 10, bottom: 10 }
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

        startButton.on('pointerover', () => startButton.setColor('#ffffff'));
        startButton.on('pointerout', () => startButton.setColor('#aaaaaa'));
        startButton.on('pointerdown', () => {
            console.log('Starting game...');
            // TDD 2.3: Start GameScene and launch UIScene in parallel
            this.scene.start('GameScene'); // Start the main game scene
            this.scene.launch('UIScene'); // Launch the UI scene to run alongside
        });

        // Add other buttons (Load Game, Options, Exit) later
    }
}