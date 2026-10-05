import { COYOTE_WAVEFORM, COYOTE_WAVEFORMS, V4Channel } from 'dglab-kit';

// One in-flight RPC chain and one replaceable pending action, never an event backlog.
export class ChannelOutput {
  constructor(socket, log, onError) {
    this.socket = socket;
    this.log = log;
    this.onError = onError;
    this.target = null;
    this.generation = 0;
    this.pending = null;
    this.running = null;
    this.lastError = null;
  }
  select(target) { this.target = target; }
  stop(reason) {
    this.generation++;
    this.pending = this.target ? { kind: 'stop', target: { ...this.target }, generation: this.generation, reason } : null;
    return this.drain();
  }
  play(intensity, duration, reason, waveform = 'BUBBLE') {
    if (!this.target) return;
    this.pending = { kind: 'play', target: { ...this.target }, generation: ++this.generation,
      intensity, waveform, deadline: Date.now() + duration, reason };
    return this.drain();
  }
  drain() {
    if (this.running) return this.running;
    this.running = this.run().finally(() => { this.running = null; if (this.pending) this.drain(); });
    return this.running;
  }
  async run() {
    while (this.pending) {
      const job = this.pending;
      this.pending = null;
      const { clientId, slotId, channel } = job.target;
      const c = channel === 'A' ? V4Channel.A : V4Channel.B;
      const valid = () => job.generation === this.generation;
      try {
        await this.socket.clearOperate(clientId, { slotId, channel: c });
        if (!valid()) continue;
        await this.socket.resetIntensity(clientId, slotId, c, { immediate: true, timeout: 1500 });
        this.lastError = null;
        if (!valid() || job.kind === 'stop') continue;
        const remaining = job.deadline - Date.now();
        if (remaining <= 0) continue;
        // V4 replies when a task ENDS, not when queued. Dispatch both tasks in
        // the same turn; observe completion separately so stop never waits for duration.
        const observe = promise => Promise.resolve(promise).catch(error => {
          if (!valid()) return; // clear/replacement/disconnection of an old generation
          this.lastError = error;
          this.log(`设备任务失败：${error.message}`);
          this.onError(error, true);
          this.stop('设备任务失败后归零');
        });
        observe(this.socket.sendPulse(clientId, slotId, c, remaining, COYOTE_WAVEFORMS[job.waveform]?.raw ?? COYOTE_WAVEFORMS[COYOTE_WAVEFORM.BUBBLE].raw,
          { immediate: true, timeout: remaining + 1500 }));
        if (!valid()) continue;
        observe(this.socket.setTempIntensity(clientId, slotId, c, job.intensity, remaining,
          { immediate: true, timeout: remaining + 1500 }));
        this.log(job.reason);
      } catch (error) {
        this.lastError = error;
        this.log(`设备操作失败：${error.message}`);
        // A failed clear must not prevent a best-effort zero command.
        try { await this.socket.resetIntensity(clientId, slotId, c, { immediate: true, timeout: 1500 }); } catch {}
        this.pending = null;
        this.generation++;
        this.onError(error, job.kind === 'play');
      }
    }
  }
}

// Each channel has its own generation and pending task. A hit on B cannot cancel A.
export class DeviceOutput {
  constructor(socket, log, onError) {
    this.target = null;
    this.workers = Object.fromEntries(['A', 'B'].map(channel => [channel,
      new ChannelOutput(socket, log, (error, duringPlayback) => {
        onError(error);
        if (duringPlayback) this.stop('设备异常，停止两个通道');
      })]));
  }
  select(target) {
    this.target = target;
    for (const channel of ['A', 'B']) this.workers[channel].select(target ? { ...target, channel } : null);
  }
  get lastError() { return this.workers.A.lastError || this.workers.B.lastError; }
  stop(reason) { return Promise.all(['A', 'B'].map(channel => this.workers[channel].stop(reason))); }
  play(intensity, duration, reason, channel = 'A', waveform = 'BUBBLE') { return this.workers[channel].play(intensity, duration, reason, waveform); }
}
