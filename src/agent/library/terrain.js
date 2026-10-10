/**
 * Step 23A: read-only terrain observations.
 * This is geometry reporting, NOT proof that a route is traversable.
 * Unknown/unloaded blocks are never treated as safe air.
 */
const EMPTY = new Set(['air', 'cave_air', 'void_air']);
const FLUIDS = new Set(['water', 'lava']);
const HAZARDS = new Set([
    'lava', 'fire', 'soul_fire', 'cactus', 'magma_block',
    'campfire', 'soul_campfire', 'sweet_berry_bush', 'powder_snow'
]);

const DIRECTIONS = [
    ['N', 0, -1], ['NE', 1, -1], ['E', 1, 0], ['SE', 1, 1],
    ['S', 0, 1], ['SW', -1, 1], ['W', -1, 0], ['NW', -1, -1]
];

function clear(block) {
    return !!block && (EMPTY.has(block.name) ||
        (block.boundingBox === 'empty' && !HAZARDS.has(block.name) && !FLUIDS.has(block.name)));
}

function fullSupport(block) {
    if (!block || block.boundingBox !== 'block' || HAZARDS.has(block.name) || FLUIDS.has(block.name)) return false;
    // Non-full collision shapes need a more sophisticated route/footing model.
    return Array.isArray(block.shapes) && block.shapes.some(shape =>
        Array.isArray(shape) && shape.length >= 6 &&
        shape[0] <= 0.1 && shape[2] <= 0.1 &&
        shape[3] >= 0.9 && shape[4] >= 0.99 && shape[5] >= 0.9);
}

function fluidDepth(at, x, y, z, kind, limit = 12) {
    let depth = 0;
    while (depth < limit) {
        const block = at(x, y - depth, z);
        if (!block) return `${depth}+ (unloaded below)`;
        if (block.name !== kind) return String(depth);
        depth++;
    }
    return `${limit}+`;
}

function inspectNeighbor(at, x, y, z) {
    const head = at(x, y + 1, z);
    const body = at(x, y, z);
    if (!head || !body) return 'unknown (unloaded)';
    if (HAZARDS.has(head.name) || HAZARDS.has(body.name)) {
        return `hazard (${HAZARDS.has(body.name) ? body.name : head.name})`;
    }
    if (body.name === 'water' || head.name === 'water') {
        const surfaceY = body.name === 'water' ? y : y + 1;
        return `water (depth ${fluidDepth(at, x, surfaceY, z, 'water')})`;
    }
    if (!clear(head)) return `blocked at head height (${head.name})`;

    // Evaluate potential landing surfaces at levels near the player's feet.
    // The result is a local *observation*, not a safe path from A to B.
    for (let landingY = y + 1; landingY >= y - 12; landingY--) {
        const feetBlock = at(x, landingY, z);
        const above = at(x, landingY + 1, z);
        const beneath = at(x, landingY - 1, z);
        if (!feetBlock || !above || !beneath) return 'unknown (unloaded)';
        if (HAZARDS.has(feetBlock.name) || HAZARDS.has(beneath.name)) {
            return `hazard (${HAZARDS.has(feetBlock.name) ? feetBlock.name : beneath.name})`;
        }
        if (feetBlock.name === 'water' || beneath.name === 'water') {
            const surfaceY = feetBlock.name === 'water' ? landingY : landingY - 1;
            return `water (depth ${fluidDepth(at, x, surfaceY, z, 'water')})`;
        }
        if (!clear(feetBlock) || !clear(above)) continue;
        if (fullSupport(beneath)) {
            const delta = landingY - y;
            if (delta === 0) return `level (${beneath.name})`;
            if (delta === 1) return `step up 1 (${beneath.name})`;
            if (delta > 1) return `rise ${delta} (${beneath.name}; route unverified)`;
            return `drop ${-delta} (${beneath.name}; route unverified)`;
        }
        if (!clear(beneath)) return `irregular support (${beneath.name}; unverified)`;
    }
    return 'no landing within 12 blocks (or geometry blocked)';
}

/** Read-only, bounded scan of known blocks around a Mineflayer bot. */
export function getTerrainReport(bot) {
    const pos = bot?.entity?.position;
    if (!pos || ![pos.x, pos.y, pos.z].every(Number.isFinite) || typeof pos.floored !== 'function') {
        return 'TERRAIN SNAPSHOT: unavailable (bot position is missing or invalid).';
    }
    const origin = pos.floored();
    const at = (x, y, z) => {
        // All positions are integer grid coordinates derived from the current Vec3.
        try { return bot.blockAt(origin.offset(x - origin.x, y - origin.y, z - origin.z), false); }
        catch { return null; }
    };
    const { x, y, z } = origin;
    const beneath = at(x, y - 1, z);
    const body = at(x, y, z);
    const head = at(x, y + 1, z);
    const fmt = block => block ? block.name : 'UNKNOWN (unloaded)';
    const lines = [
        'TERRAIN SNAPSHOT ??? READ ONLY (not a route-safety guarantee)',
        `Position: ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`,
        `Underfoot: ${fmt(beneath)}; feet: ${fmt(body)}; head: ${fmt(head)}`,
        'Adjacent terrain (potential landing geometry only):'
    ];
    for (const [name, dx, dz] of DIRECTIONS) {
        lines.push(`- ${name}: ${inspectNeighbor(at, x + dx, y, z + dz)}`);
    }

    const nearestHazards = new Map();
    let unknownBlocks = 0;
    for (let dx = -3; dx <= 3; dx++) {
        for (let dz = -3; dz <= 3; dz++) {
            for (let dy = -2; dy <= 2; dy++) {
                const b = at(x + dx, y + dy, z + dz);
                if (!b) { unknownBlocks++; continue; }
                if (HAZARDS.has(b.name) || b.name === 'water') {
                    const distance = Math.hypot(dx, dz) + Math.abs(dy) * 0.25;
                    if (!nearestHazards.has(b.name) || distance < nearestHazards.get(b.name).distance) {
                        nearestHazards.set(b.name, { distance, x: x + dx, y: y + dy, z: z + dz });
                    }
                }
            }
        }
    }
    if (nearestHazards.size === 0) {
        lines.push('Nearby hazards (radius 3): none detected in inspected blocks.');
    } else {
        lines.push('Nearby hazards (radius 3; nearest of each type):');
        for (const [kind, point] of [...nearestHazards].sort((a, b) => a[1].distance - b[1].distance)) {
            lines.push(`- ${kind}: ${point.x}, ${point.y}, ${point.z}`);
        }
    }
    if (unknownBlocks > 0) lines.push(`Unloaded/unknown samples: ${unknownBlocks} (never assume safe).`);
    lines.push('Limits: one-block neighborhood and local hazards only; not a full path, sky/surface, structure or swim-safety assessment.');
    return lines.join('\n');
}
