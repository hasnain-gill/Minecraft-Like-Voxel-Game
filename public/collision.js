// collision.js
import { player, PLAYER_CONFIG, getPlayerCollisionHeight } from './player.js'; // Import config and height helper
import { getBlock, BLOCK_TYPES } from './world.js'; // Import getBlock and block type definitions

/**
 * Checks if the player's bounding box, if centered horizontally at (px, pz)
 * with its base at py, overlaps any solid blocks in the world grid.
 * Uses player dimensions from PLAYER_CONFIG and accounts for crouching.
 *
 * @param {number} px - Potential player center X position.
 * @param {number} py - Potential player feet Y position.
 * @param {number} pz - Potential player center Z position.
 * @returns {boolean} True if collision occurs, false otherwise.
 */
export function checkCollision(px, py, pz) { // Renamed for clarity, matching previous usage
    // Get current player dimensions based on state (e.g., crouching)
    const playerRadius = PLAYER_CONFIG.radius;
    const playerHeight = getPlayerCollisionHeight(); // Use helper to get current height

    // Calculate player's bounding box (Axis-Aligned Bounding Box - AABB) in world coordinates
    const minX = px - playerRadius;
    const maxX = px + playerRadius;
    const minY = py; // Player position 'y' is typically the feet level
    const maxY = py + playerHeight; // Top of the player's head
    const minZ = pz - playerRadius;
    const maxZ = pz + playerRadius;

    // Convert the AABB world coordinates to the range of voxel grid coordinates it overlaps
    // Use Math.floor() to get the minimum integer coordinate included in the box
    const startX = Math.floor(minX);
    const endX = Math.floor(maxX); // Voxel index at or just past the max edge
    const startY = Math.floor(minY);
    const endY = Math.floor(maxY); // Voxel index at or just past the top
    const startZ = Math.floor(minZ);
    const endZ = Math.floor(maxZ); // Voxel index at or just past the max edge

    // Iterate through all voxel grid cells that the player's AABB might overlap
    for (let y = startY; y <= endY; y++) { // Iterate through Y levels first or last? Doesn't strictly matter here.
        for (let z = startZ; z <= endZ; z++) {
            for (let x = startX; x <= endX; x++) {
                const blockID = getBlock(x, y, z); // Get the block ID at this grid coordinate

                // Check if the block is solid (causes collision)
                // Assumes blockID < 0 (e.g., -1) is air.
                // Also checks BLOCK_TYPES for solidity/transparency if available.
                if (blockID !== undefined && blockID >= 0) { // Check if it's not potentially outside loaded world and not air
                    const blockType = BLOCK_TYPES[blockID];
                    // If blockType definition exists, check if it's explicitly non-solid (transparent might count as non-solid for collision)
                    // Otherwise, assume any block ID >= 0 is solid. Adjust this logic based on your BLOCK_TYPES definition.
                    const isSolid = !blockType || (blockType && !blockType.transparent /* && blockType.solid !== false */); // Example check

                    if (isSolid) {
                        // Optimization: We could perform a more precise AABB check here
                        // between the player's exact AABB and this specific block's AABB (x to x+1, etc.),
                        // but iterating through all potentially overlapping voxels and checking if *any*
                        // are solid is simpler and often sufficient for block worlds.
                        // If any overlapping voxel cell contains a solid block, we have a collision.
                        return true; // Collision detected
                    }
                }
            }
        }
    }

    // If the loops complete without finding any solid block in overlapping voxels, no collision.
    return false;
}

/**
 * Check if placing a block at integer coordinates (bx, by, bz) would overlap
 * the player's current bounding box. Useful before placing blocks.
 *
 * @param {number} bx - Integer X coordinate of the block to check.
 * @param {number} by - Integer Y coordinate of the block to check.
 * @param {number} bz - Integer Z coordinate of the block to check.
 * @returns {boolean} True if the block volume overlaps the player's current volume.
 */
export function blockIntersectsPlayer(bx, by, bz) {
    // Define the block's bounding box (Axis-Aligned Bounding Box - AABB)
    // A block at integer coordinate 'bx' occupies the space from bx to bx + 1.
    const blockMinX = bx;
    const blockMaxX = bx + 1;
    const blockMinY = by;
    const blockMaxY = by + 1;
    const blockMinZ = bz;
    const blockMaxZ = bz + 1;

    // Get the player's current position and dimensions
    const px = player.position.x;
    const py = player.position.y; // Player feet position
    const pz = player.position.z;
    const playerRadius = PLAYER_CONFIG.radius;
    const playerHeight = getPlayerCollisionHeight(); // Use helper for current height

    // Calculate the player's current bounding box (AABB)
    const playerMinX = px - playerRadius;
    const playerMaxX = px + playerRadius;
    const playerMinY = py;
    const playerMaxY = py + playerHeight;
    const playerMinZ = pz - playerRadius;
    const playerMaxZ = pz + playerRadius;

    // Perform the AABB intersection test.
    // There is overlap if the intervals overlap on ALL three axes.
    // Check for non-overlap condition first (it's often easier to read/write).
    // No overlap occurs if any axis doesn't overlap.
    const noOverlapX = blockMaxX <= playerMinX || blockMinX >= playerMaxX;
    const noOverlapY = blockMaxY <= playerMinY || blockMinY >= playerMaxY;
    const noOverlapZ = blockMaxZ <= playerMinZ || blockMinZ >= playerMaxZ;

    // If there is NO overlap on ANY axis, then the boxes do not intersect.
    if (noOverlapX || noOverlapY || noOverlapZ) {
        return false;
    }

    // Otherwise, they must overlap on all three axes.
    return true;

    /* Alternative equivalent check (overlap on all axes):
    const overlapX = (blockMinX < playerMaxX) && (blockMaxX > playerMinX);
    const overlapY = (blockMinY < playerMaxY) && (blockMaxY > playerMinY);
    const overlapZ = (blockMinZ < playerMaxZ) && (blockMaxZ > playerMinZ);
    return overlapX && overlapY && overlapZ;
    */
}

// Note: The checkCollision function provides basic detection suitable for block worlds.
// For more complex physics (slopes, stairs, smoother movement), you would typically need:
// 1. More detailed world geometry representation (beyond just solid/air).
// 2. Collision detection that returns penetration depth and collision normal.
// 3. Collision response logic that adjusts velocity based on the collision normal (e.g., sliding).
// The current axis-separation method in movement.js combined with this checkCollision
// provides a simpler "stop on hit" or basic separation behavior.
