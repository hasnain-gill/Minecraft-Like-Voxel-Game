// world.js
import { generateChunkData } from './worldgen.js'; // Assume this CAN run in a worker OR main thread
// We won't directly call buildChunkMesh here anymore, the worker will handle meshing logic.

// --- Constants ---
export const CHUNK_SIZE = 16; // Blocks wide/deep
// Ensure CHUNK_HEIGHT is consistent with worldgen.js
// Import it or define it centrally if possible
import { CONFIG as WORLDGEN_CONFIG } from './worldgen.js';
export const CHUNK_HEIGHT = WORLDGEN_CONFIG.CHUNK_HEIGHT || 64;
export const RENDER_DISTANCE = 6; // In chunks
export const BLOCK_AIR = -1; // Or your representation for air

// --- Block Type Definitions ---
// Use an object for clarity and easier extension
// IMPORTANT: Add 'transparent' and 'texture' properties needed by your mesher
export const BLOCK_TYPES = {
     0: { id: 0, name: 'grass', color: 0x00cc00, transparent: false, texture: {/* UV data */}},
     1: { id: 1, name: 'dirt', color: 0x8B4513, transparent: false, texture: {/* UV data */}},
     2: { id: 2, name: 'stone', color: 0x888888, transparent: false, texture: {/* UV data */}},
     3: { id: 3, name: 'water', color: 0x4455ff, transparent: true, opacity: 0.7, texture: {/* UV data */}},
     4: { id: 4, name: 'sand', color: 0xdebf90, transparent: false, texture: {/* UV data */}},
     5: { id: 5, name: 'bedrock', color: 0x333333, transparent: false, texture: {/* UV data */}},
    // Add other blocks...
    [BLOCK_AIR]: { id: BLOCK_AIR, name: 'air', transparent: true } // Define air implicitly
};

// --- Chunk Management ---
const chunkStorage = new Map(); // Stores chunk { cx, cz, blocks, mesh, state }
const meshRebuildQueue = new Set(); // Set of chunk keys needing remeshing
const CHUNK_STATE = {
    UNKNOWN: 0,
    LOADING_DATA: 1, // Waiting for worker to generate blocks
    DATA_LOADED: 2,  // Blocks generated, waiting for mesh request
    MESHING: 3,      // Waiting for worker to generate mesh data
    READY: 4,        // Mesh created and added to scene
    UNLOADING: 5     // Marked for removal
};

// --- Web Worker Setup ---
// Use a pool or a single worker depending on complexity
const worker = new Worker(new URL('./worldWorker.js', import.meta.url), { type: 'module' });
let textureAtlasData = null; // Store data needed by worker mesher (e.g., image bitmap or URL)

// Function to initialize texture atlas (call once at startup)
export function initializeWorldResources(atlas) {
     // Prepare atlas data for worker (e.g., transfer ImageBitmap or just send URL/config)
     // Example using ImageBitmap:
     // createImageBitmap(atlas.image).then(bitmap => {
     //    textureAtlasData = bitmap;
     //    worker.postMessage({ type: 'initAtlas', atlasBitmap: textureAtlasData }, [textureAtlasData]);
     // });
     // Or simpler: just send the atlas image URL or layout config
     textureAtlasData = { imageUrl: atlas.image.src, /* layout info */ }; // Example
     worker.postMessage({ type: 'initAtlas', atlasConfig: textureAtlasData });

     // Send necessary block type info to worker
     worker.postMessage({ type: 'initBlocks', blockTypes: JSON.parse(JSON.stringify(BLOCK_TYPES)) }); // Simple serialization
}


