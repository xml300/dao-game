import { CultivationData, SoulAspects, DaoAspects } from '../types';

// This is a simplified placeholder. A real system would involve complex logic
// for breakthroughs, Qi absorption, Dao comprehension etc.
// It might be better implemented using Phaser's DataManager or a dedicated state management library.
export class CultivationSystem {
    private data: CultivationData;

    constructor() {
        // Initial player state based on the "Spark in the Dust" concept
        this.data = {
            realm: 'Mortal',
            level: 1,
            experience: 0,
            soulAspects: {
                resilience: 5,
                perception: 5,
                affinity: 5,
                purity: 5,
            },
            daoAspects: {}, // Starts with no Dao comprehension
        };
    }

    getData(): CultivationData {
        return this.data;
    }

    // Example methods (would need actual implementation)
    addExperience(amount: number) {
        this.data.experience += amount;
        console.log(`Gained ${amount} EXP. Total: ${this.data.experience}`);
        // Check for level up / realm breakthrough
    }

    enhanceSoulAspect(aspect: keyof SoulAspects, amount: number) {
        this.data.soulAspects[aspect] += amount;
        console.log(`Enhanced ${aspect} by ${amount}. New value: ${this.data.soulAspects[aspect]}`);
    }

    comprehendDao(daoName: string, amount: number) {
        if (!this.data.daoAspects[daoName]) {
            this.data.daoAspects[daoName] = 0;
        }
        this.data.daoAspects[daoName] += amount;
        console.log(`Comprehended ${daoName} by ${amount}. New value: ${this.data.daoAspects[daoName]}`);
    }

    // --- Getters for specific data ---
    getRealm(): string { return this.data.realm; }
    getSoulAspects(): SoulAspects { return this.data.soulAspects; }
    getDaoAspects(): DaoAspects { return this.data.daoAspects; }
}

// Create a single instance to be used globally (simple approach)
export const cultivationSystem = new CultivationSystem();