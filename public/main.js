import * as THREE from 'three';
// Camera, Player, Movement imports (assuming they are enhanced as discussed previously)
import { initCamera, onMouseMove, camera, playerPitchObject, playerYawObject } from './camera.js';
import { keys, player, PLAYER_CONFIG, PLAYER_STATE, getPlayerCollisionHeight, getPlayerEyeHeight } from './player.js';
import { updateMovement } from './movement.js'; // Assumes this uses the refined checkCollision
// World imports (assuming async worker setup, state management)
import {
    BLOCK_TYPES, CHUNK_SIZE, CHUNK_HEIGHT, RENDER_DISTANCE,
    getChunk, hasChunkData, worldChunkPromiseManager, // Need a way to track loading promises
    requestChunkGeneration, // Trigger worker generation
    setMainScene as setWorldScene, // Pass scene to world module
    setTextureAtlas as setWorldAtlas, // Pass texture atlas info to world module (maybe just config)
    processRebuildQueue, // Process chunks needing remeshing
    addBlock, removeBlock, getBlock // World interaction functions
} from './world.js';
// Collision import (will be refined)
import { checkCollision } from './collision.js'; // Assumes this is now more sophisticated
// Worldgen import (for spawn height)
import { getSurfaceHeight } from './worldgen.js';
// UI Framework (using simple HTML/CSS structure for now)
// import { initUI, updateUI } from './ui.js'; // Placeholder for a dedicated UI module
// Sound Effects
import { initAudio, playSound, playBlockSound } from './audio.js'; // Placeholder for audio module

// --- Global Variables ---
let scene, renderer, clock;
let selectedBlock = 0; // Default block type index
const hotbarElements = [];
const interactionReach = 5; // Max distance in blocks

// Block Highlighting
let highlightMesh;
const highlightMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
const highlightGeometry = new THREE.PlaneGeometry(1.01, 1.01); // Slightly larger than block face

// Loading State
let isLoading = true; // Flag to control when game loop starts full updates

// --- Main Execution ---
// Use an async function to allow waiting for initial world load
async function main() {
    await init(); // Wait for initialization (including initial chunk load)
    isLoading = false; // Mark loading as complete
    console.log("Initialization complete. Starting animation loop.");
    animate(); // Start the main loop
}
main(); // Run the async main function


