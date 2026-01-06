/**
 * Snake Game Determinism Tests
 * Run with: node test-determinism.js
 *
 * Tests the core simulation logic for determinism issues.
 * Uses the same dSqrt implementation as the engine.
 */

// ============================================================================
// FIXED-POINT MATH (same as engine)
// ============================================================================
const FP_SHIFT = 16;
const FP_ONE = 1 << FP_SHIFT;  // 65536

function toFixed(f) {
    return Math.round(f * FP_ONE) | 0;
}

function toFloat(fp) {
    return fp / FP_ONE;
}

function fpMul(a, b) {
    return Number((BigInt(a) * BigInt(b)) >> BigInt(FP_SHIFT));
}

function fpSqrt(a) {
    if (a <= 0) return 0;
    const scaled = BigInt(a) * BigInt(FP_ONE);
    if (scaled <= 0n) return 0;

    let bitLen = 0n;
    let temp = scaled;
    while (temp > 0n) {
        bitLen++;
        temp >>= 1n;
    }

    let x = 1n << (bitLen >> 1n);
    if (x === 0n) x = 1n;

    let prevX = 0n;
    for (let i = 0; i < 30; i++) {
        const xNew = (x + scaled / x) >> 1n;
        if (xNew === x || xNew === prevX) break;
        prevX = x;
        x = xNew;
    }

    while (x * x > scaled) x--;
    while ((x + 1n) * (x + 1n) <= scaled) x++;

    return Number(x);
}

// Deterministic sqrt (same API as engine's dSqrt)
function dSqrt(x) {
    return toFloat(fpSqrt(toFixed(x)));
}

// ============================================================================
// GAME CONSTANTS (same as game)
// ============================================================================
const SPEED = 8;
const BOOST_SPEED = 18;
const BOOST_COST_FRAMES = 10;
const MIN_BOOST_LENGTH = 10;
const INITIAL_LENGTH = 15;
const SEGMENT_SPAWN_INTERVAL = 1;
const TURN_SPEED = 0.15;
const WORLD_WIDTH = 4000;
const WORLD_HEIGHT = 4000;

// ============================================================================
// SIMULATION STATE
// ============================================================================
class SnakeState {
    constructor(id, x, y) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.dirX = 1;
        this.dirY = 0;
        this.length = INITIAL_LENGTH;
        this.lastSpawnFrame = 0;
        this.boostFrames = 0;
        this.boosting = 0;
        this.alive = true;
    }

    hash() {
        return `${this.id}:${this.x.toFixed(10)}:${this.y.toFixed(10)}:${this.dirX.toFixed(10)}:${this.dirY.toFixed(10)}:${this.length}:${this.lastSpawnFrame}:${this.boostFrames}:${this.alive}`;
    }
}

class Segment {
    constructor(ownerId, x, y, spawnFrame) {
        this.ownerId = ownerId;
        this.x = x;
        this.y = y;
        this.spawnFrame = spawnFrame;
    }
}

class Food {
    constructor(id, x, y) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.alive = true;
    }
}

class Simulation {
    constructor() {
        this.frame = 0;
        this.snakes = new Map();
        this.segments = [];
        this.food = [];
        this.foodIdCounter = 0;
    }

    // EXACT COPY of movement logic from game (using dSqrt)
    updateSnake(snake, input) {
        if (!snake.alive) return;

        if (input?.target) {
            // Direction calculation - use dSqrt for determinism
            const dx = input.target.x - snake.x;
            const dy = input.target.y - snake.y;
            const distSq = dx * dx + dy * dy;

            if (distSq > 1) {
                const dist = dSqrt(distSq);
                // Desired direction (normalized)
                const desiredX = dx / dist;
                const desiredY = dy / dist;

                // Lerp toward desired direction
                let newDirX = snake.dirX + (desiredX - snake.dirX) * TURN_SPEED;
                let newDirY = snake.dirY + (desiredY - snake.dirY) * TURN_SPEED;

                // Re-normalize using deterministic sqrt
                const newLenSq = newDirX * newDirX + newDirY * newDirY;
                const newLen = dSqrt(newLenSq);
                if (newLen > 0.001) {
                    snake.dirX = newDirX / newLen;
                    snake.dirY = newDirY / newLen;
                }
            }
        }

        // Boost
        const boostPressed = input?.boost === true;
        const isBoosting = boostPressed && snake.length > MIN_BOOST_LENGTH;
        const currentSpeed = isBoosting ? BOOST_SPEED : SPEED;
        snake.boosting = isBoosting ? 1 : 0;

        if (isBoosting) {
            snake.boostFrames++;
            if (snake.boostFrames >= BOOST_COST_FRAMES) {
                snake.length--;
                snake.boostFrames = 0;
                this.food.push(new Food(
                    this.foodIdCounter++,
                    Math.round(snake.x - snake.dirX * 30),
                    Math.round(snake.y - snake.dirY * 30)
                ));
            }
        } else {
            snake.boostFrames = 0;
        }

        // Movement (simulating velocity-based physics)
        snake.x += snake.dirX * currentSpeed;
        snake.y += snake.dirY * currentSpeed;

        // Boundary check
        if (snake.x < 0 || snake.x > WORLD_WIDTH || snake.y < 0 || snake.y > WORLD_HEIGHT) {
            snake.alive = false;
        }

        // Segment spawning
        const frameDiff = this.frame - snake.lastSpawnFrame;
        if (frameDiff >= SEGMENT_SPAWN_INTERVAL) {
            this.segments.push(new Segment(snake.id, snake.x, snake.y, this.frame));
            snake.lastSpawnFrame = this.frame;
        }
    }

