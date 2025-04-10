import * as THREE from 'three';
import { player, keys, PLAYER_CONFIG, PLAYER_STATE, getPlayerCollisionHeight, getPlayerEyeHeight } from './player.js';
// Assume collision check function takes player state/position/dimensions
import { checkCollision } from './collision.js';
import { playerYawObject } from './camera.js'; // Contains player horizontal view direction

// Temporary vector for calculations to avoid allocations in the loop
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveDirection = new THREE.Vector3();
const _horizontalVelocity = new THREE.Vector3();

/**
 * Updates player movement, physics, and collisions based on input and deltaTime.
 * @param {number} deltaTime - Time elapsed since the last frame (in seconds).
 */
export function updateMovement(deltaTime) {
    if (!player || !PLAYER_CONFIG) return; // Safety check

    // --- 1. Input Handling ---

    // Get movement direction vectors based on player's yaw (horizontal look direction)
    _forward.set(0, 0, -1).applyQuaternion(playerYawObject.quaternion); // Use quaternion for accuracy
    _right.set(1, 0, 0).applyQuaternion(playerYawObject.quaternion);

    // Determine movement intention from keys
    _moveDirection.set(0, 0, 0);
    if (keys['w']) _moveDirection.add(_forward);
    if (keys['s']) _moveDirection.sub(_forward);
    if (keys['a']) _moveDirection.sub(_right); // Strafe left
    if (keys['d']) _moveDirection.add(_right); // Strafe right

    // Normalize horizontal movement vector if diagonal (to prevent faster diagonal speed)
    if (_moveDirection.lengthSq() > 0) { // Check length squared for efficiency
        _moveDirection.normalize();
    }

    // --- 2. State Updates (Crouch, Sprint) ---
    const wasCrouching = player.isCrouching;
    player.isCrouching = keys['ControlLeft'] || keys['c']; // Example crouch keys

    // Prevent standing up into an obstacle
    if (wasCrouching && !player.isCrouching) {
        const standCheckPos = player.position.clone();
        standCheckPos.y += (PLAYER_CONFIG.height - PLAYER_CONFIG.crouchHeight) / 2; // Check around torso height
        if (checkCollision(standCheckPos, PLAYER_CONFIG.radius, PLAYER_CONFIG.height)) {
            player.isCrouching = true; // Cannot stand up, force crouch
        }
    }

    const isSprinting = keys['ShiftLeft'] && player.onGround && !player.isCrouching; // Can only sprint on ground, not crouching

    // Determine target speed based on state
    let currentSpeed = PLAYER_CONFIG.baseMoveSpeed;
    if (isSprinting) {
        // TODO: Implement sprint speed, potentially linked to stamina
        currentSpeed *= 1.5; // Example: Sprint is 50% faster
    } else if (player.isCrouching) {
        currentSpeed *= PLAYER_CONFIG.crouchSpeedMultiplier;
    }

    // --- 3. Velocity Updates ---

    // Horizontal Velocity
    // Apply input direction to velocity
    _horizontalVelocity.copy(_moveDirection).multiplyScalar(currentSpeed);

    // Apply damping (simulates friction/air resistance)
    // Using an exponential decay based on damping factor and delta time
    const dampingFactor = Math.pow(PLAYER_CONFIG.horizontalDamping, deltaTime);
    player.velocity.x = THREE.MathUtils.lerp(player.velocity.x, _horizontalVelocity.x, 1 - dampingFactor);
    player.velocity.z = THREE.MathUtils.lerp(player.velocity.z, _horizontalVelocity.z, 1 - dampingFactor);


    // Vertical Velocity (Jumping)
    // Only allow jump if on ground and not trying to crouch
    if (keys[' '] && player.onGround && !player.isCrouching) {
        player.velocity.y = PLAYER_CONFIG.jumpVerticalSpeed;
        player.onGround = false;
    }

    // Apply Gravity
    player.velocity.y -= PLAYER_CONFIG.gravity * deltaTime;

    // Clamp to Terminal Velocity
    player.velocity.y = Math.max(player.velocity.y, -PLAYER_CONFIG.terminalVelocity);


    // --- 4. Collision Detection & Resolution (Axis-by-Axis) ---

    const collisionHeight = getPlayerCollisionHeight();
    const steps = 3; // Number of steps for collision checks (more steps = more accurate but slower)

    // Calculate total displacement for this frame
    const deltaPosition = player.velocity.clone().multiplyScalar(deltaTime);

    player.onGround = false; // Assume not on ground unless collision below proves otherwise

    // Check and resolve Y movement
    for (let i = 0; i < steps; i++) {
        const stepDeltaY = deltaPosition.y / steps;
        player.position.y += stepDeltaY;
        // Pass player state/position/dimensions to collision check
        if (checkCollision(player.position, PLAYER_CONFIG.radius, collisionHeight)) {
            player.position.y -= stepDeltaY; // Step back
            // Check if collision was below (hitting ground)
            if (deltaPosition.y < 0) {
                player.onGround = true;
                // TODO: Implement step-up logic here if desired
            }
            player.velocity.y = 0; // Stop vertical movement on collision
            deltaPosition.y = 0; // Prevent further Y movement this frame
            break; // Exit Y checks
        }
    }


    // Check and resolve X movement
     for (let i = 0; i < steps; i++) {
        const stepDeltaX = deltaPosition.x / steps;
        player.position.x += stepDeltaX;
        if (checkCollision(player.position, PLAYER_CONFIG.radius, collisionHeight)) {
            player.position.x -= stepDeltaX;
            player.velocity.x = 0;
            deltaPosition.x = 0;
            break;
        }
    }

    // Check and resolve Z movement
     for (let i = 0; i < steps; i++) {
        const stepDeltaZ = deltaPosition.z / steps;
        player.position.z += stepDeltaZ;
         if (checkCollision(player.position, PLAYER_CONFIG.radius, collisionHeight)) {
            player.position.z -= stepDeltaZ;
            player.velocity.z = 0;
            deltaPosition.z = 0;
            break;
        }
    }

    // --- 5. Update Player State ---
    if (player.onGround) {
        if (player.velocity.x !== 0 || player.velocity.z !== 0) {
             if(player.isCrouching) {
                 player.currentState = PLAYER_STATE.CROUCHING; // Or CROUCH_WALKING if you add it
             } else {
                 player.currentState = isSprinting ? PLAYER_STATE.RUNNING : PLAYER_STATE.WALKING; // Add RUNNING state
             }
        } else {
             player.currentState = player.isCrouching ? PLAYER_STATE.CROUCHING : PLAYER_STATE.IDLE;
        }
    } else {
        // In the air
        player.currentState = player.velocity.y > 0 ? PLAYER_STATE.JUMPING : PLAYER_STATE.FALLING;
    }


    // --- 6. Update Camera Rig Position ---
    // Camera follows player's feet position + eye height offset
    const eyeHeight = getPlayerEyeHeight();
    playerYawObject.position.set(
        player.position.x,
        player.position.y + eyeHeight,
        player.position.z
    );
}

// NOTE: The `checkCollision(position, radius, height)` function is crucial.
// It needs to:
// 1. Get the player's bounding box (e.g., an AABB based on pos, radius, height).
// 2. Find all blocks that intersect this bounding box.
// 3. Return true if any intersecting block is solid, false otherwise.
// This implementation simplifies collision *resolution* by stopping movement on the colliding axis.
// More advanced resolution (like sliding) would require knowing the collision normal.
