// worldMesher.js
import * as THREE from 'three'; // Assuming THREE is imported

// --- Constants ---
// Define directions for neighbor checking and face generation
const DIRECTIONS = [
    { dir: [ 1,  0,  0], name: 'right',  corners: [[1, 1, 1], [1, 1, 0], [1, 0, 0], [1, 0, 1]] }, // +X
    { dir: [-1,  0,  0], name: 'left',   corners: [[0, 1, 0], [0, 1, 1], [0, 0, 1], [0, 0, 0]] }, // -X
    { dir: [ 0,  1,  0], name: 'top',    corners: [[1, 1, 1], [0, 1, 1], [0, 1, 0], [1, 1, 0]] }, // +Y
    { dir: [ 0, -1,  0], name: 'bottom', corners: [[0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]] }, // -Y
    { dir: [ 0,  0,  1], name: 'front',  corners: [[0, 1, 1], [1, 1, 1], [1, 0, 1], [0, 0, 1]] }, // +Z
    { dir: [ 0,  0, -1], name: 'back',   corners: [[1, 1, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0]] }, // -Z
];

// Assume BLOCK_TYPES defines block properties, including transparency and texture mapping
// Example BLOCK_TYPES entry:
// const BLOCK_TYPES = {
//    0: { name: 'grass', color: 0x559944, transparent: false, texture: { /* UV info */ } },
//    1: { name: 'dirt', color: 0x885522, transparent: false, texture: { /* UV info */ } },
//    3: { name: 'water', color: 0x4455ff, transparent: true, opacity: 0.7, texture: { /* UV info */ } },
//    // ... -1 should ideally represent AIR implicitly
// };
const BLOCK_AIR = -1; // Or null, or however you represent air

/**
 * Builds optimized meshes for a chunk, culling hidden faces.
 *
 * @param {object} chunk - The chunk data { blocks, cx, cz }.
 * @param {object} neighbourChunks - A map/object containing adjacent chunks keyed by relative position e.g., { "1,0": chunkData, "-1,0": chunkData, "0,1": chunkData, "0,-1": chunkData }. Needed for edge face culling.
 * @param {object} BLOCK_TYPES - Definitions for block types (including transparency, texture UVs).
 * @param {THREE.Texture} textureAtlas - The texture atlas to apply.
 * @returns {THREE.Group} A group containing potentially two meshes: one opaque, one transparent.
 */