    cleanupSegments() {
        const maxAgeByOwner = new Map();
        for (const [id, snake] of this.snakes) {
            if (snake.alive) {
                maxAgeByOwner.set(id, this.frame - (snake.length * SEGMENT_SPAWN_INTERVAL));
            }
        }

        this.segments = this.segments.filter(seg => {
            const oldest = maxAgeByOwner.get(seg.ownerId);
            return oldest === undefined || seg.spawnFrame >= oldest;
        });
    }

    step(inputs) {
        for (const [id, snake] of this.snakes) {
            this.updateSnake(snake, inputs.get(id));
        }
        this.cleanupSegments();
        this.frame++;
    }

    computeHash() {
        const snakeIds = [...this.snakes.keys()].sort((a, b) => a - b);
        let hash = `F${this.frame}|`;

        for (const id of snakeIds) {
            hash += this.snakes.get(id).hash() + '|';
        }

        hash += `SEG${this.segments.length}|FOOD${this.food.length}`;
        return hash;
    }
}

// ============================================================================
// TESTS
// ============================================================================

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        const result = fn();
        if (result) {
            console.log(`\x1b[32m✓ ${name}\x1b[0m`);
            passed++;
        } else {
            console.log(`\x1b[31m✗ ${name}\x1b[0m`);
            failed++;
        }
    } catch (e) {
        console.log(`\x1b[31m✗ ${name} - Error: ${e.message}\x1b[0m`);
        failed++;
    }
}

console.log('\n=== Snake Determinism Tests (with dSqrt) ===\n');

// Test 1: dSqrt consistency
test('dSqrt is consistent across calls', () => {
    const values = [1, 2, 100, 1000, 0.5, 0.001, 123456];
    for (const v of values) {
        const r1 = dSqrt(v);
        const r2 = dSqrt(v);
        if (r1 !== r2) return false;
    }
    return true;
});

// Test 2: dSqrt accuracy
test('dSqrt is reasonably accurate', () => {
    const testCases = [
        [4, 2],
        [9, 3],
        [16, 4],
        [100, 10],
        [2, Math.SQRT2],
    ];
    for (const [input, expected] of testCases) {
        const result = dSqrt(input);
        if (Math.abs(result - expected) > 0.001) {
            console.log(`  dSqrt(${input}) = ${result}, expected ~${expected}`);
            return false;
        }
    }
    return true;
});

// Test 3: Basic movement
test('Basic movement (no input)', () => {
    const sim = new Simulation();
    sim.snakes.set(1, new SnakeState(1, 500, 500));

    const inputs = new Map();
    for (let i = 0; i < 60; i++) {
        sim.step(inputs);
    }

    const snake = sim.snakes.get(1);
    const expectedX = 500 + (60 * SPEED);
    return Math.abs(snake.x - expectedX) < 0.001 && Math.abs(snake.y - 500) < 0.001;
});

// Test 4: Same inputs produce same outputs
test('Same inputs produce same outputs', () => {
    function runSim() {
        const sim = new Simulation();
        sim.snakes.set(1, new SnakeState(1, 500, 500));
        const inputs = new Map();
        inputs.set(1, { target: { x: 1000, y: 800 }, boost: false });

        for (let i = 0; i < 100; i++) {
            sim.step(inputs);
        }
        return sim.snakes.get(1);
    }

    const s1 = runSim();
    const s2 = runSim();
    return s1.x === s2.x && s1.y === s2.y && s1.dirX === s2.dirX && s1.dirY === s2.dirY;
});

// Test 5: Changing targets
test('Changing targets determinism', () => {
    const targets = [
        { frame: 0, target: { x: 1000, y: 500 } },
        { frame: 20, target: { x: 500, y: 1000 } },
        { frame: 40, target: { x: 0, y: 500 } },
        { frame: 60, target: { x: 500, y: 0 } },
    ];

    function runSim() {
        const sim = new Simulation();
        sim.snakes.set(1, new SnakeState(1, 500, 500));
        let targetIdx = 0;
        const inputs = new Map();

        for (let i = 0; i < 100; i++) {
            while (targetIdx < targets.length && targets[targetIdx].frame <= i) {
                targetIdx++;
            }
            const target = targets[Math.max(0, targetIdx - 1)].target;
            inputs.set(1, { target, boost: false });
            sim.step(inputs);
        }
        return sim.computeHash();
    }

    return runSim() === runSim();
});

