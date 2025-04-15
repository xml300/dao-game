// Example placeholder types - expand significantly based on the concept

export interface SoulAspects {
    resilience: number;
    perception: number;
    affinity: number;
    purity: number;
}

export interface DaoAspects {
    [daoName: string]: number; // e.g., { 'Sword': 10, 'Time': 5 }
}

export interface CultivationData {
    realm: string; // e.g., "Qi Condensation", "Foundation Establishment"
    level: number;
    experience: number; // Or similar progress metric
    soulAspects: SoulAspects;
    daoAspects: DaoAspects;
}

export interface Technique {
    id: string;
    name: string;
    description: string;
    cost: number;
    cooldown: number; // ms
    effect: (scene: Phaser.Scene, player: Phaser.GameObjects.Sprite) => void; // Basic effect function
}