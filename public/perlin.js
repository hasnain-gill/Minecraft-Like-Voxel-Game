// perlin.js
// Enhanced Perlin noise implementation.
// Based on Ken Perlin's reference code using permutations.
// Includes Fractional Brownian Motion (fBm) / Octave noise functionality.

/**
 * A class for generating Perlin noise in 1D, 2D, and 3D.
 * Also includes functionality for Fractional Brownian Motion (fBm).
 */
export class Perlin {
    /** @type {Uint8Array} Permutation table doubled to 512 entries */
    permutation;
    /** Default persistence value for fBm */
    static DEFAULT_PERSISTENCE = 0.5;
    /** Default lacunarity value for fBm */
    static DEFAULT_LACUNARITY = 2.0;
    /** Default octave count for fBm */
    static DEFAULT_OCTAVES = 4;

    /**
     * Initializes the Perlin noise generator.
     * @param {number} [seed=0] - A seed value for the random number generator used to create the permutation table.
     */
    constructor(seed = 0) {
        this.permutation = new Uint8Array(512);
        this.generatePermutation(seed);
    }

    /**
     * Generates and shuffles the permutation table based on the seed.
     * @param {number} seed - The seed value.
     */
    generatePermutation(seed) {
        const p = new Uint8Array(256);
        // Initialize with sequential values 0-255
        for (let i = 0; i < 256; i++) {
            p[i] = i;
        }

        // Shuffle using a seeded Pseudo-Random Number Generator (PRNG) - Mulberry32
        let random = mulberry32(seed * 10000 + 1234); // Use a simple seed transformation
        for (let i = 255; i > 0; i--) {
            const index = Math.floor(random() * (i + 1));
            // Simple swap
            [p[i], p[index]] = [p[index], p[i]];
        }

        // Duplicate the permutation table to avoid modulo operations later (speeds up lookup)
        for (let i = 0; i < 512; i++) {
            this.permutation[i] = p[i & 255]; // Use bitwise AND for efficient wrapping
        }
    }

    /**
     * Calculates 3D Perlin noise for the given coordinates.
     * Output range is approximately [-1, 1], though classic Perlin can slightly exceed this.
     * @param {number} x - X coordinate.
     * @param {number} y - Y coordinate.
     * @param {number} z - Z coordinate.
     * @returns {number} The noise value.
     */
    noise(x, y, z) {
        // Find the unit cube that contains the point
        const floorX = Math.floor(x) & 255;
        const floorY = Math.floor(y) & 255;
        const floorZ = Math.floor(z) & 255;

        // Find relative x, y, z of point in cube (0.0 to 1.0)
        const X = x - Math.floor(x);
        const Y = y - Math.floor(y);
        const Z = z - Math.floor(z);

        // Compute fade curves for each of x, y, z (smoothstep function)
        const u = fade(X);
        const v = fade(Y);
        const w = fade(Z);

        // Hash coordinates of the 8 cube corners
        // Use the doubled permutation table to avoid modulo
        const A = this.permutation[floorX] + floorY;
        const AA = this.permutation[A] + floorZ;
        const AB = this.permutation[A + 1] + floorZ;
        const B = this.permutation[floorX + 1] + floorY;
        const BA = this.permutation[B] + floorZ;
        const BB = this.permutation[B + 1] + floorZ;

        // Add blended results from 8 corners of the cube
        // Calculate gradient dot products for each corner
        const gradAA = grad(this.permutation[AA], X, Y, Z);
        const gradBA = grad(this.permutation[BA], X - 1, Y, Z);
        const gradAB = grad(this.permutation[AB], X, Y - 1, Z);
        const gradBB = grad(this.permutation[BB], X - 1, Y - 1, Z);
        const gradAA1 = grad(this.permutation[AA + 1], X, Y, Z - 1);
        const gradBA1 = grad(this.permutation[BA + 1], X - 1, Y, Z - 1);
        const gradAB1 = grad(this.permutation[AB + 1], X, Y - 1, Z - 1);
        const gradBB1 = grad(this.permutation[BB + 1], X - 1, Y - 1, Z - 1);

        // Interpolate along x-axis
        const lerpX1 = lerp(gradAA, gradBA, u);
        const lerpX2 = lerp(gradAB, gradBB, u);
        const lerpX3 = lerp(gradAA1, gradBA1, u);
        const lerpX4 = lerp(gradAB1, gradBB1, u);

        // Interpolate along y-axis
        const lerpY1 = lerp(lerpX1, lerpX2, v);
        const lerpY2 = lerp(lerpX3, lerpX4, v);

        // Interpolate along z-axis
        const finalLerp = lerp(lerpY1, lerpY2, w);

        // The result can be slightly outside [-1, 1], usually around [-0.7, 0.7] to [-0.9, 0.9] practically
        // Some implementations clamp or normalize, but we return the raw value.
        return finalLerp;
    }

    /**
     * Calculates 2D Perlin noise. Convenience method calling noise(x, y, 0).
     * @param {number} x - X coordinate.
     * @param {number} y - Y coordinate.
     * @returns {number} The 2D noise value.
     */
    noise2D(x, y) {
        return this.noise(x, y, 0);
    }

    /**
     * Calculates 1D Perlin noise. Convenience method calling noise(x, 0, 0).
     * @param {number} x - X coordinate.
     * @returns {number} The 1D noise value.
     */
    noise1D(x) {
        return this.noise(x, 0, 0);
    }