// --- Initialization (Async) ---
async function init() {
    console.log("Initializing...");
    clock = new THREE.Clock();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(50, 100, 25);
    scene.add(sun);
    scene.add(sun.target);

    // Player Spawn Position (Calculated before async loading)
    let spawnX = 0, spawnZ = 0;
    try {
        const surfaceY = getSurfaceHeight(spawnX, spawnZ);
        player.position.set(spawnX + 0.5, surfaceY + 0.5, spawnZ + 0.5); // Center in block
        console.log(`Player spawn calculated at: ${player.position.x.toFixed(2)}, ${player.position.y.toFixed(2)}, ${player.position.z.toFixed(2)}`);
    } catch (error) {
        console.error("Failed to get surface height for spawn:", error);
        player.position.set(0.5, 30.5, 0.5); // Fallback spawn
    }

    // Initialize Camera (after player position is set)
    initCamera(scene, getPlayerEyeHeight()); // Use helper for eye height

    // Setup World Module (Pass scene, etc.)
    setWorldScene(scene); // Allow world module to add/remove meshes
    // TODO: Load texture atlas and pass info/bitmap to world module/worker
    // let textureAtlas = loadMyTextureAtlas();
    // setWorldAtlas(textureAtlas);

    // Initialize Audio System
    initAudio(camera); // Needs camera for listener position

    // --- Asynchronous Initial Chunk Loading ---
    console.log("Requesting initial chunks...");
    const initialLoadPromises = [];
    const initialRadius = 1; // Load a small radius around spawn synchronously-ish
    const playerCX = Math.floor(player.position.x / CHUNK_SIZE);
    const playerCZ = Math.floor(player.position.z / CHUNK_SIZE);

    for (let dx = -initialRadius; dx <= initialRadius; dx++) {
        for (let dz = -initialRadius; dz <= initialRadius; dz++) {
            const cx = playerCX + dx;
            const cz = playerCZ + dz;
            // Use the promise manager from world.js to get/create a promise for this chunk
            initialLoadPromises.push(worldChunkPromiseManager.ensureChunkReady(cx, cz));
            // Trigger generation if not already loading (ensureChunkReady should handle this)
             // requestChunkGeneration(cx, cz); // This might be handled within ensureChunkReady
        }
    }

    // Wait for all essential initial chunks to be generated AND meshed
    try {
        await Promise.all(initialLoadPromises);
        console.log("Initial chunks loaded and meshed.");
    } catch (error) {
        console.error("Error loading initial chunks:", error);
        // Handle error appropriately - maybe proceed with fewer chunks?
    }
    // --- End Async Load ---

    // Initialize Block Highlighter
    highlightMesh = new THREE.Mesh(highlightGeometry, highlightMaterial);
    highlightMesh.visible = false;
    scene.add(highlightMesh);

    // Input Event Listeners (added after initial load potentially)
    document.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; handleKeyDown(e); });
    document.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('click', () => {
        if (!document.pointerLockElement) {
            document.body.requestPointerLock({ unadjustedMovement: true })
                .catch(err => console.warn("Cannot request pointer lock:", err));
        }
    });
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('resize', onWindowResize);

    // UI Elements
    createUILayout(); // Setup main UI container
    createCrosshair();
    createHotbar();
    updateHotbarSelection();

    console.log("Initialization sequence finished.");
}

// --- Core Animation Loop ---
function animate() {
    requestAnimationFrame(animate);
    if (isLoading) return; // Don't run updates until init is complete

    const deltaTime = Math.min(0.05, clock.getDelta()); // Clamp delta time to avoid large jumps

    // 1. Update Block Highlighting
    updateBlockHighlight();

    // 2. Update player movement and physics
    updateMovement(deltaTime); // Assumes movement.js calls the refined checkCollision

    // 3. Update World (load/unload chunks based on player pos, process mesh queue)
    // Make updateWorld handle async requests internally now
    updateWorld(player.position.x, player.position.z); // Scene already passed in init
    processRebuildQueue(); // Process any pending mesh updates

    // 4. Update UI (if needed)
    // updateUI(deltaTime); // Placeholder for dynamic UI updates

    // 5. Render the scene
    renderer.render(scene, camera);
}

// --- Event Handlers ---
function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function handleKeyDown(event) {
    // Hotbar selection
    if (event.key >= '1' && event.key <= '9') {
        selectHotbar(parseInt(event.key) - 1);
    } else if (event.key === '0') {
        selectHotbar(9); // 10th slot
    }

    // Placeholder for opening inventory/menu
    if (event.key === 'e') {
        console.log("Inventory key pressed (UI not implemented)");
        // toggleInventoryUI();
    }
    if (event.key === 'escape') {
         if (document.pointerLockElement) {
             document.exitPointerLock();
             console.log("Exited pointer lock (Menu UI not implemented)");
             // showMainMenu();
         }
    }
}

