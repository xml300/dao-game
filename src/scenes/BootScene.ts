import Phaser from 'phaser';
import { SCENE_KEYS } from '../utils/constants';

export class BootScene extends Phaser.Scene {
    constructor() {
        super(SCENE_KEYS.BOOT);
    }

    preload() {
        // Load assets needed for the Preloader scene (e.g., loading bar graphics)
        console.log("BootScene: Preload");
    }

    create() {
        console.log("BootScene: Create - Starting Preloader");
        this.scene.start(SCENE_KEYS.PRELOADER);
    }
}