// worldgen.js
import { Perlin } from './perlin.js';
import { CHUNK_SIZE } from './world.js'; // Assuming CHUNK_SIZE is defined here

// --- Configuration ---

const CONFIG = {
    CHUNK_SIZE: CHUNK_SIZE, // Use imported value
    CHUNK_HEIGHT: 64,
    WATER_LEVEL: 20,        // Y-level for water
    BEDROCK_LEVEL: 1,       // How many layers of bedrock at the bottom (y=0 to BEDROCK_LEVEL-1)

    // Noise settings for overall biome placement
    BIOME_NOISE_SCALE: 0.0015, // Lower value = larger biomes

    // Cave settings
    CAVE_ENABLED: true,
    CAVE_NOISE_SCALE: 0.05, // Frequency of cave noise
    CAVE_THRESHOLD: 0.6,    // Noise value above which caves generate (adjust for density)
    CAVE_Y_SCALE: 0.1,      // Make caves stretch more vertically
    CAVE_MIN_Y: 5,          // Don't generate caves below this Y level
    CAVE_MAX_Y: 50,         // Don't generate caves above this Y level

    // Perlin noise instance (can use different seeds for different features)
    terrainPerlin: new Perlin(Math.random()),
    biomePerlin: new Perlin(Math.random() + 1), // Use a different seed for biomes
    cavePerlin: new Perlin(Math.random() + 2),  // And for caves
};

// --- Block Definitions ---
// Ensure these indices match your BLOCK_TYPES array in the main game
const BLOCKS = {
    AIR: -1, // Or null, depending on your convention
    GRASS: 0,
    DIRT: 1,
    STONE: 2,
    WATER: 3,
    SAND: 4, // Assuming SAND is 4 now
    BEDROCK: 5, // Assuming BEDROCK is 5
    // Add other blocks like WOOD, LEAVES etc. if needed
};

// --- Biome Definitions ---

/**
 * @typedef {Object} BiomeLayer
 * @property {number} blockId - The ID of the block for this layer.
 * @property {number} depth - How many blocks deep this layer goes (starting from the surface). Infinity means it goes all the way down.
 */

/**
 * @typedef {Object} BiomeDefinition
 * @property {string} name - Name of the biome.
 * @property {number} noiseCenter - The ideal noise value [0..1] for this biome.
 * @property {number} noiseRadius - How far the influence extends from the center [0..1].
 * @property {object} heightParams - Parameters for the Perlin noise height calculation.
 * @property {number} heightParams.frequency - Noise frequency for terrain height.
 * @property {number} heightParams.amplitude - Noise amplitude for terrain height.
 * @property {number} heightParams.baseHeight - Base Y level offset.
 * @property {number} heightParams.seedOffset - A unique offset for the Perlin noise Z coordinate.
 * @property {BiomeLayer[]} blockLayers - Defines the block types from top to bottom.
 */

/** @type {BiomeDefinition[]} */
const BIOMES = [
    {
        name: 'desert',
        noiseCenter: 0.15, // Centered in the lower part of the [0..1] range
        noiseRadius: 0.2,  // Influence radius
        heightParams: { frequency: 0.03, amplitude: 4, baseHeight: CONFIG.WATER_LEVEL + 5, seedOffset: 1 },
        blockLayers: [
            { blockId: BLOCKS.SAND, depth: 1 }, // Top layer
            { blockId: BLOCKS.SAND, depth: 4 }, // Next 3 layers
            { blockId: BLOCKS.STONE, depth: Infinity }, // Rest is stone
        ]
    },
    {
        name: 'plains',
        noiseCenter: 0.5,
        noiseRadius: 0.25,
        heightParams: { frequency: 0.01, amplitude: 6, baseHeight: CONFIG.WATER_LEVEL + 3, seedOffset: 2 },
        blockLayers: [
            { blockId: BLOCKS.GRASS, depth: 1 },
            { blockId: BLOCKS.DIRT, depth: 4 },
            { blockId: BLOCKS.STONE, depth: Infinity },
        ]
    },
    {
        name: 'hills',
        noiseCenter: 0.85,
        noiseRadius: 0.2,
        heightParams: { frequency: 0.015, amplitude: 20, baseHeight: CONFIG.WATER_LEVEL + 1, seedOffset: 3 },
        blockLayers: [
            { blockId: BLOCKS.GRASS, depth: 1 },
            { blockId: BLOCKS.DIRT, depth: 4 },
            { blockId: BLOCKS.STONE, depth: Infinity },
        ]
    }
    // Add more biomes here (e.g., Ocean, Forest, Mountains)
    // Example Ocean:
    // {
    //     name: 'ocean',
    //     noiseCenter: 0.0, // Or integrate with a temperature/humidity map later
    //     noiseRadius: 0.1,
    //     heightParams: { frequency: 0.01, amplitude: 3, baseHeight: CONFIG.WATER_LEVEL - 15, seedOffset: 4 },
    //     blockLayers: [
    //         { blockId: BLOCKS.SAND, depth: 2 }, // Ocean floor
    //         { blockId: BLOCKS.STONE, depth: Infinity },
    //     ]
    // }
];

