// worldWorker.js
import { generateChunkData } from './worldgen.js';
// Import or define the meshing logic here.
// It CANNOT use THREE directly. It must calculate arrays.
// Assume a function `buildMeshGeometryData(chunkData, neighbourData, blockTypes, atlasConfig)` exists

let BLOCK_TYPES = {};
let ATLAS_CONFIG = {}; // Store atlas info if needed for UV calculation

self.onmessage = (e) => {
    const { type, data } = e.data;

    try { // Add error handling within the worker
        switch (type) {
            case 'initBlocks':
                BLOCK_TYPES = data.blockTypes;
                console.log('Worker: Block types initialized.');
                break;

            case 'initAtlas':
                ATLAS_CONFIG = data.atlasConfig; // Store config/bitmap
                console.log('Worker: Texture atlas initialized.');
                break;

            case 'generate':
                // console.log(`Worker: Generating ${data.cx},${data.cz}`);
                const blocks = generateChunkData(data.cx, data.cz);
                self.postMessage({
                    type: 'generated',
                    data: { cx: data.cx, cz: data.cz, blocks: blocks }
                });
                // console.log(`Worker: Finished generating ${data.cx},${data.cz}`);
                break;

            case 'mesh':
                // console.log(`Worker: Meshing ${data.cx},${data.cz}`);
                // This function calculates positions, normals, uvs, indices arrays
                const geometryData = buildMeshGeometryData(
                    data, // Contains cx, cz, blocks, dimensions
                    data.neighbourData,
                    BLOCK_TYPES,
                    ATLAS_CONFIG
                );
                 // Transferable objects (ArrayBuffers) can improve performance
                 const transferList = [];
                 if(geometryData.opaque) {
                    transferList.push(geometryData.opaque.positions.buffer);
                    transferList.push(geometryData.opaque.normals.buffer);
                    transferList.push(geometryData.opaque.uvs.buffer);
                    if(geometryData.opaque.indices) transferList.push(geometryData.opaque.indices.buffer);
                 }
                  if(geometryData.transparent) {
                    transferList.push(geometryData.transparent.positions.buffer);
                    transferList.push(geometryData.transparent.normals.buffer);
                    transferList.push(geometryData.transparent.uvs.buffer);
                    if(geometryData.transparent.indices) transferList.push(geometryData.transparent.indices.buffer);
                 }

                self.postMessage({
                    type: 'meshed',
                    data: {
                         cx: data.cx,
                         cz: data.cz,
                         geometryData: geometryData // Contains the raw array data
                    }
                }, transferList); // Transfer array buffers instead of copying
                 // console.log(`Worker: Finished meshing ${data.cx},${data.cz}`);
                break;

             // case 'cancel': // Optional: Handle cancellation requests
             //     // Implement logic to stop work if possible
             //     break;
        }
    } catch (error) {
         console.error(`Worker error processing ${type}:`, error);
         self.postMessage({ type: 'error', data: { error: error.message, stack: error.stack }});
    }
};


// --- Meshing Logic (Example - Needs to be adapted from your previous buildChunkMesh) ---
// This MUST NOT use THREE.* classes. It calculates raw data arrays.

const DIRECTIONS = [ /* Same as in your previous mesher */ ]; // Include DIRECTIONS constant

