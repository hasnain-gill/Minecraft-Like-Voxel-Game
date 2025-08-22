// camera.js
import * as THREE from 'three';
// Import player object for initial position and helper for eye height
import { player, getPlayerEyeHeight } from './player.js';

// --- Configuration ---
export const CAMERA_CONFIG = {
    fov: 75, // Vertical field of view in degrees
    aspect: window.innerWidth / window.innerHeight, // Aspect ratio
    near: 0.1, // Near clipping plane
    far: 1000, // Far clipping plane (adjust based on render distance)
    sensitivity: 0.002, // Mouse sensitivity for rotation
    maxPitch: Math.PI / 2 - 0.01, // Max pitch angle (radians) - slightly less than 90 deg
    minPitch: -Math.PI / 2 + 0.01, // Min pitch angle (radians) - slightly less than -90 deg
};

// --- Module Exports ---
// Export references for potential use in other modules (e.g., raycasting, movement)
export let camera;
export let playerYawObject; // Rotates horizontally (around Y axis) - Tied to player position
export let playerPitchObject; // Rotates vertically (around X axis) - Child of Yaw object

/**
 * Initializes the perspective camera and the yaw/pitch control rig.
 * The structure is: Scene -> playerYawObject -> playerPitchObject -> camera
 * @param {THREE.Scene} scene - The main scene to add the camera rig to.
 * @param {number} initialYOffset - The initial eye height offset from player feet.
 */
export function initCamera(scene, initialYOffset) {
    // Create the main perspective camera
    camera = new THREE.PerspectiveCamera(
        CAMERA_CONFIG.fov,
        CAMERA_CONFIG.aspect,
        CAMERA_CONFIG.near,
        CAMERA_CONFIG.far
    );

    // Create the container object for Yaw (horizontal rotation - around Y)
    playerYawObject = new THREE.Object3D();

    // Create the container object for Pitch (vertical rotation - around X)
    playerPitchObject = new THREE.Object3D();

    // Establish the hierarchy: Yaw controls Pitch, Pitch controls Camera
    playerYawObject.add(playerPitchObject);
    playerPitchObject.add(camera);

    // Add the top-level Yaw object to the scene
    scene.add(playerYawObject);

    // --- Set Initial Position ---
    // The Yaw object's position should match the player's base position + eye height.
    // This rig is then moved by the movement/physics system each frame.
    playerYawObject.position.copy(player.position); // Start at player's feet world position
    // Set initial vertical position based on helper function (accounts for crouch state)
    playerYawObject.position.y = player.position.y + initialYOffset;

    // Add listener for window resize to update aspect ratio
    window.addEventListener('resize', onWindowResize);
}

/**
 * Handles window resize events to update camera aspect ratio.
 */
function onWindowResize() {
    if (!camera || !renderer) return; // Add renderer check if needed here or globally
    CAMERA_CONFIG.aspect = window.innerWidth / window.innerHeight; // Update config aspect ratio
    camera.aspect = CAMERA_CONFIG.aspect;
    camera.updateProjectionMatrix();
    // Note: Renderer size update is handled in the main file's onWindowResize
}


/**
 * Rotates the yaw/pitch objects based on mouse movement delta.
 * Called from the main mousemove event listener when pointer lock is active.
 * @param {MouseEvent} event - The mouse move event.
 */
export function onMouseMove(event) {
    // Only rotate if pointer lock is active
    if (document.pointerLockElement) {
        // --- Yaw Rotation (Horizontal - Left/Right) ---
        // Rotate the Yaw object around its local Y axis.
        // Negative movementX corresponds to rotating left (decreasing Y rotation).
        playerYawObject.rotation.y -= event.movementX * CAMERA_CONFIG.sensitivity;

        // --- Pitch Rotation (Vertical - Up/Down) ---
        // Rotate the Pitch object around its local X axis.
        // Negative movementY corresponds to looking up (decreasing X rotation).
        playerPitchObject.rotation.x -= event.movementY * CAMERA_CONFIG.sensitivity;

        // --- Clamp Pitch Rotation ---
        // Prevent looking straight up/down or flipping over.
        playerPitchObject.rotation.x = Math.max(
            CAMERA_CONFIG.minPitch,
            Math.min(CAMERA_CONFIG.maxPitch, playerPitchObject.rotation.x)
        );
    }
}

// --- Optional Enhancements (Placeholders) ---

/**
 * Placeholder function to apply view bobbing effects.
 * Would be called from the main animation loop.
 * @param {number} deltaTime - Time since last frame.
 * @param {number} horizontalSpeed - Current horizontal speed of the player.
 * @param {boolean} onGround - Whether the player is on the ground.
 */
export function applyViewBob(deltaTime, horizontalSpeed, onGround) {
    // if (horizontalSpeed > 0.1 && onGround) {
    //     const bobTime = performance.now() * 0.01; // Adjust frequency
    //     const bobAmount = 0.02; // Adjust intensity
    //     camera.position.y = Math.sin(bobTime) * bobAmount; // Simple vertical bob
    //     camera.position.x = Math.cos(bobTime * 0.5) * bobAmount * 0.5; // Slight horizontal sway
    // } else {
    //     // Lerp back to neutral position smoothly
    //     camera.position.lerp(new THREE.Vector3(0, 0, 0), deltaTime * 10);
    // }
}

/**
 * Placeholder function to dynamically set the Field of View (FOV).
 * Useful for sprinting effects or zooming.
 * @param {number} newFOV - The desired vertical FOV in degrees.
 * @param {boolean} [instant=false] - If true, change instantly; otherwise, lerp smoothly.
 */
export function setFOV(newFOV, instant = false) {
    // if (instant) {
    //     camera.fov = newFOV;
    //     camera.updateProjectionMatrix();
    // } else {
    //     // TODO: Implement smooth FOV transition using lerp in the animate loop
    // }
}