// --- Core Generation Function ---

/**
 * Generates the 3D block data for a chunk.
 * @param {number} cx - Chunk X coordinate.
 * @param {number} cz - Chunk Z coordinate.
 * @returns {number[][][]} A 3D array (x, y, z) of block IDs.
 */
export function generateChunkData(cx, cz) {
    const blocks = initializeChunkBlocks();

    for (let lx = 0; lx < CONFIG.CHUNK_SIZE; lx++) {
        for (let lz = 0; lz < CONFIG.CHUNK_SIZE; lz++) {
            const wx = cx * CONFIG.CHUNK_SIZE + lx;
            const wz = cz * CONFIG.CHUNK_SIZE + lz;

            // 1. Determine Biome Influence
            const biomeNoiseValue = getBiomeNoise(wx, wz); // Mapped to [0..1]
            const biomeWeights = calculateBiomeWeights(biomeNoiseValue);

            // 2. Calculate Weighted Terrain Height
            let totalWeight = 0;
            let weightedHeight = 0;
            for (const biome of BIOMES) {
                const weight = biomeWeights[biome.name] || 0;
                if (weight > 0) {
                    const height = calculateBiomeHeight(biome, wx, wz);
                    weightedHeight += height * weight;
                    totalWeight += weight;
                }
            }
            // Normalize height if weights don't sum perfectly to 1 (due to edge cases)
            const terrainHeight = Math.round(totalWeight > 0 ? weightedHeight / totalWeight : CONFIG.WATER_LEVEL);


            // 3. Fill Blocks Vertically
            const dominantBiome = getDominantBiome(biomeWeights);
            const layers = dominantBiome ? dominantBiome.blockLayers : BIOMES[0].blockLayers; // Fallback to first biome

            for (let wy = 0; wy < CONFIG.CHUNK_HEIGHT; wy++) {
                let blockId = BLOCKS.AIR; // Default to air

                // Check Bedrock
                if (wy < CONFIG.BEDROCK_LEVEL) {
                    blockId = BLOCKS.BEDROCK;
                }
                // Check Terrain
                else if (wy <= terrainHeight) {
                    blockId = getBlockFromLayers(layers, terrainHeight, wy);

                    // Check Caves (only carve out non-air blocks within valid range)
                    if (CONFIG.CAVE_ENABLED && blockId !== BLOCKS.AIR && wy >= CONFIG.CAVE_MIN_Y && wy <= CONFIG.CAVE_MAX_Y) {
                         const caveNoise = CONFIG.cavePerlin.noise(
                            wx * CONFIG.CAVE_NOISE_SCALE,
                            wy * CONFIG.CAVE_Y_SCALE, // Use different scale for Y
                            wz * CONFIG.CAVE_NOISE_SCALE
                         );
                         // Map noise from [-1, 1] to [0, 1] for threshold check
                         if ((caveNoise + 1) * 0.5 > CONFIG.CAVE_THRESHOLD) {
                             blockId = BLOCKS.AIR; // Carve cave
                         }
                    }
                }
                // Check Water Level (only if current block is air)
                else if (wy <= CONFIG.WATER_LEVEL) {
                     // Only place water if there's no terrain/cave block already here
                     if (blockId === BLOCKS.AIR) {
                         blockId = BLOCKS.WATER;
                     }
                }

                // Assign the final block ID
                // Note: Array is accessed [x][y][z] in this setup
                blocks[lx][wy][lz] = blockId;
            }
        }
    }

    return blocks;
}

// --- Helper Functions ---

/**
 * Initializes a 3D array for the chunk filled with AIR blocks.
 * @returns {number[][][]}
 */
function initializeChunkBlocks() {
    const blocks = [];
    for (let x = 0; x < CONFIG.CHUNK_SIZE; x++) {
        blocks[x] = [];
        for (let y = 0; y < CONFIG.CHUNK_HEIGHT; y++) {
            // Initialize with AIR
            blocks[x][y] = new Array(CONFIG.CHUNK_SIZE).fill(BLOCKS.AIR);
        }
    }
    return blocks;
}

/**
 * Calculates the biome noise value for a world coordinate, mapped to [0..1].
 * @param {number} wx - World X coordinate.
 * @param {number} wz - World Z coordinate.
 * @returns {number} Noise value in the range [0, 1].
 */
function getBiomeNoise(wx, wz) {
    const noise = CONFIG.biomePerlin.noise(wx * CONFIG.BIOME_NOISE_SCALE, wz * CONFIG.BIOME_NOISE_SCALE, 0);
    return (noise + 1) * 0.5; // Map from [-1, 1] to [0, 1]
}

/**
 * Calculates the weight (influence) of each defined biome based on a noise value.
 * Uses a triangular weighting function based on distance from the biome's noise center.
 * @param {number} biomeNoiseValue - The noise value [0..1].
 * @returns {Object.<string, number>} An object mapping biome names to their weights [0..1].
 */
