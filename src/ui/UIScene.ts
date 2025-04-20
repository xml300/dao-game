import Phaser from "phaser";
import { usePlayerStore, PlayerState } from "@/state/player.store"; // Import PlayerState type
import RexUIPlugin from "phaser3-rex-plugins/templates/ui/ui-plugin";
import NumberBar from "phaser3-rex-plugins/templates/ui/numberbar/NumberBar";
import Sizer from "phaser3-rex-plugins/templates/ui/sizer/Sizer"; // Import Sizer
import Label from "phaser3-rex-plugins/templates/ui/label/Label"; // Import Label
import Dialog from "phaser3-rex-plugins/templates/ui/dialog/Dialog"; // Import Dialog
import Tabs from "phaser3-rex-plugins/templates/ui/tabs/Tabs"; // Import Tabs
import FixWidthSizer from "phaser3-rex-plugins/templates/ui/fixwidthsizer/FixWidthSizer"; // For button layout etc.
import * as AssetKeys from "@/constants/assets";
import { calculateAspectEnhancementCost, SOUL_ASPECT_BASE_QI_COST } from "@/config/progression";
import { SoulAspectType } from "@/types"; // Ensure SoulAspectType is defined and exported

export default class UIScene extends Phaser.Scene {
  rexUI!: RexUIPlugin; // RexUI instance - Keep for later

  // Example HUD elements
  private healthBar?: NumberBar;
  private qiBar?: NumberBar;
  private staminaBar?: NumberBar;

  // Cultivation Menu elements
  private cultivationMenu?: Dialog; // Use Dialog for easy show/hide and modal behavior
  private realmNameLabel?: Label;
  private realmProgressBar?: NumberBar;
  private aspectLabels: Partial<Record<SoulAspectType, Label>> = {}; // Store aspect labels
  private aspectEnhanceButtons: Partial<Record<SoulAspectType, Label>> = {}; // Store enhance buttons
  private qiInfoLabel?: Label; // To show current Qi for cost comparison
  private breakthroughButton?: Label;

  private unsubscribe?: () => void; // To clean up Zustand subscription
  private cultivationMenuKey?: Phaser.Input.Keyboard.Key; // Input key for the menu

  constructor() {
    super(AssetKeys.Scenes.UI);
  }

  create() {
    console.log("UIScene launched");

    // Defensive check after trying to install
    if (!this.rexUI) {
      console.error("REXUI PLUGIN FAILED TO INITIALIZE. Cannot create UI.");
      return;
    }

    // --- Create HUD (as before) ---
    this.createHUD();

    // --- Create Cultivation Menu (but hidden initially) ---
    this.cultivationMenu = this.createCultivationMenu();
    this.cultivationMenu.setVisible(false).layout(); // Start hidden

    // --- Setup Input for Menu Toggle ---
    this.cultivationMenuKey = this.input.keyboard?.addKey(
      Phaser.Input.Keyboard.KeyCodes.C
    ); // 'C' for Cultivation

    // --- Zustand Subscription (as before) ---
    this.setupZustandSubscription();

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

  update(time: number, delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.cultivationMenuKey!)) {
      this.toggleCultivationMenu();
    }
  }

   // --- Function to Create HUD ---
   private createHUD() {
    const barWidth = 200;
    const barHeight = 20;
    const barX = 120;
    const barY = 30;
    const barSpacing = 30;

    this.healthBar = this.createStatBar(barX, barY, barWidth, barHeight, 0xff4d4d, (v, m) => `HP: ${Math.round(v)} / ${m}`);
    this.qiBar = this.createStatBar(barX, barY + barSpacing, barWidth, barHeight, 0x4d4dff, (v, m) => `QP: ${Math.round(v)} / ${m}`);
    this.staminaBar = this.createStatBar(barX, barY + barSpacing * 2, barWidth, barHeight, 0x4dff4d, (v, m) => `SP: ${Math.round(v)} / ${m}`);

    this.add.existing(this.healthBar);
    this.add.existing(this.qiBar);
    this.add.existing(this.staminaBar);
    console.log("HUD created.");
}

