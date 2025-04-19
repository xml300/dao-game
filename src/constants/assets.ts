// src/constants/assets.ts

// --- Texture Keys (used in preload and Renderable component) ---
export const Textures = {
    PLAYER: 'player_char',
    ENEMY: 'enemy_char',
    FIREBALL_PARTICLE: 'tech_fireball'
    // Add other texture keys: ENEMY_GOBLIN, FIREBALL_PARTICLE, UI_BUTTONS etc.
};

// --- Animation Keys (defined in GameScene.create, used in Renderable/animationSystem) ---
export const Anims = {
    PLAYER_IDLE: 'player_idle',
    PLAYER_RUN: 'player_run',
    PLAYER_ATTACK_LIGHT_1: 'player_attack_light1',
    PLAYER_ATTACK_LIGHT_2: "player_attack_light2", // Placeholder
    PLAYER_ATTACK_LIGHT_3: "player_attack_light3", // Placeholder
    PLAYER_ATTACK_HEAVY: "player_attack_heavy", // Placeholder
    PLAYER_DODGE: "player_dodge", // Placeholder
};

// --- Scene Keys ---
export const Scenes = {
    PRELOAD: 'PreloadScene',
    MAIN_MENU: 'MainMenuScene',
    GAME: 'GameScene',
    UI: 'UIScene',
    // Add others: DUNGEON_CAVE, SECT_HALL etc.
};

// --- Audio Keys ---
export const Audio = { 

};

// --- Other Constants ---
// export const PhysicsGroups = { PLAYER: 'playerGroup', ENEMY: 'enemyGroup', ... };