export function buildChunkMesh(chunk, neighbourChunks, BLOCK_TYPES, textureAtlas) {
    const group = new THREE.Group();
    const { blocks, cx, cz } = chunk;
    const chunkSize = blocks.length; // Assume square chunks X=Z
    const chunkHeight = blocks[0].length; // Y

    // World offset for placing the chunk geometry correctly
    const worldX = cx * chunkSize;
    const worldZ = cz * chunkSize;

    // Geometry data arrays for opaque and transparent blocks
    const geometries = {
        opaque: { positions: [], normals: [], uvs: [], indices: [] },
        transparent: { positions: [], normals: [], uvs: [], indices: [] },
    };

    /**
     * Helper to get block ID, checking neighbours if necessary.
     */
    const getBlock = (x, y, z) => {
        if (y < 0 || y >= chunkHeight) return BLOCK_AIR; // Out of bounds vertically is air

        if (x >= 0 && x < chunkSize && z >= 0 && z < chunkSize) {
            // Inside current chunk
            return blocks[x][y][z];
        } else {
            // Outside current chunk - check neighbours
            const dx = Math.floor(x / chunkSize); // -1, 0 or 1 relative chunk offset X
            const dz = Math.floor(z / chunkSize); // -1, 0 or 1 relative chunk offset Z
            const key = `${dx},${dz}`;

            if (!neighbourChunks || !neighbourChunks[key]) {
                 // No neighbour data available, assume it's air (or solid depending on desired edge behaviour)
                return BLOCK_AIR;
            }

            const neighbourBlockData = neighbourChunks[key].blocks;
            if (!neighbourBlockData) return BLOCK_AIR; // Neighbour exists but no block data? Assume air.

            const nx = x - dx * chunkSize;
            const nz = z - dz * chunkSize;
            const neighbourChunkSize = neighbourBlockData.length;
             const neighbourChunkHeight = neighbourBlockData[0].length;

             // Make sure Y is valid in the neighbour too (usually same height, but good practice)
            if(y < 0 || y >= neighbourChunkHeight) return BLOCK_AIR;
             // Ensure indices are valid within the neighbour chunk dimensions
            if(nx < 0 || nx >= neighbourChunkSize || nz < 0 || nz >= neighbourChunkSize) return BLOCK_AIR;


            return neighbourBlockData[nx][y][nz];
        }
    };

    // Iterate through each block position in the chunk
    for (let y = 0; y < chunkHeight; y++) {
        for (let z = 0; z < chunkSize; z++) {
            for (let x = 0; x < chunkSize; x++) {
                const currentBlockID = blocks[x][y][z];
                const currentBlockType = BLOCK_TYPES[currentBlockID];

                if (currentBlockID === BLOCK_AIR || !currentBlockType) continue; // Skip air blocks

                // Check neighbours in all 6 directions
                for (const { dir, name, corners } of DIRECTIONS) {
                    const nx = x + dir[0];
                    const ny = y + dir[1];
                    const nz = z + dir[2];

                    const neighbourBlockID = getBlock(nx, ny, nz);
                    const neighbourBlockType = BLOCK_TYPES[neighbourBlockID];

                    // --- Face Culling Logic ---
                    // Render face if neighbour is air OR if neighbour is transparent and current block is opaque
                    // (Allows seeing opaque blocks through transparent ones)
                    // OR if the current block is transparent (transparent blocks always show faces adjacent to anything non-air)
                    let shouldRenderFace = false;
                    if (neighbourBlockID === BLOCK_AIR || !neighbourBlockType) {
                        shouldRenderFace = true; // Neighbour is air
                    } else if (neighbourBlockType.transparent) {
                         // Render face if neighbour is transparent (unless current block is also transparent, avoid z-fighting)
                         if(!currentBlockType.transparent) {
                              shouldRenderFace = true;
                         } else if (currentBlockID !== neighbourBlockID) {
                             // Optional: Render transparent faces adjacent to *different* transparent blocks
                             // Might be needed for complex scenes, but often disabled to simplify sorting/z-fighting
                             // shouldRenderFace = true;
                         }
                    }

                    if (shouldRenderFace) {
                        // Face is visible, add its geometry data

                        // Choose geometry list (opaque or transparent)
                        const geo = currentBlockType.transparent ? geometries.transparent : geometries.opaque;
                        const indexOffset = geo.positions.length / 3; // Current vertex count

                        // Add 4 vertices for the quad
                        for (const corner of corners) {
                            // Vertex position (local chunk coords + world offset)
                            geo.positions.push(worldX + x + corner[0], y + corner[1], worldZ + z + corner[2]);
                            // Normal vector for the face
                            geo.normals.push(...dir);
                            // UV coordinates (needs logic based on block type and face)
                            // This is a placeholder - replace with actual UV calculation from BLOCK_TYPES/textureAtlas
                            const uv = calculateUV(currentBlockType, name, corner, textureAtlas);
                            geo.uvs.push(...uv);
                        }

                        // Add 2 triangles (6 indices) for the quad
                        geo.indices.push(
                            indexOffset, indexOffset + 1, indexOffset + 2,
                            indexOffset + 2, indexOffset + 1, indexOffset + 3 // Flipped order for standard winding
                        );
                    }
                }
            }
        }
    }

    // Create Meshes from the generated geometry data

    // Opaque Mesh
    if (geometries.opaque.indices.length > 0) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(geometries.opaque.positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(geometries.opaque.normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(geometries.opaque.uvs, 2));
        geometry.setIndex(geometries.opaque.indices);
        geometry.computeBoundingSphere(); // Important for culling

        const material = new THREE.MeshLambertMaterial({ // Or MeshStandardMaterial
            map: textureAtlas,
            side: THREE.FrontSide, // Only render front faces
            alphaTest: 0.1, // Use alphaTest for cutout textures like leaves, if needed
            // vertexColors: false // Set to true if adding vertex colors for AO/tinting
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `chunk_${cx}_${cz}_opaque`; // Helpful for debugging
        group.add(mesh);
    }

    // Transparent Mesh
    if (geometries.transparent.indices.length > 0) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(geometries.transparent.positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(geometries.transparent.normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(geometries.transparent.uvs, 2));
        geometry.setIndex(geometries.transparent.indices);
        geometry.computeBoundingSphere();

        const material = new THREE.MeshLambertMaterial({ // Or MeshStandardMaterial
            map: textureAtlas,
            side: THREE.DoubleSide,   // Render both sides for transparent blocks like water planes
            transparent: true,
            // alphaTest: 0.1,      // Usually not needed for alpha-blended transparency
            depthWrite: false,     // Crucial for correct alpha blending
            // opacity: 0.8       // Can set global opacity, or control per-vertex later
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `chunk_${cx}_${cz}_transparent`;
        mesh.renderOrder = 1; // Render transparent objects after opaque ones (can adjust)
        group.add(mesh);
    }

    return group;
}


/**
 * Placeholder function to calculate UV coordinates for a block face vertex.
 * Replace with your actual texture atlas mapping logic.
 *
 * @param {object} blockType - The definition of the current block.
 * @param {string} faceName - e.g., 'top', 'bottom', 'left', 'right', 'front', 'back'.
 * @param {number[]} corner - The corner vertex [0/1, 0/1, 0/1] relative to block origin.
 * @param {THREE.Texture} textureAtlas - The texture atlas.
 * @returns {number[]} The [u, v] coordinates.
 */
function calculateUV(blockType, faceName, corner, textureAtlas) {
    // --- === This needs specific implementation based on your texture atlas === ---
    // Example: Assume blockType.texture defines UV rectangle [u, v, width, height] for each face
    // const faceUVData = blockType.texture[faceName] || blockType.texture['all']; // Get UV for this face or default
    // if (!faceUVData) return [0, 0]; // Fallback

    // const [atlasU, atlasV, atlasW, atlasH] = faceUVData;

    // Determine which corner of the texture quad this vertex corresponds to
    // This mapping depends on how DIRECTIONS corners are defined and your UV convention (Y-up or Y-down)
    // This is a common mapping for Y-up textures:
    let u = 0;
    let v = 0;
     // Simple mapping based on the corner index relative to how corners are defined. Needs careful check!
     if (corner[0] === 0 && corner[1] === 0) { u = 0; v = 0; } // Bottom-left on face texture
     else if (corner[0] === 1 && corner[1] === 0) { u = 1; v = 0; } // Bottom-right
     else if (corner[0] === 0 && corner[1] === 1) { u = 0; v = 1; } // Top-left
     else if (corner[0] === 1 && corner[1] === 1) { u = 1; v = 1; } // Top-right
     // The corner coordinates relative to the block origin [0,0,0] to [1,1,1] need mapping
     // to the UV coordinates [0,0] to [1,1] ON THE FACE. This is non-trivial.

     // For now, let's just return placeholder UVs based on the corner 0/1 values
     // that roughly match a standard box mapping. You WILL need to adjust this.
     // Example for +X ('right') face (Y maps to V, Z maps to U) - THIS IS LIKELY WRONG FOR YOUR SETUP
     // if(faceName === 'right')  { u = corner[2]; v = corner[1]; }
     // else if(faceName === 'left')   { u = 1.0 - corner[2]; v = corner[1]; }
     // else if(faceName === 'top')    { u = corner[0]; v = 1.0 - corner[2]; } // Top face Z maps to V
     // else if(faceName === 'bottom') { u = corner[0]; v = corner[2]; } // Bottom face Z maps to V
     // else if(faceName === 'front')  { u = corner[0]; v = corner[1]; } // Front face Y maps to V
     // else if(faceName === 'back')   { u = 1.0 - corner[0]; v = corner[1]; } // Back face Y maps to V
     // else { u = corner[0]; v = corner[1]; } // Default fallback UV

     // !! Placeholder - return corner values; replace with real atlas lookup !!
     const placeholderU = (faceName === 'right' || faceName === 'left') ? corner[2] : corner[0];
     const placeholderV = (faceName === 'top' || faceName === 'bottom') ? corner[2] : corner[1];

     // return [
     //     atlasU + placeholderU * atlasW,
     //     atlasV + placeholderV * atlasH
     // ];
     return [placeholderU, placeholderV]; // Return the raw 0/1 for now
}