// --- Worker Communication Handler ---
worker.onmessage = (e) => {
    const { type, data } = e.data;
    const chunk = getChunk(data.cx, data.cz);

    switch (type) {
        case 'generated':
            if (chunk && chunk.state === CHUNK_STATE.LOADING_DATA) {
                chunk.blocks = data.blocks;
                chunk.state = CHUNK_STATE.DATA_LOADED;
                console.log(`Chunk ${data.cx},${data.cz} data loaded.`);
                // Now that data is loaded, we *could* immediately request meshing,
                // OR wait for the main loop to decide based on proximity/priority.
                // Let's queue it for the update loop to handle requesting the mesh.
                // OR, if it's already needed, request mesh now:
                 requestChunkMesh(chunk); // Let's try requesting immediately
            }
            break;

        case 'meshed':
            if (chunk && chunk.state === CHUNK_STATE.MESHING) {
                console.log(`Chunk ${data.cx},${data.cz} mesh data received.`);
                // Geometry data received from worker
                buildMeshFromData(chunk, data.geometryData); // Create THREE objects on main thread
                chunk.state = CHUNK_STATE.READY;

                // Check if neighbours were waiting for this chunk's data to mesh themselves
                updateNeighboursOf(chunk.cx, chunk.cz);
            } else if (chunk) {
                console.warn(`Received mesh data for chunk ${data.cx},${data.cz} in unexpected state: ${chunk.state}`);
            }
            break;
         case 'log': // Allow worker to send logs
             console.log('Worker:', ...data.message);
             break;
         case 'error':
            console.error('Worker Error:', data.error);
            break;
    }
};

function chunkKey(cx, cz) {
    return `${cx},${cz}`;
}

export function getChunk(cx, cz) {
    return chunkStorage.get(chunkKey(cx, cz)) || null;
}

// Checks if chunk data exists and is loaded (doesn't check mesh state)
export function hasChunkData(cx, cz) {
    const chunk = getChunk(cx, cz);
    return chunk && chunk.blocks &&
           (chunk.state === CHUNK_STATE.DATA_LOADED ||
            chunk.state === CHUNK_STATE.MESHING ||
            chunk.state === CHUNK_STATE.READY);
}

/**
 * Creates the THREE.Mesh object(s) from geometry data sent by the worker.
 */