function getTargetedBlock() {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    raycaster.far = interactionReach;
    const intersects = raycaster.intersectObjects(scene.children, true)
                               .filter(intersect => intersect.object.isMesh); // Only care about meshes

    if (intersects.length > 0) {
        const intersect = intersects[0];
        const pointSub = intersect.point.clone().sub(raycaster.ray.direction.clone().multiplyScalar(0.01));
        const pointAdd = intersect.point.clone().add(raycaster.ray.direction.clone().multiplyScalar(0.01));

        // Ensure face normal is available and reasonable
        const normal = intersect.face?.normal?.clone();
        if (!normal) return null; // Need normal for highlight orientation

        // Make sure normal is in world space if the object is rotated/scaled
        // For chunk meshes that aren't rotated, object normal == world normal
         // If using InstancedMesh, might need: normal.transformDirection(intersect.object.matrixWorld);

        return {
            remove: { x: Math.floor(pointSub.x), y: Math.floor(pointSub.y), z: Math.floor(pointSub.z) },
            add: { x: Math.floor(pointAdd.x), y: Math.floor(pointAdd.y), z: Math.floor(pointAdd.z) },
            normal: normal, // World-space normal of the face hit
            position: { x: Math.floor(pointSub.x), y: Math.floor(pointSub.y), z: Math.floor(pointSub.z) } // Position of the block hit
        };
    }
    return null;
}


function updateBlockHighlight() {
    if (!highlightMesh) return;

    const target = getTargetedBlock();

    if (target && target.position) {
         // Position the highlight slightly offset from the block face
         highlightMesh.position.set(
             target.position.x + 0.5, // Center of the block
             target.position.y + 0.5,
             target.position.z + 0.5
         );
         // Use the normal to orient the highlight plane
         highlightMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), target.normal);
         // Offset slightly *out* from the face
         highlightMesh.position.addScaledVector(target.normal, 0.005);

        highlightMesh.visible = true;
    } else {
        highlightMesh.visible = false;
    }
}

function onMouseDown(event) {
    if (!document.pointerLockElement) {
        if(!isLoading) document.body.requestPointerLock({ unadjustedMovement: true }).catch(err => {}); // Request lock if not loading
        return;
    }

    const target = getTargetedBlock();
    if (!target) return; // No block targeted

    const { remove: removeCoords, add: addCoords } = target;

    if (event.button === 0) { // Left click - Remove block
        console.log(`Attempt remove at: ${removeCoords.x}, ${removeCoords.y}, ${removeCoords.z}`);
        const removedBlockType = getBlock(removeCoords.x, removeCoords.y, removeCoords.z); // Get type before removing
        if (removeBlock(removeCoords.x, removeCoords.y, removeCoords.z)) { // Check if removal was successful
             playBlockSound(removedBlockType, 'break', new THREE.Vector3(removeCoords.x + 0.5, removeCoords.y + 0.5, removeCoords.z + 0.5));
        }
    } else if (event.button === 2) { // Right click - Place block
        console.log(`Attempt place at: ${addCoords.x}, ${addCoords.y}, ${addCoords.z} (type: ${selectedBlock})`);

        // Collision Check Before Placing
        const playerHeight = getPlayerCollisionHeight();
        const playerRadius = PLAYER_CONFIG.radius;
        const playerAABB = new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(player.position.x, player.position.y + playerHeight / 2, player.position.z), // Center of player AABB
            new THREE.Vector3(playerRadius * 2, playerHeight, playerRadius * 2)
        );
        const blockAABB = new THREE.Box3(
            new THREE.Vector3(addCoords.x, addCoords.y, addCoords.z),
            new THREE.Vector3(addCoords.x + 1, addCoords.y + 1, addCoords.z + 1)
        );

        if (playerAABB.intersectsBox(blockAABB)) {
            console.log("Cannot place block: intersects player.");
            return;
        }
        // End Collision Check

        if (addBlock(addCoords.x, addCoords.y, addCoords.z, selectedBlock)) { // Check if adding was successful
            playBlockSound(selectedBlock, 'place', new THREE.Vector3(addCoords.x + 0.5, addCoords.y + 0.5, addCoords.z + 0.5));
        }
    }
}

// --- UI Functions ---

