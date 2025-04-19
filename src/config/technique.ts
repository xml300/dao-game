import { ITechniqueData, TechniqueEffectType, TechniqueID } from '@/types'; // Adjust path if needed


export const TechniqueRegistry = new Map<TechniqueID, ITechniqueData>();

TechniqueRegistry.set('tech_fireball', {
    id: 'tech_fireball',
    name: 'Fireball',
    description: 'Hurls a ball of fire.',
    qiCost: 15,
    cooldown: 2.5, // seconds
    animationKey: 'player_cast_forward', // Needs definition
    effectType: 'Projectile',
    effectData: {
        key: 'sprite_projectile_fireball', // Needs definition/loading
        speed: 400,
        damage: 25, // More damage than basic attack
        hitboxW: 20,
        hitboxH: 20,
        lifespanMs: 1500, // How long projectile lasts
        impactEffect: 'particle_explosion_small_fire' // Needs definition/loading
        // statusEffect: { id: 'Burn', chance: 0.3, duration: 5 } // Add status effects later
    }
});