// --- Function to Setup Zustand Subscription ---
private setupZustandSubscription() {
   const hudUpdateListener = (state: PlayerState) => {
       // Update HUD
       this.updateHUD(state.coreStats.health, state.coreStats.qi, state.coreStats.stamina);
       // Update Cultivation Menu if it's visible/created
       if (this.cultivationMenu?.visible) {
           this.updateCultivationMenuContent(state);
       }
   };

   this.unsubscribe = usePlayerStore.subscribe(hudUpdateListener);
   // Update with initial state
   hudUpdateListener(usePlayerStore.getState());
   console.log("Zustand subscription setup.");
}


// --- Function to Create the Cultivation Menu Dialog ---
private createCultivationMenu(): Dialog {
   const { width, height } = this.scale;
   const dialogWidth = width * 0.6;
   const dialogHeight = height * 0.7;

   const menu = this.rexUI.add.dialog({
       x: width / 2,
       y: height / 2,
       width: dialogWidth,
       height: dialogHeight,

       background: this.rexUI.add.roundRectangle(0, 0, 100, 100, 20, 0x1a1a1a, 0.9).setStrokeStyle(2, 0xaaaaaa),

       title: this.rexUI.add.label({
           background: this.rexUI.add.roundRectangle(0, 0, 100, 40, 10, 0x003355),
           text: this.add.text(0, 0, 'Cultivation Path', { fontSize: '24px', color: '#ffffff' }),
           space: { left: 15, right: 15, top: 10, bottom: 10 }
       }),

       content: this.createCultivationMenuContentSizer(), // Separate function for content

       actions: [ // Close button
            this.createButton('Close')
       ],

       space: { title: 25, content: 25, action: 15, left: 20, right: 20, top: 20, bottom: 20 },

       expand: { content: true } // Allow content sizer to expand vertically
   })
   .layout();
   // .setDraggable('background') // Optional: Make draggable

   menu.on('button.click', (button: any, groupName: string, index: number) => {
       if (button.text === 'Close') {
           this.toggleCultivationMenu(); // Close the dialog
       }
   }, this);

   return menu;
}

// --- Function to Create the Content Area Sizer ---
private createCultivationMenuContentSizer(): Sizer {
   const sizer = this.rexUI.add.sizer({
       orientation: 'y', // Vertical layout
       space: { item: 15 } // Space between sections
   });

   // 1. Realm Section
   sizer.add(this.createRealmSection(), { expand: false, align: 'center' }); // Don't expand realm section vertically

   // 2. Soul Aspects Section
   sizer.add(this.createSoulAspectsSection(), { expand: false, align: 'center' }); // Adjust expand as needed

   // 3. Dao Comprehension Section (Placeholder)
   sizer.add(this.createDaoSection(), { expand: false, align: 'center' });

   // 4. Breakthrough Section
   sizer.add(this.createBreakthroughSection(), { expand: false, align: 'center', paddingTop: 20});

   return sizer;
}

// --- Create Realm Info Section ---
private createRealmSection(): Sizer {
   const sizer = this.rexUI.add.sizer({ orientation: 'y', space: { item: 8 }, name: 'realmSection' }); // Give it a name

   this.realmNameLabel = this.rexUI.add.label({
        text: this.add.text(0, 0, 'Realm: Loading...', { fontSize: '20px', color: '#cccccc' }),
        name: 'realmName'
    });

   this.realmProgressBar = this.rexUI.add.numberBar({
       width: 300, height: 15,
       background: this.rexUI.add.roundRectangle(0, 0, 0, 0, 8, 0x333333),
       slider: { indicator: this.rexUI.add.roundRectangle(0, 0, 0, 0, 8, 0x88ddff) },
       valuechangeCallback: (value, max, t) => {
           // Update text display if needed, maybe on the bar itself or a separate label
            if (this.realmNameLabel) { // Example: update text on the main label
                const state = usePlayerStore.getState(); // Get latest state for formatting
                this.realmNameLabel.text = `${state.realm} (${Math.round(state.realmProgress)}/${state.realmProgressMax})`;
            }
       },
       name: 'realmProgress'
   });

   sizer.add(this.realmNameLabel);
   sizer.add(this.realmProgressBar);

   return sizer;
}