function buildMeshFromData(chunk, geometryData) {
    if (!chunk) return;

    // Dispose old mesh first
    disposeChunkMesh(chunk);

    const group = new THREE.Group();
    group.name = `chunk_${chunk.cx}_${chunk.cz}`;

    // --- Recreate Materials (assuming atlas is loaded) ---
    // TODO: Cache materials instead of creating new ones each time!
    const opaqueMaterial = new THREE.MeshLambertMaterial({ map: getTextureAtlas(), side: THREE.FrontSide, alphaTest: 0.1 });
    const transparentMaterial = new THREE.MeshLambertMaterial({ map: getTextureAtlas(), side: THREE.DoubleSide, transparent: true, depthWrite: false });


    // Create Opaque Mesh
    if (geometryData.opaque && geometryData.opaque.positions.length > 0) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(geometryData.opaque.positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(geometryData.opaque.normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(geometryData.opaque.uvs, 2));
        if (geometryData.opaque.indices) geometry.setIndex(geometryData.opaque.indices); // Indices optional if non-indexed
        geometry.computeBoundingSphere();

        const mesh = new THREE.Mesh(geometry, opaqueMaterial); // Use cached material ideally
        group.add(mesh);
    }

    // Create Transparent Mesh
    if (geometryData.transparent && geometryData.transparent.positions.length > 0) {
         const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(geometryData.transparent.positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(geometryData.transparent.normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(geometryData.transparent.uvs, 2));
        if (geometryData.transparent.indices) geometry.setIndex(geometryData.transparent.indices);
        geometry.computeBoundingSphere();

        const mesh = new THREE.Mesh(geometry, transparentMaterial); // Use cached material ideally
        mesh.renderOrder = 1; // Render after opaque
        group.add(mesh);
    }

    chunk.mesh = group;
    // Add to scene - Ensure scene object is accessible
    // TODO: Pass scene or get it from a global/module scope
    const mainScene = getMainScene(); // Assuming you have a way to get the scene
    if (mainScene) {
        mainScene.add(chunk.mesh);
    } else {
        console.error("Scene not available to add chunk mesh!");
    }
}

// Helper to get the main scene (replace with your actual scene access)
let _mainScene = null;
export function setMainScene(scene) { _mainScene = scene; }
function getMainScene() { return _mainScene; }

// Helper to get Texture Atlas (replace with your actual atlas access)
let _textureAtlas = null;
export function setTextureAtlas(atlas) { _textureAtlas = atlas; }
function getTextureAtlas() { return _textureAtlas; }


/**
 * Dispose of a chunk's mesh resources.
 */
function disposeChunkMesh(chunk) {
    if (chunk && chunk.mesh) {
        const scene = getMainScene();
        if (scene) scene.remove(chunk.mesh);

        chunk.mesh.traverse((obj) => {
            if (obj.isMesh) {
                obj.geometry.dispose();
                // Dispose materials ONLY if they are not shared/cached
                // If caching materials, don't dispose them here.
                // obj.material.dispose();
            }
        });
        chunk.mesh = null;
    }
}

/**
 * Get neighbour chunk data required for meshing. Returns null if any neighbour is missing data.
 */
function getNeighbourDataForMeshing(cx, cz) {
    const neighbours = {};
    const requiredOffsets = [
        { dx: 1, dz: 0, key: "1,0" }, { dx: -1, dz: 0, key: "-1,0" },
        { dx: 0, dz: 1, key: "0,1" }, { dx: 0, dz: -1, key: "0,-1" },
    ];

    for (const offset of requiredOffsets) {
        const neighbourChunk = getChunk(cx + offset.dx, cz + offset.dz);
        // Need actual block data for meshing neighbour faces
        if (!neighbourChunk || !neighbourChunk.blocks || neighbourChunk.state < CHUNK_STATE.DATA_LOADED) {
            // console.log(`Neighbour ${cx + offset.dx}, ${cz + offset.dz} not ready for meshing ${cx},${cz}`);
            return null; // A required neighbour's data isn't loaded yet
        }
        // Send only necessary data (blocks) to worker
        neighbours[offset.key] = { blocks: neighbourChunk.blocks };
    }
    return neighbours;
}


/**
 * Request the worker to generate mesh data for a chunk.
 */
function requestChunkMesh(chunk) {
    if (!chunk || !chunk.blocks || chunk.state < CHUNK_STATE.DATA_LOADED || chunk.state === CHUNK_STATE.MESHING) {
        // Already meshing, or data not ready, or chunk doesn't exist
        return;
    }

    const neighbourData = getNeighbourDataForMeshing(chunk.cx, chunk.cz);
    if (neighbourData === null) {
        // console.log(`Deferred meshing for ${chunk.cx},${chunk.cz} - waiting for neighbours.`);
        // Neighbours not ready, meshing will be triggered later when neighbour loads
        // or by updateNeighboursOf()
        chunk.state = CHUNK_STATE.DATA_LOADED; // Ensure it's marked as waiting
        return;
    }

    console.log(`Requesting mesh for chunk ${chunk.cx},${chunk.cz}`);
    chunk.state = CHUNK_STATE.MESHING;
    worker.postMessage({
        type: 'mesh',
        data: {
            cx: chunk.cx,
            cz: chunk.cz,
            blocks: chunk.blocks, // Pass block data
            chunkSize: CHUNK_SIZE, // Pass dimensions if needed by worker mesher
            chunkHeight: CHUNK_HEIGHT,
            neighbourData: neighbourData, // Pass neighbour block data
            // textureAtlasData: textureAtlasData // Worker should already have this from init
            // blockTypes: BLOCK_TYPES // Worker should already have this
        }
    });
}


/**
 * Check neighbours of a freshly loaded/meshed chunk to see if they can now be meshed.
 */
function updateNeighboursOf(cx, cz) {
     const neighbourOffsets = [
        { dx: 1, dz: 0 }, { dx: -1, dz: 0 },
        { dx: 0, dz: 1 }, { dx: 0, dz: -1 },
    ];
    for(const offset of neighbourOffsets) {
        const neighbour = getChunk(cx + offset.dx, cz + offset.dz);
        // If neighbour was waiting for data and hasn't started meshing, try now
        if(neighbour && neighbour.state === CHUNK_STATE.DATA_LOADED) {
            requestChunkMesh(neighbour);
        }
    }
}

/**
 * Request worker to generate chunk block data.
 */
function requestChunkGeneration(cx, cz) {
    const key = chunkKey(cx, cz);
    if (chunkStorage.has(key)) return; // Already exists or is loading

    console.log(`Requesting generation for chunk ${cx},${cz}`);
    const chunk = {
        cx, cz, blocks: null, mesh: null, state: CHUNK_STATE.LOADING_DATA
    };
    chunkStorage.set(key, chunk);
    worker.postMessage({ type: 'generate', data: { cx, cz } });
}

/**
 * Convert world coordinates to chunk and local coordinates.
 */
function worldToVoxelCoords(x, y, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    // Use modulo for local coords that handle negative world coords correctly
    const lx = THREE.MathUtils.euclideanModulo(x, CHUNK_SIZE);
    const ly = Math.floor(y); // Y is absolute
    const lz = THREE.MathUtils.euclideanModulo(z, CHUNK_SIZE);
    return { cx, cz, lx, ly, lz };
}

/**
 * Return block ID at world (x,y,z). Returns BLOCK_AIR if outside bounds or chunk not loaded.
 */
export function getBlock(x, y, z) {
    const { cx, cz, lx, ly, lz } = worldToVoxelCoords(x, y, z);

    // Vertical bounds check
    if (ly < 0 || ly >= CHUNK_HEIGHT) {
        return BLOCK_AIR;
    }

    const chunk = getChunk(cx, cz);
    // Need to ensure block data is actually loaded, not just requested
    if (!chunk || !chunk.blocks || chunk.state < CHUNK_STATE.DATA_LOADED) {
        return BLOCK_AIR; // No chunk data loaded
    }

    return chunk.blocks[lx][ly][lz] ?? BLOCK_AIR; // Access chunk.blocks[lx][y][lz]
}

/**
 * Mark a chunk and potentially its neighbours for mesh rebuild.
 */
function flagChunkForRebuild(cx, cz) {
    const key = chunkKey(cx, cz);
    const chunk = chunkStorage.get(key);
    // Only queue if data is loaded (otherwise it will mesh when data arrives)
    if (chunk && chunk.blocks && chunk.state >= CHUNK_STATE.DATA_LOADED) {
        // Add to queue only if not already processing
         if(chunk.state !== CHUNK_STATE.MESHING) {
            meshRebuildQueue.add(key);
         }
    }
}

/**
 * Place a block and flag chunks for rebuild.
 */
export function addBlock(x, y, z, blockId) {
    const { cx, cz, lx, ly, lz } = worldToVoxelCoords(x, y, z);

    if (ly < 0 || ly >= CHUNK_HEIGHT) return;

    const chunk = getChunk(cx, cz);
    // Can only modify chunks whose data is loaded
    if (!chunk || !chunk.blocks || chunk.state < CHUNK_STATE.DATA_LOADED) {
        console.warn(`Attempted to add block in unloaded chunk ${cx},${cz}`);
        return; // Or maybe queue the change? For now, just ignore.
    }

    // Check if block actually changed
    if (chunk.blocks[lx][ly][lz] === blockId) return;

    chunk.blocks[lx][ly][lz] = blockId;
    console.log(`Added block ${blockId} at ${lx},${ly},${lz} in chunk ${cx},${cz}`);

    // Flag this chunk for rebuild
    flagChunkForRebuild(cx, cz);

    // Flag neighbours if the block is on a chunk boundary
    if (lx === 0) flagChunkForRebuild(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) flagChunkForRebuild(cx + 1, cz);
    if (lz === 0) flagChunkForRebuild(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) flagChunkForRebuild(cx, cz + 1);
    // Changes in Y don't affect neighbour meshes
}

/**
 * Remove a block (set to air) and flag chunks for rebuild.
 */
export function removeBlock(x, y, z) {
    addBlock(x, y, z, BLOCK_AIR); // Removing is just adding air
}

/**
 * Process the mesh rebuild queue incrementally. Call this periodically.
 */
export function processRebuildQueue(maxPerFrame = 1) {
    let processed = 0;
    const keys = Array.from(meshRebuildQueue); // Process a snapshot

    for (const key of keys) {
        if (processed >= maxPerFrame) break;

        const chunk = chunkStorage.get(key);
        if (chunk && chunk.state !== CHUNK_STATE.MESHING && chunk.state >= CHUNK_STATE.DATA_LOADED) {
            requestChunkMesh(chunk); // Request worker to remesh
            meshRebuildQueue.delete(key); // Remove from queue once requested
            processed++;
        } else if (!chunk || chunk.state === CHUNK_STATE.UNLOADING) {
             meshRebuildQueue.delete(key); // Remove if chunk gone or unloading
        } else {
            // Still waiting for data or already meshing, leave in queue? Or remove?
             // If already meshing, it will get latest data, so remove.
             if(chunk && chunk.state === CHUNK_STATE.MESHING) meshRebuildQueue.delete(key);
        }
    }
}


/**
 * Load/request chunks within render distance, unload those outside.
 */
export function updateWorld(px, pz) {
    const playerCX = Math.floor(px / CHUNK_SIZE);
    const playerCZ = Math.floor(pz / CHUNK_SIZE);
    const inRangeKeys = new Set();

    // Phase 1: Identify needed chunks and request generation if missing
    for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
        for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
            const cx = playerCX + dx;
            const cz = playerCZ + dz;
            const key = chunkKey(cx, cz);
            inRangeKeys.add(key);

            const chunk = chunkStorage.get(key);
            if (!chunk || chunk.state === CHUNK_STATE.UNKNOWN) {
                // Request generation if we don't have it and it's not loading
                requestChunkGeneration(cx, cz);
            } else if (chunk.state === CHUNK_STATE.UNLOADING) {
                 // It was marked for unloading but is needed again, revert state
                 chunk.state = CHUNK_STATE.READY; // Or DATA_LOADED if mesh wasn't ready
                 if(chunk.mesh) getMainScene()?.add(chunk.mesh); // Re-add mesh if it existed
            }
        }
    }

    // Phase 2: Identify chunks to unload
    for (const [key, chunk] of chunkStorage.entries()) {
        if (!inRangeKeys.has(key) && chunk.state !== CHUNK_STATE.UNLOADING) {
            console.log(`Unloading chunk ${chunk.cx},${chunk.cz}`);
            chunk.state = CHUNK_STATE.UNLOADING;
            disposeChunkMesh(chunk); // Remove mesh immediately
            // Optionally: could post message to worker to cancel ongoing work for this chunk
            // worker.postMessage({ type: 'cancel', data: { cx: chunk.cx, cz: chunk.cz }});

            // Delay actual removal from storage slightly? Or remove now?
            // For simplicity, let's remove now. If needed again, it will be regenerated.
             chunkStorage.delete(key);
        }
    }

     // Phase 3: Process rebuild queue (call this from your main loop)
     processRebuildQueue();
}

// Example of how to call from your main loop:
// function animate() {
//     requestAnimationFrame(animate);
//     const playerPos = getPlayerPosition(); // Get player's world x, z
//     updateWorld(playerPos.x, playerPos.z);
//     renderer.render(scene, camera);
// }
