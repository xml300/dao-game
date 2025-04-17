import Phaser from 'phaser';
import PreloadScene from '@/scenes/PreloadScene';
import MainMenuScene from '@/scenes/MainMenuScene';
import GameScene from '@/scenes/GameScene';
import UIScene from '@/ui/UIScene'; // Correct path for UIScene

const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO, // Use WebGL if available, otherwise Canvas
    width: 1280, // Example resolution
    height: 720,
    parent: 'game-container', // Matches div id in index.html
    backgroundColor: '#000000',
    physics: {
        default: 'arcade', // TDD 4.4: Using Arcade Physics
        arcade: {
            gravity: { x: 0, y: 0 }, // TDD 4.4: Top-down/side-view combat likely needs 0 or low gravity initially
            debug: import.meta.env.DEV, // TDD 11.4: Enable debug drawing in development
        },
    },
    scale: {
        mode: Phaser.Scale.FIT, // TDD 8.5: Example scaling mode (FIT or RESIZE)
        autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [
        PreloadScene, // TDD 2.6: Start with PreloadScene
        MainMenuScene, // TDD 2.3 (Specialized Scene)
        GameScene,     // TDD 2.3 (Main Game Scene)
        UIScene        // TDD 2.3 (Parallel UI Scene)
    ],
    // TDD 9.2: Register custom PostFX pipelines here if needed globally
    // pipeline: { }
};

// Initialize the game
const game = new Phaser.Game(config);

export default game;