// --- Create Soul Aspects Section ---
private createSoulAspectsSection(): Sizer {
   const sizer = this.rexUI.add.sizer({ orientation: 'y', space: { item: 10 }, name: 'aspectSection' });
   sizer.add(this.add.text(0,0, '--- Soul Aspects ---', { fontSize: '18px', color: '#aaaaaa'}), {align: 'center'});

   // Label to show current Qi
   this.qiInfoLabel = this.rexUI.add.label({
       text: this.add.text(0,0, 'Current Qi: -', { fontSize: '16px', color: '#aaddff'}),
       name: 'qiInfo'
   });
   sizer.add(this.qiInfoLabel, { align: 'center'});

   const aspectTypes: SoulAspectType[] = ['resilience', 'perception', 'affinity', 'purity'];
   aspectTypes.forEach(aspect => {
       const aspectRow = this.rexUI.add.sizer({ orientation: 'x', space: { item: 15 }, name: `aspectRow_${aspect}`});

       // Aspect Name & Level Label
       this.aspectLabels[aspect] = this.rexUI.add.label({
           width: 250, // Fixed width for alignment
           text: this.add.text(0, 0, `${capitalize(aspect)}: - (Cost: ${SOUL_ASPECT_BASE_QI_COST} Qi)`, { fontSize: '16px', color: '#dddddd'}),
           space: { left: 5 },
           name: `aspectLabel_${aspect}`
       });

       // Enhance Button ("+")
       this.aspectEnhanceButtons[aspect] = this.createButton('+')
           .setName(`enhanceBtn_${aspect}`) // Give button a name
           .setData('aspectType', aspect); // Store aspect type on the button

       aspectRow.add(this.aspectLabels[aspect]!, { align: 'left'});
       aspectRow.add(this.aspectEnhanceButtons[aspect]!, { align: 'right'});

       sizer.add(aspectRow, { expand: true }); // Allow row to expand horizontally
   });

   // Handle button clicks
   sizer.on('button.click', (button: Label, index: number, pointer: Phaser.Input.Pointer, event: any) => {
       const aspect = button.getData('aspectType') as SoulAspectType | undefined;
       if (aspect) {
           console.log(`Clicked enhance for ${aspect}`);
           const success = usePlayerStore.getState().enhanceSoulAspect(aspect);
           if (success) {
               // Add visual feedback (e.g., flash green)
               button.getElement('background')?.setFillStyle(0x00ff00, 0.5);
               this.time.delayedCall(200, () => {
                  button.getElement('background')?.setFillStyle(0x555555); // Restore normal color
               });
           } else {
               // Add visual feedback (e.g., flash red)
                button.getElement('background')?.setFillStyle(0xff0000, 0.5);
                this.time.delayedCall(200, () => {
                   button.getElement('background')?.setFillStyle(0x555555);
                });
               // Maybe disable button briefly?
           }
           // UI will update automatically via the main subscription
       }
   }, this);


   return sizer;
}

// --- Create Dao Section (Placeholder) ---
private createDaoSection(): Sizer {
   const sizer = this.rexUI.add.sizer({ orientation: 'y', space: { item: 8 }, name: 'daoSection' });
   sizer.add(this.add.text(0,0, '--- Dao Comprehension ---', { fontSize: '18px', color: '#aaaaaa'}), {align: 'center'});
   // TODO: Dynamically create labels for discovered Daos
   // Read from usePlayerStore.getState().daoProgress.discovered and .comprehension
   // Example Label: this.rexUI.add.label({ text: this.add.text(0,0, 'Fire Dao: 25/100', ...) })
   sizer.add(this.add.text(0,0, '(Dao display coming soon)', { fontSize: '14px', color: '#888888'}), {align: 'center'});
   return sizer;
}

// --- Create Breakthrough Section ---
private createBreakthroughSection(): Sizer {
   const sizer = this.rexUI.add.sizer({ orientation: 'x', name: 'breakthroughSection'}); // Horizontal sizer for the button

   this.breakthroughButton = this.createButton('Attempt Breakthrough')
       .setName('breakthroughBtn')
       .setVisible(false); // Initially hidden

   // Handle click
    this.breakthroughButton.on('button.click', () => {
        console.log('Attempting breakthrough...');
        usePlayerStore.getState().attemptBreakthrough(this); // Pass the UIScene instance
        // Feedback will depend on success/failure/tribulation trigger
    }, this);

   sizer.add(this.breakthroughButton);
   return sizer;
}