function createUILayout() {
    // Ensure a main container exists
    let uiContainer = document.getElementById('ui-container');
    if (!uiContainer) {
        uiContainer = document.createElement('div');
        uiContainer.id = 'ui-container';
        document.body.appendChild(uiContainer);
        // Basic styles for the container could be added via CSS
        /* Example CSS:
        #ui-container {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none; // Allow clicks to pass through normally
            overflow: hidden; // Prevent scrollbars if content overflows
            z-index: 10; // Ensure UI is above renderer canvas
        }
        #ui-container > * { // Allow pointer events on direct children like hotbar/menus
             pointer-events: auto;
        }
        */
    }
    // Ensure hotbar exists within the container
    let hotbar = document.getElementById('hotbar');
    if (!hotbar) {
        hotbar = document.createElement('div');
        hotbar.id = 'hotbar';
        uiContainer.appendChild(hotbar);
         /* Example CSS for hotbar positioning:
         #hotbar {
            position: absolute;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            background-color: rgba(0,0,0,0.3);
            padding: 5px;
            border-radius: 3px;
         }
         .block-item { ... }
         .block-item.selected { ... }
         */
    }
}


function createCrosshair() {
    // Ensure it's within the UI container
    const uiContainer = document.getElementById('ui-container');
    if (!uiContainer) return;

    let crosshair = document.getElementById('crosshair');
    if (!crosshair) {
        crosshair = document.createElement('div');
        crosshair.id = 'crosshair';
        uiContainer.appendChild(crosshair);
         // Apply styles via CSS (see previous example)
    }
}

function createHotbar() {
    const hotbar = document.getElementById('hotbar');
    if (!hotbar) {
        console.error("Element with ID 'hotbar' not found!");
        return;
    }
    hotbar.innerHTML = '';
    hotbarElements.length = 0;

    const maxHotbarItems = Math.min(Object.keys(BLOCK_TYPES).filter(id => id >= 0).length, 10); // Filter out air, limit to 10
    let displayedItems = 0;

     // Iterate through block types ensuring a consistent order if BLOCK_TYPES is an object
     const blockIds = Object.keys(BLOCK_TYPES)
                           .map(id => parseInt(id))
                           .filter(id => id >= 0) // Exclude air/negative IDs
                           .sort((a, b) => a - b); // Sort IDs numerically

    for(const id of blockIds) {
        if (displayedItems >= maxHotbarItems) break;
        const btype = BLOCK_TYPES[id];
        if (!btype) continue;

        const div = document.createElement('div');
        div.className = 'block-item';
        div.style.backgroundColor = '#' + (btype.color || 0xcccccc).toString(16).padStart(6, '0');
        // TODO: Add background image logic for textures
        div.title = btype.name || `Block ${id}`;
        div.dataset.blockId = id; // Store actual block ID

        div.addEventListener('click', () => {
            selectHotbarById(id);
        });

        hotbar.appendChild(div);
        hotbarElements.push(div);
        displayedItems++;
    }

    if (hotbarElements.length > 0) {
        selectHotbarById(parseInt(hotbarElements[0].dataset.blockId)); // Select first available block ID
    }
}

// Select by actual Block ID now
function selectHotbarById(blockId) {
    if (BLOCK_TYPES[blockId] === undefined || BLOCK_TYPES[blockId].id < 0) return; // Ensure it's a valid, non-air block
    selectedBlock = blockId; // Store the ID
    console.log(`Selected block ID: ${blockId}`);
    updateHotbarSelection();
}


function updateHotbarSelection() {
    hotbarElements.forEach((div) => {
        // Compare dataset block ID with the currently selected block ID
        if (parseInt(div.dataset.blockId) === selectedBlock) {
            div.classList.add('selected');
        } else {
            div.classList.remove('selected');
        }
    });
     // Add CSS: .block-item.selected { border: 2px solid yellow; box-shadow: 0 0 5px yellow; }
}