    /**
     * Generates Fractional Brownian Motion (fBm) noise, also known as layered or octave noise.
     * This sums multiple layers of Perlin noise with varying frequencies and amplitudes
     * to create more detailed and natural-looking patterns.
     *
     * @param {number} x - X coordinate.
     * @param {number} y - Y coordinate.
     * @param {number} z - Z coordinate.
     * @param {number} [octaves=Perlin.DEFAULT_OCTAVES] - The number of noise layers to sum. More octaves add finer detail but cost more computation.
     * @param {number} [persistence=Perlin.DEFAULT_PERSISTENCE] - How much the amplitude decreases for each subsequent octave (typically 0.5). Controls the roughness. Lower value = smoother.
     * @param {number} [lacunarity=Perlin.DEFAULT_LACUNARITY] - How much the frequency increases for each subsequent octave (typically 2.0). Controls the level of detail / feature size.
     * @returns {number} The combined noise value, normalized roughly to the range [-1, 1].
     */
    fbm(x, y, z,
        octaves = Perlin.DEFAULT_OCTAVES,
        persistence = Perlin.DEFAULT_PERSISTENCE,
        lacunarity = Perlin.DEFAULT_LACUNARITY
    ) {
        let total = 0;
        let frequency = 1.0;
        let amplitude = 1.0;
        let maxValue = 0;  // Used for normalizing the result to [-1, 1]

        for (let i = 0; i < octaves; i++) {
            total += this.noise(x * frequency, y * frequency, z * frequency) * amplitude;

            maxValue += amplitude; // Accumulate max possible amplitude

            amplitude *= persistence; // Decrease amplitude for next octave
            frequency *= lacunarity; // Increase frequency for next octave
        }

        // Normalize the result
        if (maxValue === 0) return 0; // Avoid division by zero if octaves = 0
        return total / maxValue;
    }

     /**
     * Generates 2D Fractional Brownian Motion (fBm) noise.
     * @param {number} x - X coordinate.
     * @param {number} y - Y coordinate.
     * @param {number} [octaves=Perlin.DEFAULT_OCTAVES] - Number of noise layers.
     * @param {number} [persistence=Perlin.DEFAULT_PERSISTENCE] - Amplitude decrease per octave.
     * @param {number} [lacunarity=Perlin.DEFAULT_LACUNARITY] - Frequency increase per octave.
     * @returns {number} The combined 2D noise value, normalized roughly to the range [-1, 1].
     */
    fbm2D(x, y,
        octaves = Perlin.DEFAULT_OCTAVES,
        persistence = Perlin.DEFAULT_PERSISTENCE,
        lacunarity = Perlin.DEFAULT_LACUNARITY
        ) {
            return this.fbm(x, y, 0, octaves, persistence, lacunarity);
    }

     /**
     * Generates 1D Fractional Brownian Motion (fBm) noise.
     * @param {number} x - X coordinate.
     * @param {number} [octaves=Perlin.DEFAULT_OCTAVES] - Number of noise layers.
     * @param {number} [persistence=Perlin.DEFAULT_PERSISTENCE] - Amplitude decrease per octave.
     * @param {number} [lacunarity=Perlin.DEFAULT_LACUNARITY] - Frequency increase per octave.
     * @returns {number} The combined 1D noise value, normalized roughly to the range [-1, 1].
     */
    fbm1D(x,
        octaves = Perlin.DEFAULT_OCTAVES,
        persistence = Perlin.DEFAULT_PERSISTENCE,
        lacunarity = Perlin.DEFAULT_LACUNARITY
        ) {
            return this.fbm(x, 0, 0, octaves, persistence, lacunarity);
    }
}

// --- Internal Helper Functions ---

/**
 * Fade function as defined by Ken Perlin: 6t^5 - 15t^4 + 10t^3.
 * Improves noise quality by smoothing the interpolation.
 * @param {number} t - Input value (usually 0.0 to 1.0).
 * @returns {number} Smoothed value.
 */
function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Linear interpolation.
 * @param {number} a - Start value.
 * @param {number} b - End value.
 * @param {number} t - Interpolation factor (0.0 to 1.0).
 * @returns {number} Interpolated value.
 */
function lerp(a, b, t) {
    return a + t * (b - a);
}

/**
 * Calculates the dot product of a randomly selected gradient vector and the 3D offset vector (x, y, z).
 * The gradient vector is selected based on the lower 4 bits of the hash value.
 * @param {number} hash - Hash value (usually from permutation table).
 * @param {number} x - X offset.
 * @param {number} y - Y offset.
 * @param {number} z - Z offset.
 * @returns {number} Dot product.
 */
function grad(hash, x, y, z) {
    // Use the lower 4 bits of the hash to select one of 16 gradients
    // (Classic Perlin uses 12 directions, some are repeated here)
    switch (hash & 15) { // Bitwise AND 15 is equivalent to modulo 16
        case 0: return x + y;
        case 1: return -x + y;
        case 2: return x - y;
        case 3: return -x - y;
        case 4: return x + z;
        case 5: return -x + z;
        case 6: return x - z;
        case 7: return -x - z;
        case 8: return y + z;
        case 9: return -y + z;
        case 10: return y - z;
        case 11: return -y - z;
        // The following are repeats of the first four directions
        case 12: return x + y;
        case 13: return -x + y;
        case 14: return x - y;
        case 15: return -x - y;
        default: return 0; // Should never happen
    }
}

/**
 * A simple Pseudo-Random Number Generator (PRNG) - Mulberry32.
 * Used for shuffling the permutation table based on a seed.
 * @param {number} seed - The initial seed value.
 * @returns {function(): number} A function that returns random numbers between 0 (inclusive) and 1 (exclusive).
 */
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
