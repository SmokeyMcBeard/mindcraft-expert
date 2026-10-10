import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SelfPrompter } from '../src/agent/self_prompter.js';
import { readFileSync } from 'node:fs';

const waitFor = async (fn, limit=2000) => {
    const end = Date.now() + limit;
    while (!fn() && Date.now() < end) await new Promise(r => setTimeout(r, 2));
    assert.ok(fn(), 'Timed out waiting for state change');
};
const create = (handleMessage=async () => false) => {
    const state = { calls: 0, saved: 0, messages: [], stops: 0 };
    const agent = {
        handleMessage: async (...args) => { state.calls++; return handleMessage(...args); },
        openChat: (m) => { state.messages.push(m); },
        history: {save: async () => { state.saved++; }},
        actions: {stop: async () => { state.stops++; }},
        isIdle: () => true
    };
    const prompter = new SelfPrompter(agent);
    agent.self_prompter = prompter;
    prompter.cooldown = 0;
    return { agent, prompter, state };
};

test('explicit cancellation marks goal stopped while an LLM response is in flight', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { prompter, state } = create(() => gate);
    prompter.start('Get sand');
    await waitFor(() => state.calls === 1);
    await prompter.stop(false);
    assert.equal(prompter.isStopped(), true);
    assert.equal(prompter.shouldInterrupt(true), true);
    release(true);
    await waitFor(() => !prompter.loop_active);
    assert.equal(state.calls, 1);
    assert.ok(state.saved >= 1);
});

test('endGoal initiated from within autonomous reply does not deadlock', async () => {
    let p;
    const { agent, prompter, state } = create(async () => {
        await p.stop(false);
        return true;
    });
    p = prompter;
    prompter.start('irrelevant');
    await waitFor(() => !prompter.loop_active);
    assert.equal(prompter.isStopped(), true);
    assert.equal(state.calls, 1);
});

test('stop(true) waits for action cancellation', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { agent, prompter } = create();
    agent.actions.stop = () => gate;
    prompter.state = 1;
    let done = false;
    const pending = prompter.stop(true).then(() => { done = true; });
    await new Promise(r => setTimeout(r, 5));
    assert.equal(prompter.isStopped(), true);
    assert.equal(done, false);
    release();
    await pending;
    assert.equal(done, true);
});

test('autonomous loop evaluates one command per cycle and stops after 20 commands', async () => {
    let agent;
    const o = create(async (source,msg,maxResponses) => {
        assert.equal(maxResponses, 1);
        agent.last_autonomous_command = {name: '!nearbyBlocks',failed: false};
        return true;
    });
    agent = o.agent;
    o.prompter.start('Inspect');
    await waitFor(() => !o.prompter.loop_active);
    assert.equal(o.prompter.isStopped(), true);
    assert.equal(o.state.calls, 20);
    assert.match(o.state.messages.join(' '), /budget exhausted/i);
});

test('two failed wiki searches stop an autonomous goal', async () => {
    let agent;
    const o = create(async () => {
        agent.last_autonomous_command = {name: '!searchWiki',failed: true};
        return true;
    });
    agent = o.agent;
    o.prompter.start('Research');
    await waitFor(() => !o.prompter.loop_active);
    assert.equal(o.prompter.isStopped(), true);
    assert.equal(o.state.calls, 2);
});

test('source routes model-generated !goal differently from player direct commands', () => {
    const source = readFileSync(new URL('../src/agent/agent.js', import.meta.url), 'utf8');
    assert.match(source, /Only a direct player-issued !goal/);
    assert.match(source, /if \(command_name === '!goal'\)/);
    assert.match(source, /this\.last_autonomous_command = \{ name: command_name, failed \}/);
});

test('endGoal and stop await goal cancellation and persist stopped state', () => {
    const source = readFileSync(new URL('../src/agent/commands/actions.js', import.meta.url), 'utf8');
    assert.match(source, /await agent\.self_prompter\.stop\(\);/);
    assert.match(source, /await agent\.self_prompter\.stop\(false\);/);
    assert.match(source, /await agent\.history\.save\(\);/);
});