// Placeholder for refined collision check - Move this to collision.js
// import { getBlock } from './world.js'; // Need world access
// function checkCollision(position, radius, height) {
//     const playerAABB = new THREE.Box3(
//         new THREE.Vector3(position.x - radius, position.y, position.z - radius),
//         new THREE.Vector3(position.x + radius, position.y + height, position.z + radius)
//     );
//     // Get voxel range player overlaps
//     const minX = Math.floor(playerAABB.min.x);
//     const maxX = Math.floor(playerAABB.max.x);
//     const minY = Math.floor(playerAABB.min.y);
//     const maxY = Math.floor(playerAABB.max.y);
//     const minZ = Math.floor(playerAABB.min.z);
//     const maxZ = Math.floor(playerAABB.max.z);

//     for (let y = minY; y <= maxY; y++) {
//         for (let z = minZ; z <= maxZ; z++) {
//             for (let x = minX; x <= maxX; x++) {
//                 const blockId = getBlock(x, y, z); // Requires world access
//                 const blockType = BLOCK_TYPES[blockId];
//                 if (blockId !== undefined && blockId !== -1 && (!blockType || !blockType.transparent)) { // Check if block is solid
//                     // Check for AABB intersection
//                     const blockAABB = new THREE.Box3(
//                          new THREE.Vector3(x, y, z),
//                          new THREE.Vector3(x + 1, y + 1, z + 1)
//                     );
//                     if (playerAABB.intersectsBox(blockAABB)) {
//                         return true; // Collision detected
//                     }
//                 }
//             }
//         }
//     }
//     return false; // No collision
// }

// Placeholder for audio module - Move this to audio.js
// let audioListener;
// const sounds = {};
// const loader = new THREE.AudioLoader();

// function initAudio(camera) {
//     audioListener = new THREE.AudioListener();
//     camera.add(audioListener); // Attach listener to camera

//     // Preload sounds
//     loadSound('jump', 'sounds/jump.wav');
//     loadSound('step_stone1', 'sounds/step_stone1.wav');
//     // ... load other sounds (break_stone, place_wood, etc.)
// }

// function loadSound(name, path) {
//     loader.load(path, (buffer) => {
//         sounds[name] = buffer;
//         console.log(`Sound loaded: ${name}`);
//     }, undefined, (err) => {
//         console.error(`Failed to load sound ${name}:`, err);
//     });
// }

// function playSound(name, volume = 0.5) {
//     if (!sounds[name] || !audioListener) return;
//     const sound = new THREE.Audio(audioListener);
//     sound.setBuffer(sounds[name]);
//     sound.setVolume(volume);
//     sound.play();
// }

// function playBlockSound(blockId, action, position, volume = 0.5) {
//      if (!audioListener) return;
//      const blockType = BLOCK_TYPES[blockId]?.name || 'default'; // e.g., 'stone', 'grass', 'wood'
//      const soundName = `${action}_${blockType}`; // e.g., 'break_stone', 'place_wood'

//      if (!sounds[soundName]) {
//          // Fallback sound? e.g., play generic break/place
//          console.warn(`Sound not found for ${soundName}, playing fallback?`);
//          // playSound(`generic_${action}`);
//          return;
//      }

//      const sound = new THREE.PositionalAudio(audioListener);
//      sound.setBuffer(sounds[soundName]);
//      sound.setRefDistance(5); // Adjust based on desired falloff
//      sound.setRolloffFactor(2);
//      sound.setVolume(volume);

//      // Need a mesh to attach positional audio to, or update position manually
//      // Creating a temporary mesh is one way:
//      const mesh = new THREE.Object3D(); // Use Object3D, no geometry needed
//      mesh.position.copy(position);
//      scene.add(mesh); // Add temporarily to scene graph for position updates
//      mesh.add(sound);
//      sound.play();

//      // Optional: Remove the temporary object after sound finishes playing
//      sound.onEnded = () => {
//           sound.isPlaying = false; // Three.js doesn't reset this automatically for PositionalAudio sometimes
//           mesh.remove(sound);
//           scene.remove(mesh);
//      };
//      // If the sound might be stopped early, ensure cleanup happens then too
// }
