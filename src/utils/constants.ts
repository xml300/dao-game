export const SCENE_KEYS = {
    BOOT: 'BootScene',
    PRELOADER: 'PreloaderScene',
    GAME: 'GameScene',
    UI: 'UIScene',
};

export const ASSET_KEYS = {
    PLAYER: 'player',
    ENEMY: 'enemy',
    PROJECTILE: 'projectile',
    BACKGROUND: 'background',
};

export const PLAYER_STATS = {
    SPEED: 200,
    FLIGHT_SPEED: 350,
    HEALTH: 100,
    QI: 100,
    BLINK_DISTANCE: 100,
    BLINK_COST: 10,
    BLINK_COOLDOWN: 500, // ms
    ATTACK_COST: 5,
    ATTACK_COOLDOWN: 300, // ms
    TIME_STOP_COST: 80,
    TIME_STOP_DURATION: 5000, // 5 seconds
    TIME_STOP_COOLDOWN: 30000, // 30 seconds
};

export const ENEMY_STATS = {
    SPEED: 100,
    HEALTH: 50,
    ATTACK_RANGE: 50,
    DAMAGE: 10,
};

export const REGISTRY_KEYS = {
    PLAYER_HEALTH: 'playerHealth',
    PLAYER_MAX_HEALTH: 'playerMaxHealth',
    PLAYER_QI: 'playerQi',
    PLAYER_MAX_QI: 'playerMaxQi',
    TIME_STOP_READY: 'timeStopReady',
    TIME_STOP_ACTIVE: 'timeStopActive',
};

export const INPUT_KEYS = {
    UP: 'W',
    DOWN: 'S',
    LEFT: 'A',
    RIGHT: 'D',
    FLIGHT_TOGGLE: 'F',
    BLINK: 'SPACE',
    ATTACK: 'LEFT_MOUSE', // Placeholder - using 'E' for keyboard demo
    TIME_STOP: 'T',
    // Technique keys: '1', '2', '3', '4' (not implemented fully yet)
};