function calculateBiomeWeights(biomeNoiseValue) {
    const weights = {};
    let totalWeight = 0;

    for (const biome of BIOMES) {
        const dist = Math.abs(biomeNoiseValue - biome.noiseCenter);
        // Calculate weight: 1 at center, 0 at radius edge
        const weight = Math.max(0, 1 - dist / biome.noiseRadius);
        weights[biome.name] = weight;
        totalWeight += weight;
    }

    // Normalize weights so they sum to 1 (important for weighted average)
    if (totalWeight > 0) {
        for (const biomeName in weights) {
            weights[biomeName] /= totalWeight;
        }
    } else {
        // Fallback if no biome covers the noise value (shouldn't happen with good coverage)
        // Assign full weight to the biome closest to the noise value
        let closestBiome = BIOMES[0];
        let minDist = Infinity;
        for (const biome of BIOMES) {
            const dist = Math.abs(biomeNoiseValue - biome.noiseCenter);
            if (dist < minDist) {
                minDist = dist;
                closestBiome = biome;
            }
        }
         weights[closestBiome.name] = 1;
         // Ensure others are 0
         for (const biomeName in weights) {
            if (biomeName !== closestBiome.name) weights[biomeName] = 0;
         }
    }

    return weights;
}

/**
 * Calculates the terrain height for a specific biome at world coordinates.
 * @param {BiomeDefinition} biome - The biome definition object.
 * @param {number} wx - World X coordinate.
 * @param {number} wz - World Z coordinate.
 * @returns {number} The calculated terrain height for this biome.
 */
function calculateBiomeHeight(biome, wx, wz) {
    const p = biome.heightParams;
    const noise = CONFIG.terrainPerlin.noise(
        wx * p.frequency,
        wz * p.frequency,
        p.seedOffset // Use seed offset to vary noise per biome
    );
    // Map noise [-1, 1] to [0, 1] then scale by amplitude
    const heightVariation = ((noise + 1) * 0.5) * p.amplitude;
    return p.baseHeight + heightVariation;
}

/**
 * Determines which biome has the highest weight.
 * @param {Object.<string, number>} weights - Object mapping biome names to weights.
 * @returns {BiomeDefinition | null} The definition of the dominant biome, or null if weights are empty.
 */
function getDominantBiome(weights) {
    let maxWeight = -1;
    let dominantBiomeName = null;

    for (const biomeName in weights) {
        if (weights[biomeName] > maxWeight) {
            maxWeight = weights[biomeName];
            dominantBiomeName = biomeName;
        }
    }

    return BIOMES.find(b => b.name === dominantBiomeName) || null;
}

/**
 * Determines the block ID for a given Y-level based on the biome's layer definition.
 * @param {BiomeLayer[]} layers - The sorted array of block layers for the biome.
 * @param {number} terrainHeight - The surface Y-level at this column.
 * @param {number} wy - The current Y-level being checked.
 * @returns {number} The block ID.
 */
function getBlockFromLayers(layers, terrainHeight, wy) {
    const depthFromTop = terrainHeight - wy;
    let cumulativeDepth = 0;

    for (const layer of layers) {
        cumulativeDepth += layer.depth;
         // Handle Infinity depth case for the bottom layer
        if (layer.depth === Infinity || depthFromTop < cumulativeDepth) {
            return layer.blockId;
        }
         // Exact match for the top layer (depth 1)
        if (layer.depth === 1 && depthFromTop === 0) {
            return layer.blockId;
        }
    }

    // Fallback if layers don't cover (shouldn't happen with an Infinity layer)
    return BLOCKS.STONE;
}


/**
 * Calculates the surface height at a specific world coordinate. Useful for spawning.
 * This recalculates weights and heights, similar to generateChunkData but for a single point.
 * @param {number} wx - World X coordinate.
 * @param {number} wz - World Z coordinate.
 * @returns {number} The clamped surface Y-level.
 */
export function getSurfaceHeight(wx, wz) {
    const biomeNoiseValue = getBiomeNoise(wx, wz);
    const biomeWeights = calculateBiomeWeights(biomeNoiseValue);

    let totalWeight = 0;
    let weightedHeight = 0;
    for (const biome of BIOMES) {
        const weight = biomeWeights[biome.name] || 0;
        if (weight > 0) {
            const height = calculateBiomeHeight(biome, wx, wz);
            weightedHeight += height * weight;
            totalWeight += weight;
        }
    }

    const terrainHeight = Math.round(totalWeight > 0 ? weightedHeight / totalWeight : CONFIG.WATER_LEVEL);

    // Clamp height to be within chunk boundaries (minus bedrock)
    return Math.max(CONFIG.BEDROCK_LEVEL, Math.min(CONFIG.CHUNK_HEIGHT - 1, terrainHeight));
}

// --- Potential Future Additions (Conceptual) ---

// function placeTrees(chunkBlocks, cx, cz) { ... }
// function placeOres(chunkBlocks, cx, cz) { ... }
// function generateStructures(chunkBlocks, cx, cz) { ... }
