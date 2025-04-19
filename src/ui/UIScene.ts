import Phaser from "phaser";
import { usePlayerStore, PlayerState } from "@/state/player.store"; // Import PlayerState type
import RexUIPlugin from "phaser3-rex-plugins/templates/ui/ui-plugin";
import NumberBar from "phaser3-rex-plugins/templates/ui/numberbar/NumberBar";

export default class UIScene extends Phaser.Scene {
  rexUI!: RexUIPlugin; // RexUI instance - Keep for later

  // Example HUD elements
  private healthBar?: NumberBar;
  private qiBar?: NumberBar;
  private staminaBar?: NumberBar;

  private unsubscribe?: () => void; // To clean up Zustand subscription

  constructor() {
    super("UIScene");
  }

  create() {
    console.log("UIScene launched");

    // Defensive check after trying to install
    if (!this.rexUI) {
      console.error("REXUI PLUGIN FAILED TO INITIALIZE. Cannot create UI.");
      return;
    }

    const barWidth = 200;
    const barHeight = 20;
    const barX = 120; // Position bars slightly indented
    const barY = 30;
    const barSpacing = 30;
    const initialState = usePlayerStore.getState();

    // Basic Text HUD Example (replace with RexUI Bars/Labels later)
    this.healthBar = this.createStatBar(
      barX,
      barY,
      barWidth,
      barHeight,
      0xff4d4d,
      (v, m) => `HP: ${Math.round(v)} / ${m}`
    );
    this.qiBar = this.createStatBar(
      barX,
      barY + barSpacing,
      barWidth,
      barHeight,
      0x4d4dff,
      (v, m) => `QP: ${Math.round(v)} / ${m}`
    );
    this.staminaBar = this.createStatBar(
      barX,
      barY + barSpacing * 2,
      barWidth,
      barHeight,
      0x4dff4d,
      (v, m) => `SP: ${Math.round(v)} / ${m}`
    );

    this.add.existing(this.healthBar); // Add bars to the scene's display list
    this.add.existing(this.qiBar);
    this.add.existing(this.staminaBar);

    // --- Corrected Zustand Subscription ---

    // 1. Define the listener function - it receives the full state
    const hudUpdateListener = (state: PlayerState) => {
      // Now access the specific parts needed inside the listener
      this.updateHUD(
        state.coreStats.health,
        state.coreStats.qi,
        state.coreStats.stamina
      );
    };

    // 2. Subscribe using the listener function
    // The unsubscribe function is returned directly by subscribe
    this.unsubscribe = usePlayerStore.subscribe(hudUpdateListener);

    // 3. Get initial state *after* defining the listener and call it manually
    hudUpdateListener(initialState); // Update HUD with initial values

    if (this.healthBar && this.qiBar && this.staminaBar) {
      // Set initial max values for the text formatting callback
      this.healthBar.setData("maxValue", initialState.coreStats.health.max); // Store max on the object if needed by callback
      this.qiBar.setData("maxValue", initialState.coreStats.qi.max);
      this.staminaBar.setData("maxValue", initialState.coreStats.stamina.max);
      // Now call the listener which will use setValue
      hudUpdateListener(initialState);
    }

    // Add listeners for opening menus (e.g., Inventory, Character) later
    // this.input.keyboard.on('keydown-I', () => this.toggleInventoryMenu());
  }

  private createStatBar(
    x: number,
    y: number,
    width: number,
    height: number,
    color: number,
    textFormatCallback: (value: number, maxValue: number) => string
  ): NumberBar {
    const bar = this.rexUI.add
      .numberBar({
        x: x,
        y: y,
        width: width,
        height: height,
        background: this.rexUI.add.roundRectangle(
          0,
          0,
          0,
          0,
          height / 2,
          0x444444
        ),
        slider: {
          indicator: this.rexUI.add.roundRectangle(
            0,
            0,
            0,
            0,
            height / 2,
            color
          ),
          input: "click",
        },
        text: this.add.text(0, 0, "").setOrigin(0.5),
        space: { left: 5, right: 5, top: 5, bottom: 5 },

        valuechangeCallback: (newValueMappedTo01, _, numberBar: NumberBar) => {
          // *** Retrieve the actual game value and max value ***
          // We stored the actual max value using setData earlier, or get it from the latest update
          const actualMaxValue = numberBar.getData("maxValue") ?? 100; // Get stored max, default if missing
          // Calculate the actual current value based on the 0-1 scale
          const actualCurrentValue = newValueMappedTo01 * actualMaxValue;

          // Update the text using the actual game values
          numberBar.text = textFormatCallback(
            actualCurrentValue,
            actualMaxValue
          );
        },
        // Initial value is implicitly 0 (which maps to 0 on the 0-1 scale)
      })
      .setOrigin(0, 0.5)
      .layout();

    bar.setData("maxValue", 100); // Default max
    bar.setValue(0); // Set initial value to 0

    return bar;
  }

  // Update the values using setValue(value, min, max)
  private updateHUD(
    health: { current: number; max: number },
    qi: { current: number; max: number },
    stamina: { current: number; max: number }
  ) {
    if (this.healthBar) {
      // Store the current max value for the text callback
      this.healthBar.setData("maxValue", health.max);
      // Use setValue to update the bar's internal 0-1 value AND trigger the callback
      this.healthBar.setValue(health.current, 0, health.max);
    }
    if (this.qiBar) {
      this.qiBar.setData("maxValue", qi.max);
      this.qiBar.setValue(qi.current, 0, qi.max);
    }
    if (this.staminaBar) {
      this.staminaBar.setData("maxValue", stamina.max);
      this.staminaBar.setValue(stamina.current, 0, stamina.max);
    }
  }
  // Clean up subscription on scene shutdown (Correct Place)
  shutdown() {
    console.log("UIScene shutting down...");
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined; // Clear the reference
      console.log("Unsubscribed from Zustand store.");
    }
  }
}