function buildMeshGeometryData(chunkData, neighbourData, blockTypes, atlasConfig) {
    const { cx, cz, blocks, chunkSize, chunkHeight } = chunkData;
    const BLOCK_AIR = -1; // Or your air representation

    const geometries = {
        opaque: { positions: [], normals: [], uvs: [], indices: [] }, // Use arrays
        transparent: { positions: [], normals: [], uvs: [], indices: [] }
    };

    const getBlock = (lx, ly, lz) => {
        // Simplified version for worker - assumes neighbourData provides blocks correctly
         if (ly < 0 || ly >= chunkHeight) return BLOCK_AIR;

        if (lx >= 0 && lx < chunkSize && lz >= 0 && lz < chunkSize) {
            return blocks[lx][ly][lz] ?? BLOCK_AIR;
        } else {
            const dx = Math.floor(lx / chunkSize);
            const dz = Math.floor(lz / chunkSize);
            const key = `${dx},${dz}`;
            const neighbour = neighbourData ? neighbourData[key] : null;

            if (!neighbour || !neighbour.blocks) return BLOCK_AIR;

            const nx = lx - dx * chunkSize;
            const nz = lz - dz * chunkSize;
             // Basic bounds check within neighbour (assuming same dimensions)
             if(nx < 0 || nx >= chunkSize || nz < 0 || nz >= chunkSize) return BLOCK_AIR;

            return neighbour.blocks[nx]?.[ly]?.[nz] ?? BLOCK_AIR; // Check Y exists too
        }
    };

     // --- The Core Meshing Loop (Adapted from previous buildChunkMesh) ---
    for (let y = 0; y < chunkHeight; y++) {
        for (let z = 0; z < chunkSize; z++) {
            for (let x = 0; x < chunkSize; x++) {
                const currentBlockID = blocks[x][y][z];
                // Use blockTypes passed to worker
                const currentBlockType = blockTypes[currentBlockID];

                if (currentBlockID === BLOCK_AIR || !currentBlockType) continue;

                for (const { dir, name, corners } of DIRECTIONS) {
                    const nx = x + dir[0];
                    const ny = y + dir[1];
                    const nz = z + dir[2];

                    const neighbourBlockID = getBlock(nx, ny, nz);
                    const neighbourBlockType = blockTypes[neighbourBlockID];

                    let shouldRenderFace = false;
                    if (neighbourBlockID === BLOCK_AIR || !neighbourBlockType) {
                        shouldRenderFace = true;
                    } else if (neighbourBlockType.transparent && !currentBlockType.transparent) {
                         shouldRenderFace = true;
                    }
                    // Add other conditions if needed (e.g., transparent next to different transparent)


                    if (shouldRenderFace) {
                        const geo = currentBlockType.transparent ? geometries.transparent : geometries.opaque;
                        const indexOffset = geo.positions.length / 3;

                        for (const corner of corners) {
                             // NO THREE.* here! Just push numbers. World coords not needed here, only local + normal + uv.
                            geo.positions.push(x + corner[0], y + corner[1], z + corner[2]);
                            geo.normals.push(...dir);
                            // Calculate UV based on atlasConfig and blockType/face/corner
                            const uv = calculateUVForWorker(currentBlockType, name, corner, atlasConfig);
                            geo.uvs.push(...uv);
                        }
                         // Add indices
                         geo.indices.push(
                            indexOffset, indexOffset + 1, indexOffset + 2,
                            indexOffset + 2, indexOffset + 1, indexOffset + 3 // Flipped winding order
                         );
                    }
                }
            }
        }
    }

    // Convert arrays to TypedArrays for efficient transfer
    const finalizeGeometry = (geo) => {
        if(geo.indices.length === 0) return null;
        return {
            positions: new Float32Array(geo.positions),
            normals: new Float32Array(geo.normals),
            uvs: new Float32Array(geo.uvs),
            indices: new Uint32Array(geo.indices) // Use 32-bit if > 65535 vertices possible per mesh
        };
    };

    return {
        opaque: finalizeGeometry(geometries.opaque),
        transparent: finalizeGeometry(geometries.transparent)
    };
}

// Placeholder UV function - adapt your previous logic, using atlasConfig
function calculateUVForWorker(blockType, faceName, corner, atlasConfig) {
    // TODO: Implement actual UV calculation based on atlasConfig
    // Example: Find UV rect in atlasConfig based on blockType.texture[faceName]
    // Map corner [0/1, 0/1] to the UV rectangle space.
     const placeholderU = (faceName === 'right' || faceName === 'left') ? corner[2] : corner[0];
     const placeholderV = (faceName === 'top' || faceName === 'bottom') ? corner[2] : corner[1];
    return [placeholderU, placeholderV];
}

console.log("Worker initialized.");
