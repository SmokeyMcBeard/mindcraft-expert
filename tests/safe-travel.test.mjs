import test from 'node:test';
import assert from 'node:assert/strict';
import { configureConservativeTravel } from '../src/agent/library/safe_travel.js';

function fixture(moves) {
    const registry = { blocksByName: {
        water: { id: 9 }, lava: { id: 10 }, cactus: { id: 11 },
        magma_block: { id: 12 }, powder_snow: { id: 13 }
    } };
    const movements = {
        canDig: true, allow1by1towers: true, allowParkour: true,
        allowSprinting: true, maxDropDown: 4,
        infiniteLiquidDropdownDistance: true,
        blocksToAvoid: new Set(),
        getNeighbors: () => moves
    };
    return { movements: configureConservativeTravel(movements, registry), registry };
}

test('conservative defaults prohibit ordinary destructive mobility', () => {
    const { movements: m } = fixture([]);
    assert.equal(m.canDig, false);
    assert.equal(m.allow1by1towers, false);
    assert.equal(m.allowParkour, false);
    assert.equal(m.allowSprinting, false);
    assert.equal(m.maxDropDown, 2);
    assert.equal(m.infiniteLiquidDropdownDistance, false);
    assert.equal(m.canOpenDoors, false);
    assert.deepEqual(m.scafoldingBlocks, []);
});

test('explicitly treats water and selected terrain hazards as obstacles', () => {
    const { movements: m } = fixture([]);
    for (const id of [9, 10, 11, 12, 13]) assert.ok(m.blocksToAvoid.has(id));
});

test('only unmodified, non-parkour neighbor moves remain', () => {
    const natural = { toBreak: [], toPlace: [], parkour: false };
    const dig = { toBreak: [{ x: 1 }], toPlace: [], parkour: false };
    const build = { toBreak: [], toPlace: [{ x: 2 }], parkour: false };
    const jump = { toBreak: [], toPlace: [], parkour: true };
    const unspecified = { toBreak: [], parkour: false };
    const m = fixture([natural, dig, build, jump, unspecified]).movements;
    assert.deepEqual(m.getNeighbors({}), [natural]);
});

test('handles absent optional registry hazards without exceptions', () => {
    const m = { blocksToAvoid: new Set(), getNeighbors: () => [] };
    assert.doesNotThrow(() => configureConservativeTravel(m, {}));
});
