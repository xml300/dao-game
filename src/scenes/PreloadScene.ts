import Phaser from 'phaser';
import RexUIPlugin from "phaser3-rex-plugins/templates/ui/ui-plugin.js";
import * as AssetKeys from '@/constants/assets';

export default class PreloadScene extends Phaser.Scene {
    constructor() {
        super(AssetKeys.Scenes.PRELOAD);
    }

    preload() {
        // TDD 2.6: Display a loading bar
        const { width, height } = this.scale;
        const progressBar = this.add.graphics();
        const progressBox = this.add.graphics();
        progressBox.fillStyle(0x222222, 0.8);
        progressBox.fillRect(width / 2 - 160, height / 2 - 25, 320, 50);

        const loadingText = this.make.text({
            x: width / 2,
            y: height / 2 - 50,
            text: 'Loading...',
            style: { font: '20px monospace', color: '#ffffff' }
        }).setOrigin(0.5, 0.5);

        const percentText = this.make.text({
            x: width / 2,
            y: height / 2,
            text: '0%',
            style: { font: '18px monospace', color: '#ffffff' }
        }).setOrigin(0.5, 0.5);

        const assetText = this.make.text({
            x: width / 2,
            y: height / 2 + 50,
            text: '',
            style: { font: '18px monospace', color: '#ffffff' }
        }).setOrigin(0.5, 0.5);

        this.load.on('progress', (value: number) => {
            percentText.setText(parseInt(String(value * 100), 10) + '%');
            progressBar.clear();
            progressBar.fillStyle(0xffffff, 1);
            progressBar.fillRect(width / 2 - 150, height / 2 - 15, 300 * value, 30);
        });

        this.load.on('fileprogress', (file: Phaser.Loader.File) => {
            assetText.setText('Loading asset: ' + file.key);
        });

        this.load.on('complete', () => {
            progressBar.destroy();
            progressBox.destroy();
            loadingText.destroy();
            percentText.destroy();
            assetText.destroy();
            this.scene.start(AssetKeys.Scenes.MAIN_MENU); // Or initial game scene if skipping menu
        });

        // --- Load Essential Global Assets (TDD 2.6) ---
        // Examples - replace with actual asset paths in public/assets/
        this.load.image('placeholder_player', 'assets/images/placeholder_player.png');
        this.load.image('placeholder_enemy', 'assets/images/placeholder_enemy.png');
        // this.load.atlas('ui_icons', 'assets/atlases/ui_icons.png', 'assets/atlases/ui_icons.json'); // Example Atlas
        // this.load.audio('ui_click', 'assets/audio/sfx/ui_click.ogg'); // Example Audio

        // --- Load Initial Scene Assets ---
        // Example: Assets needed for MainMenuScene or the starting GameScene area
        this.load.image('main_menu_bg', 'assets/images/main_menu_bg.png');

        // Load RexUI plugin if used globally (or load in UIScene if only used there)
        // Assuming RexUI is imported correctly - check RexUI docs for setup
        // this.load.plugin('rexUI', RexUIPlugin, true); // Check RexUI docs for correct loading


    }

    create() {
        // Scene transition is handled by the 'complete' event handler in preload()
        console.log('PreloadScene complete, transitioning...');
    }
}