// Test 6: Boost mechanics
test('Boost mechanics determinism', () => {
    function runSim() {
        const sim = new Simulation();
        sim.snakes.set(1, new SnakeState(1, 500, 500));
        const inputs = new Map();

        for (let i = 0; i < 100; i++) {
            const boosting = i >= 10 && i < 50;
            inputs.set(1, { target: { x: 1000, y: 500 }, boost: boosting });
            sim.step(inputs);
        }
        return sim;
    }

    const sim1 = runSim();
    const sim2 = runSim();

    const s1 = sim1.snakes.get(1);
    const s2 = sim2.snakes.get(1);

    return s1.x === s2.x && s1.y === s2.y && s1.length === s2.length &&
           sim1.food.length === sim2.food.length;
});

// Test 7: Two snakes
test('Two snakes determinism', () => {
    function runSim() {
        const sim = new Simulation();
        sim.snakes.set(1, new SnakeState(1, 500, 500));
        sim.snakes.set(2, new SnakeState(2, 1500, 1500));
        const inputs = new Map();

        for (let i = 0; i < 100; i++) {
            inputs.set(1, { target: { x: 2000, y: 500 }, boost: false });
            inputs.set(2, { target: { x: 0, y: 1500 }, boost: i % 10 === 0 });
            sim.step(inputs);
        }
        return sim.computeHash();
    }

    return runSim() === runSim();
});

// Test 8: Long simulation
test('Long simulation (1000 frames) determinism', () => {
    function runSim() {
        const sim = new Simulation();
        sim.snakes.set(1, new SnakeState(1, 500, 500));
        sim.snakes.set(2, new SnakeState(2, 1000, 1000));
        const inputs = new Map();

        for (let i = 0; i < 1000; i++) {
            const angle1 = i * 0.1;
            const angle2 = i * 0.07 + 1;

            inputs.set(1, {
                target: {
                    x: Math.round(500 + Math.cos(angle1) * 500),
                    y: Math.round(500 + Math.sin(angle1) * 500)
                },
                boost: i % 50 < 20
            });

            inputs.set(2, {
                target: {
                    x: Math.round(1000 + Math.cos(angle2) * 300),
                    y: Math.round(1000 + Math.sin(angle2) * 300)
                },
                boost: i % 30 < 10
            });

            sim.step(inputs);
        }
        return sim.computeHash();
    }

    const hash1 = runSim();
    const hash2 = runSim();

    if (hash1 !== hash2) {
        console.log(`  Hash1: ${hash1.substring(0, 80)}...`);
        console.log(`  Hash2: ${hash2.substring(0, 80)}...`);
    }

    return hash1 === hash2;
});

// Test 9: Division after dSqrt is deterministic
test('Division after dSqrt is deterministic', () => {
    const results = [];

    for (let run = 0; run < 10; run++) {
        let dirX = 1, dirY = 0;
        let x = 500, y = 500;

        for (let i = 0; i < 500; i++) {
            const targetX = 1000 + i * 7;
            const targetY = 800 + i * 3;

            const dx = targetX - x;
            const dy = targetY - y;
            const distSq = dx * dx + dy * dy;

            if (distSq > 1) {
                const dist = dSqrt(distSq);
                const desiredX = dx / dist;
                const desiredY = dy / dist;

                let newDirX = dirX + (desiredX - dirX) * TURN_SPEED;
                let newDirY = dirY + (desiredY - dirY) * TURN_SPEED;

                const newLenSq = newDirX * newDirX + newDirY * newDirY;
                const newLen = dSqrt(newLenSq);
                if (newLen > 0.001) {
                    dirX = newDirX / newLen;
                    dirY = newDirY / newLen;
                }
            }

            x += dirX * SPEED;
            y += dirY * SPEED;
        }

        results.push({ x, y, dirX, dirY });
    }

    for (let i = 1; i < results.length; i++) {
        if (results[i].x !== results[0].x || results[i].y !== results[0].y) {
            console.log(`  Run ${i} differs!`);
            return false;
        }
    }
    return true;
});

// Print summary
console.log('\n' + '='.repeat(40));
console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed === 0) {
    console.log('\x1b[32m\nAll tests passed!\x1b[0m');
    console.log('\nNote: These tests verify LOCAL determinism with dSqrt.');
    console.log('The actual game uses the engine which should produce identical results.');
} else {
    console.log('\x1b[31m\nSome tests failed!\x1b[0m');
    process.exit(1);
}

// Print fingerprint for cross-machine comparison
console.log('\n=== Fingerprint (compare across environments) ===');

const sim = new Simulation();
sim.snakes.set(1, new SnakeState(1, 500, 500));
const inputs = new Map();
inputs.set(1, { target: { x: 1234, y: 567 }, boost: false });

for (let i = 0; i < 100; i++) {
    sim.step(inputs);
}

const snake = sim.snakes.get(1);
console.log(`x: ${snake.x}`);
console.log(`y: ${snake.y}`);
console.log(`dirX: ${snake.dirX}`);
console.log(`dirY: ${snake.dirY}`);
console.log(`segments: ${sim.segments.length}`);
