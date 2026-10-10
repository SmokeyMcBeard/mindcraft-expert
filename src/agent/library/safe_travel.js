/**
 * Step 23B.1: conservative *ordinary* player travel (NOT a general safe-route proof).
 * Allows natural walking, small steps and short drops. Never PLAN an action that
 * mines or places a block. Water/swimming is deferred to a separate strategy.
 * The PathFinder 2.4.5 movement planner can place blocks even with canDig=false,
 * so inspecting generated Move.toPlace/toBreak is mandatory.
 */
export function configureConservativeTravel(movements, registry) {
    movements.canDig = false;
    movements.allow1by1towers = false;
    movements.allowParkour = false;
    movements.allowSprinting = false;
    movements.maxDropDown = 2;
    movements.infiniteLiquidDropdownDistance = false;
    movements.dontCreateFlow = true;
    movements.dontMineUnderFallingBlock = true;
    movements.canOpenDoors = false;
    movements.scafoldingBlocks = [];
    // Avoid entering water until a dedicated oxygen/surface/egress strategy exists.
    // Unknown or unsupported hazards should be treated conservatively later.
    for (const name of [
        'water', 'lava', 'fire', 'soul_fire', 'cactus', 'magma_block',
        'campfire', 'soul_campfire', 'sweet_berry_bush', 'powder_snow',
        'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass'
    ]) {
        const block = registry?.blocksByName?.[name];
        if (block) movements.blocksToAvoid.add(block.id);
    }
    const originalNeighbors = movements.getNeighbors.bind(movements);
    movements.getNeighbors = function (node) {
        // Fail closed on missing/malformed Move metadata: no opaque moves.
        return originalNeighbors(node).filter(move =>
            Array.isArray(move.toBreak) && move.toBreak.length === 0 &&
            Array.isArray(move.toPlace) && move.toPlace.length === 0 &&
            move.parkour === false
        );
    };
    return movements;
}