// --- Helper to Create Buttons ---
private createButton(text: string): Label {
   return this.rexUI.add.label({
       background: this.rexUI.add.roundRectangle(0, 0, 0, 0, 10, 0x555555).setStrokeStyle(1, 0x999999),
       text: this.add.text(0, 0, text, { fontSize: '16px', color: '#bbbbbb' }),
       space: { left: 10, right: 10, top: 5, bottom: 5 },
       align: 'center',
       name: `${text.toLowerCase().replace(' ','_')}Btn` // Auto-generate name
   })
   .setInteractive() // Make it clickable
   .on('pointerover', () => { btn.getElement('background').setFillStyle(0x777777); btn.getElement('text').setColor('#ffffff'); })
   .on('pointerout', () => { btn.getElement('background').setFillStyle(0x555555); btn.getElement('text').setColor('#bbbbbb'); });
   const btn = arguments[0]; // Reference the created label
   return btn;
}


// --- Function to Update Cultivation Menu Content ---
private updateCultivationMenuContent(state: PlayerState) {
   if (!this.cultivationMenu || !this.cultivationMenu.visible) return;

   // Update Realm Info
   this.realmNameLabel?.setText(`${state.realm} (${Math.round(state.realmProgress)}/${state.realmProgressMax})`);
   this.realmProgressBar?.setValue(state.realmProgress, 0, state.realmProgressMax);

   // Update Qi Info
   this.qiInfoLabel?.setText(`Current Qi: ${Math.round(state.coreStats.qi.current)}`);

   // Update Aspect Labels & Button States
   (Object.keys(this.aspectLabels) as SoulAspectType[]).forEach(aspect => {
       const label = this.aspectLabels[aspect];
       const button = this.aspectEnhanceButtons[aspect];
       if (label) {
           const currentLevel = state.soulAspects[aspect];
           const cost = calculateAspectEnhancementCost(currentLevel);
           label.setText(`${capitalize(aspect)}: ${currentLevel} (Cost: ${cost} Qi)`);

           // Enable/disable button based on cost
           if (button) {
                const canAfford = state.coreStats.qi.current >= cost;
                button.setAlpha(canAfford ? 1 : 0.5); // Dim if cannot afford
                // If using setInteractive separately: button.setInteractive(canAfford);
           }
       }
   });

   // Update Dao Info (Placeholder - Loop through state.daoProgress when implemented)

   // Update Breakthrough Button Visibility
   this.breakthroughButton?.setVisible(state.isBreakthroughReady);

   // Crucial: Relayout the dialog after updating content
   this.cultivationMenu.layout();
}


// --- Function to Toggle Menu Visibility ---
private toggleCultivationMenu() {
   if (!this.cultivationMenu) return;

   const isVisible = this.cultivationMenu.visible;
   if (isVisible) {
       // Hide Menu & Resume Game
       this.cultivationMenu.setVisible(false);
       // Check if GameScene exists and is paused before resuming
       if (this.scene.isPaused(AssetKeys.Scenes.GAME)) {
            this.scene.resume(AssetKeys.Scenes.GAME);
            console.log("Resumed GameScene");
       } else {
            console.warn("Tried to resume GameScene, but it wasn't paused.");
       }

   } else {
       // Show Menu & Pause Game
        // Check if GameScene exists and is active before pausing
       if (this.scene.isActive(AssetKeys.Scenes.GAME)) {
            this.scene.pause(AssetKeys.Scenes.GAME);
            console.log("Paused GameScene");
             // Update content when opening
            this.updateCultivationMenuContent(usePlayerStore.getState());
            this.cultivationMenu.setVisible(true).layout(); // Make sure layout is called after setting visible
       } else {
            console.warn("Tried to pause GameScene, but it wasn't active.");
            this.cultivationMenu.setVisible(true).layout(); // Show menu anyway, maybe it's open from main menu?
       }

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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}