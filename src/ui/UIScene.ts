import Phaser from 'phaser';
import { usePlayerStore, PlayerState } from '@/state/player.store'; // Import PlayerState type 

// Define the type for the selected slice of state we care about
type SelectedCoreStats = Pick<PlayerState, 'coreStats'>['coreStats'];

export default class UIScene extends Phaser.Scene {
    // rexUI?: RexUIPlugin; // RexUI instance - Keep for later

    // Example HUD elements
    private healthText?: Phaser.GameObjects.Text;
    private qiText?: Phaser.GameObjects.Text;
    private staminaText?: Phaser.GameObjects.Text;

    private unsubscribe?: () => void; // To clean up Zustand subscription

    constructor() {
        super('UIScene');
    }

    preload() {
        // Load UI specific assets if not loaded globally
        // Load RexUI plugin here if it's only used in UI
        // this.load.plugin('rexuiplugin', 'path/to/rexuiplugin.min.js', true); // Check RexUI docs
    }

    create() {
        console.log('UIScene launched');
        // this.rexUI = this.plugins.get('rexuiplugin') as RexUIPlugin; // Get RexUI instance

        // Basic Text HUD Example (replace with RexUI Bars/Labels later)
        this.healthText = this.add.text(10, 10, '', { fontSize: '16px', color: '#ff0000', stroke: '#000000', strokeThickness: 2 });
        this.qiText = this.add.text(10, 30, '', { fontSize: '16px', color: '#8888ff', stroke: '#000000', strokeThickness: 2 });
        this.staminaText = this.add.text(10, 50, '', { fontSize: '16px', color: '#00cc00', stroke: '#000000', strokeThickness: 2 });

        // --- Corrected Zustand Subscription ---

        // 1. Define the listener function - it receives the full state
        const listener = (state: PlayerState) => {
            // Access the parts of the state needed within the listener
            this.updateHUD(state.coreStats.health, state.coreStats.qi, state.coreStats.stamina);
        };

        // 3. Get initial state and call listener manually
        const initialState = usePlayerStore.getState();
        listener(initialState); // Fire immediately using the listener

        // 4. Subscribe using the standard signature
        this.unsubscribe = usePlayerStore.subscribe(listener);

        // Add listeners for opening menus (e.g., Inventory, Character) later
        // this.input.keyboard.on('keydown-I', () => this.toggleInventoryMenu());
    }

    // Helper to update HUD text elements
    private updateHUD(
        health: { current: number; max: number },
        qi: { current: number; max: number },
        stamina: { current: number; max: number }
    ) {
        this.healthText?.setText(`HP: ${health.current} / ${health.max}`);
        this.qiText?.setText(`QP: ${qi.current} / ${qi.max}`);
        this.staminaText?.setText(`SP: ${stamina.current} / ${stamina.max}`);
    }

    // Clean up subscription on scene shutdown (Correct Place)
    shutdown() {
        this.unsubscribe?.();
        this.unsubscribe = undefined; // Clear reference
        console.log('UIScene shutdown, unsubscribed from store');
        this.shutdown(); // Call super shutdown if needed (usually not necessary unless extending a class that needs it)
    }

    // REMOVED the incorrect destroy method override
}