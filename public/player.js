import * as THREE from 'three'; // Assuming THREE is imported or available globally

// --- Player Configuration & Physics Constants ---

export const PLAYER_CONFIG = {
    // Dimensions
    height: 1.8,            // Player height in blocks
    radius: 0.3,            // Horizontal collision cylinder radius
    crouchHeight: 1.0,      // Height when crouching
    stepHeight: 0.5,        // Max height player can step up automatically

    // Movement Speeds
    baseMoveSpeed: 5.0,     // Base horizontal speed (in blocks per second - adjust based on update loop)
    jumpVerticalSpeed: 6.0, // Initial vertical speed when jumping (blocks per second)
    crouchSpeedMultiplier: 0.5, // Factor to multiply move speed by when crouching

    // Physics
    gravity: 20.0,           // Downward acceleration (blocks per second squared)
    terminalVelocity: 50.0, // Max downward speed (blocks per second)

    // Damping factor (0 = infinite friction, 1 = no friction). Applied each frame.
    // Lower values = more friction/less sliding. Adjust based on physics update frequency.
    // Example: 0.05 means velocity retains 95% each physics step. Might need conversion if using delta time.
    // Let's define it as how much velocity is *kept* per second, easier with delta time.
    horizontalDamping: 0.2, // Keep 20% of horizontal velocity per second (higher = more slippery)
    // Vertical damping is usually implicitly handled by gravity/terminal velocity

    // Camera
    cameraOffsetY: 1.6,      // Camera height above player's feet position (normal)
    cameraCrouchOffsetY: 0.8,// Camera height when crouching
};

// --- Player State Object ---

export const PLAYER_STATE = {
    IDLE: 'idle',
    WALKING: 'walking',
    JUMPING: 'jumping',
    FALLING: 'falling',
    CROUCHING: 'crouching',
    // Add more states like 'running', 'swimming' if needed
};

export const player = {
    // Position and Velocity are core state, managed by physics updates
    position: new THREE.Vector3(0, 30, 0), // Initial position (Y should be set dynamically post-worldgen)
    velocity: new THREE.Vector3(0, 0, 0),

    // State Flags
    onGround: false,
    isCrouching: false,
    currentState: PLAYER_STATE.IDLE,

    // View Direction (managed by camera controls) - often stored separately or on camera object
    // yaw: 0,
    // pitch: 0,

    // Other potential state: health, stamina, inventory reference, etc.
    // health: 100,
    // stamina: 100,
};

// --- Input State ---
// Simple object to track key presses. A dedicated InputManager is better for complex games.
export const keys = {
    // Example keys - these would be set to true/false by event listeners
    // 'w': false,
    // 'a': false,
    // 's': false,
    // 'd': false,
    // ' ': false, // Jump
    // 'ShiftLeft': false, // Sprint/Crouch modifier
    // 'ControlLeft': false, // Crouch modifier
};

// --- Helper Function (Example) ---

/**
 * Gets the current eye height based on player state.
 * @returns {number} Camera offset Y.
 */
export function getPlayerEyeHeight() {
    return player.isCrouching ? PLAYER_CONFIG.cameraCrouchOffsetY : PLAYER_CONFIG.cameraOffsetY;
}

/**
 * Gets the current player collision height based on state.
 * @returns {number} Collision height.
 */
export function getPlayerCollisionHeight() {
    return player.isCrouching ? PLAYER_CONFIG.crouchHeight : PLAYER_CONFIG.height;
}
