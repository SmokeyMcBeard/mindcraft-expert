import test from 'node:test';
import assert from 'node:assert/strict';
import { getTerrainReport } from '../src/agent/library/terrain.js';

const full = [[0,0,0,1,1,1]];
function mockBot({ floor = () => 63, blockOverride = () => undefined } = {}) {
    const position = {
        x: 0.5, y: 64, z: 0.5,
        floored() {
            return {
                x: 0, y: 64, z: 0,
                offset(dx, dy, dz) { return {x: dx, y: 64 + dy, z: dz}; }
            };
        }
    };
    return {
        entity: { position },
        blockAt(point) {
            const override = blockOverride(point);
            if (override === null) return null;
            const name = override ?? (point.y <= floor(point.x, point.z) ? 'sand' : 'air');
            return name === 'air'
                ? {name, boundingBox: 'empty', shapes: []}
                : {name, boundingBox: name === 'water' || name === 'lava' ? 'empty' : 'block', shapes: full};
        }
    };
}

test('flat desert: consistent safe-looking geometry but no route guarantee', () => {
    const report = getTerrainReport(mockBot());
    assert.match(report, /N: level \(sand\)/);
    assert.match(report, /W: level \(sand\)/);
    assert.match(report, /READ ONLY/);
});

test('cliff at north: sees four-block drop', () => {
    const bot = mockBot({floor: (x,z) => z === -1 ? 59 : 63});
    assert.match(getTerrainReport(bot), /N: drop 4 \(sand; route unverified\)/);
});

test('one-block step east', () => {
    const bot = mockBot({floor: (x,z) => x === 1 && z === 0 ? 64 : 63});
    assert.match(getTerrainReport(bot), /E: step up 1 \(sand\)/);
});

test('lava next to the player is explicitly hazardous', () => {
    const bot = mockBot({blockOverride: p => p.x === 1 && p.z === 0 && p.y === 64 ? 'lava' : undefined});
    const report = getTerrainReport(bot);
    assert.match(report, /E: hazard \(lava\)/);
    assert.match(report, /lava: 1, 64, 0/);
});

test('water is recognized and approximate depth shown', () => {
    const bot = mockBot({blockOverride: p => p.x === 0 && p.z === -1 && p.y <= 64 && p.y >= 61 ? 'water' : undefined});
    const report = getTerrainReport(bot);
    assert.match(report, /N: water \(depth 4\)/);
});

test('unloaded unknown blocks are never labeled safe', () => {
    const bot = mockBot({blockOverride: p => p.x === 0 && p.z === -1 ? null : undefined});
    const report = getTerrainReport(bot);
    assert.match(report, /N: unknown \(unloaded\)/);
    assert.match(report, /Unloaded\/unknown samples/);
});

test('invalid position fails closed', () => {
    const bot = mockBot();
    bot.entity.position.x = NaN;
    assert.match(getTerrainReport(bot), /unavailable \(bot position is missing or invalid\)/);
});
