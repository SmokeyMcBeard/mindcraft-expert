const STOPPED = 0
const ACTIVE = 1
const PAUSED = 2
export class SelfPrompter {
    constructor(agent) {
        this.agent = agent;
        this.state = STOPPED;
        this.loop_active = false;
        this.interrupt = false;
        this.prompt = '';
        this.idle_time = 0;
        this.cooldown = 2000;
    }

    start(prompt) {
        console.log('Self-prompting started.');
        if (!prompt) {
            if (!this.prompt)
                return 'No prompt specified. Ignoring request.';
            prompt = this.prompt;
        }
        this.state = ACTIVE;
        this.prompt = prompt;
        this.startLoop();
    }

    isActive() {
        return this.state === ACTIVE;
    }

    isStopped() {
        return this.state === STOPPED;
    }

    isPaused() {
        return this.state === PAUSED;
    }

    async handleLoad(prompt, state) {
        if (state == undefined)
            state = STOPPED;
        this.state = state;
        this.prompt = prompt;
        if (state !== STOPPED && !prompt)
            throw new Error('No prompt loaded when self-prompting is active');
        if (state === ACTIVE) {
            await this.start(prompt);
        }
    }

    setPromptPaused(prompt) {
        this.prompt = prompt;
        this.state = PAUSED;
    }

    async startLoop() {
        if (this.loop_active) {
            console.warn('Self-prompt loop is already active. Ignoring request.');
            return;
        }
        console.log('starting self-prompt loop');
        this.loop_active = true;
        let no_command_count = 0;
        let command_count = 0;
        let wiki_count = 0;
        let failed_wiki_count = 0;
        const MAX_NO_COMMAND = 3;
        const MAX_COMMANDS = 20;
        const MAX_WIKI_SEARCHES = 3;
        const MAX_FAILED_WIKI_SEARCHES = 2;
        let stopReason = null;
        try {
            while (!this.interrupt && this.state === ACTIVE) {
                const msg = `You are self-prompting with the goal: '${this.prompt}'. Your next response MUST contain a command with this syntax: !commandName. Respond:`;
                // Exactly one generated command per cycle, never unlimited (-1).
                this.agent.last_autonomous_command = null;
                const used_command = await this.agent.handleMessage('system', msg, 1);
                if (this.interrupt || this.state !== ACTIVE) break;

                if (!used_command) {
                    no_command_count++;
                    if (no_command_count >= MAX_NO_COMMAND) {
                        stopReason = `No command after ${MAX_NO_COMMAND} autonomous prompts. Goal stopped.`;
                    }
                } else {
                    no_command_count = 0;
                    command_count++;
                    const last = this.agent.last_autonomous_command;
                    if (last?.name === '!searchWiki') {
                        wiki_count++;
                        failed_wiki_count = last.failed ? failed_wiki_count + 1 : 0;
                        if (wiki_count >= MAX_WIKI_SEARCHES || failed_wiki_count >= MAX_FAILED_WIKI_SEARCHES) {
                            stopReason = 'Wiki research limit reached. Autonomous goal stopped; ask the player for direction.';
                        }
                    } else {
                        failed_wiki_count = 0;
                    }
                    if (command_count >= MAX_COMMANDS) {
                        stopReason = 'Autonomous command budget exhausted. Goal stopped; ask the player for direction.';
                    }
                }
                if (stopReason) {
                    console.warn(stopReason);
                    this.state = STOPPED;
                    this.prompt = '';
                    break;
                }
                if (used_command) await new Promise(r => setTimeout(r, this.cooldown));
            }
        } catch (err) {
            console.error('Self-prompt loop failed:', err);
            this.state = STOPPED;
            this.prompt = '';
        } finally {
            console.log('self prompt loop stopped');
            this.loop_active = false;
            this.interrupt = false;
            if (this.state === STOPPED) {
                if (stopReason) void this.agent.openChat(stopReason);
                // Persist STOPPED so an old goal cannot restart after process restart.
                try { await this.agent.history.save(); }
                catch (err) { console.error('Failed to persist stopped goal:', err); }
            }
        }
    }

    update(delta) {
        // automatically restarts loop
        if (this.state === ACTIVE && !this.loop_active && !this.interrupt) {
            if (this.agent.isIdle())
                this.idle_time += delta;
            else
                this.idle_time = 0;

            if (this.idle_time >= this.cooldown) {
                console.log('Restarting self-prompting...');
                this.startLoop();
                this.idle_time = 0;
            }
        }
        else {
            this.idle_time = 0;
        }
    }

    async stopLoop() {
        // you can call this without await if you don't need to wait for it to finish
        if (this.interrupt)
            return;
        console.log('stopping self-prompt loop')
        this.interrupt = true;
        while (this.loop_active) {
            await new Promise(r => setTimeout(r, 500));
        }
        this.interrupt = false;
    }

    async stop(stop_action=true) {
        // Mark stopped before awaiting action cancellation.
        // Do not await loop drain here: !endGoal may run inside that very loop.
        this.state = STOPPED;
        this.prompt = '';
        this.interrupt = true;
        if (stop_action) await this.agent.actions.stop();
        if (!this.loop_active) this.interrupt = false;
    }

    async pause() {
        this.interrupt = true;
        await this.agent.actions.stop();
        this.stopLoop();
        this.state = PAUSED;
    }

    shouldInterrupt(is_self_prompt) { // to be called from handleMessage
        return is_self_prompt && (this.interrupt || (this.loop_active && this.state === STOPPED));
    }

    handleUserPromptedCmd(is_self_prompt, is_action) {
        // if a user messages and the bot responds with an action, stop the self-prompt loop
        if (!is_self_prompt && is_action) {
            this.stopLoop();
            // this stops it from responding from the handlemessage loop and the self-prompt loop at the same time
        }
    }
}