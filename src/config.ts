import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { PreloaderScene } from './scenes/PreloaderScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';

export const gameConfig: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO, // AUTO selects WebGL if available, otherwise Canvas
    width: 2048,
    height: 1024,
    parent: 'game-container', // Matches the div id in index.html
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { x:0, y: 0 }, // Top-down, no gravity
            debug: false, // Set to true for physics debugging visuals
        },
    },
    scene: [BootScene, PreloaderScene, GameScene, UIScene],
    scale: {
        mode: Phaser.Scale.FIT, // Fit to window
        autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    render: {
        pixelArt: false, // Set to true if using pixel art assets
        antialias: true,
    },
    backgroundColor: '#1a1a1a',
};