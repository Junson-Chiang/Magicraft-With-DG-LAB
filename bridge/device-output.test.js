import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelOutput as DeviceOutput, DeviceOutput as DualOutput } from './device-output.js';
function fake() {
  const calls = [];
  const socket = Object.fromEntries(['clearOperate', 'resetIntensity', 'sendPulse', 'setTempIntensity']
    .map(name => [name, async (...args) => calls.push([name, ...args])]));
  const output = new DeviceOutput(socket, () => {}, () => {});
  output.select({ clientId: 'app', slotId: 'device', channel: 'A' });
  return { output, calls, socket };
}
test('feedback clears, zeros, supplies waveform, then sets bounded temporary intensity', async () => {
  const { output, calls } = fake();
  await output.play(13, 1000, 'test');
  assert.deepEqual(calls.map(c => c[0]), ['clearOperate', 'resetIntensity', 'sendPulse', 'setTempIntensity']);
  assert.equal(calls[3][4], 13);
  assert.ok(calls[3][5] > 0 && calls[3][5] <= 1000);
});
test('stop does not wait for ongoing waveform completion and clears/zeros immediately', async () => {
  const { output, calls, socket } = fake();
  let release;
  socket.sendPulse = (...args) => { calls.push(['sendPulse', ...args]); return new Promise(resolve => release = resolve); };
  await output.play(20, 1000, 'test');
  assert.equal(calls.some(c => c[0] === 'setTempIntensity'), true);
  await output.stop('stop');
  assert.equal(calls.at(-1)[0], 'resetIntensity');
  release();
});
test('stop during preflight prevents both waveform and intensity from starting', async () => {
  const { output, calls, socket } = fake();
  let release, entered;
  const reached = new Promise(resolve => entered = resolve);
  const original = socket.clearOperate;
  let first = true;
  socket.clearOperate = async (...args) => {
    await original(...args);
    if (first) { first = false; entered(); await new Promise(resolve => release = resolve); }
  };
  const playing = output.play(20, 1000, 'test');
  await reached;
  const stopping = output.stop('stop');
  release();
  await Promise.all([playing, stopping]);
  assert.equal(calls.some(c => c[0] === 'sendPulse' || c[0] === 'setTempIntensity'), false);
  assert.equal(calls.at(-1)[0], 'resetIntensity');
});
test('failed clear still attempts zero and records failure', async () => {
  const { output, calls, socket } = fake();
  socket.clearOperate = async () => { throw new Error('timeout'); };
  await output.play(20, 1000, 'test');
  assert.equal(output.lastError.message, 'timeout');
  assert.deepEqual(calls.map(c => c[0]), ['resetIntensity']);
});
test('A and B jobs run independently and emergency stop zeros both', async () => {
  const calls = [];
  const socket = Object.fromEntries(['clearOperate', 'resetIntensity', 'sendPulse', 'setTempIntensity'].map(name =>
    [name, async (...args) => calls.push([name, ...args])]));
  const output = new DualOutput(socket, () => {}, () => {});
  output.select({ clientId: 'app', slotId: 'device' });
  await Promise.all([output.play(10, 1000, 'enemy', 'A'), output.play(20, 1000, 'trap', 'B')]);
  const intensities = calls.filter(c => c[0] === 'setTempIntensity');
  assert.deepEqual(intensities.map(c => [c[3], c[4]]).sort(), [[0, 10], [1, 20]]);
  calls.length = 0;
  await output.stop('stop');
  assert.deepEqual(calls.filter(c => c[0] === 'resetIntensity').map(c => c[3]).sort(), [0, 1]);
});
