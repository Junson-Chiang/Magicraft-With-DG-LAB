import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { DglabSocket } from 'dglab-kit';
import { DeviceOutput } from './device-output.js';
test('actual V4 SDK discovers simulated APP and sends RPC tasks with correct target/channel', async () => {
  const relay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(relay, 'listening');
  const frames = [];
  const timers = new Set();
  relay.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'hello', clientId: 'controller' }));
    ws.send(JSON.stringify({ type: 'client_attached', clientId: 'app' }));
    ws.on('message', bytes => {
      const frame = JSON.parse(bytes);
      if (frame.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
      if (frame.type !== 'message') return;
      frames.push(frame);
      const respond = () => ws.send(JSON.stringify({ type: 'message', clientId: 'app', data: {
        t: 'resp', reqId: frame.data.reqId, result: frame.data.m === 'devices.get' ? { devices: [{ slotId: 'device', name: 'Mock', type: 'COYOTE_030' }] } : {}
      } }));
      if (frame.data.m === 'device.op' && frame.data.data.d) {
        const timer = setTimeout(() => { timers.delete(timer); respond(); }, frame.data.data.d);
        timers.add(timer);
      } else respond();
    });
  });
  const socket = new DglabSocket({ url: `ws://127.0.0.1:${relay.address().port}`, responseTimeout: 1000 });
  try {
    assert.equal((await socket.connect()).targetId, 'controller');
    if (!socket.clientIds.includes('app')) await once(socket, 'client-attached');
    assert.equal((await socket.requestDevices('app')).devices[0].slotId, 'device');
    const output = new DeviceOutput(socket, () => {}, () => {});
    output.select({ clientId: 'app', slotId: 'device', channel: 'B' });
    await output.play(13, 1000, 'test', 'B');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(output.lastError, null);
    const operations = frames.filter(f => f.data.m === 'device.op');
    assert.deepEqual(operations.map(f => f.data.data.t), [7, 0, 4]);
    for (const f of operations) {
      assert.equal(f.clientId, 'app');
      assert.equal(f.data.data.s, 'device');
      assert.equal(f.data.data.c, 1);
    }
    assert.equal(operations.at(-1).data.data.v, 13);
    assert.ok(operations.at(-1).data.data.d <= 1000);
    await output.stop('test stop');
    assert.equal(frames.at(-1).data.data.v, 0);
  } finally {
    socket.destroy();
    for (const timer of timers) clearTimeout(timer);
    for (const ws of relay.clients) ws.terminate();
    await new Promise(resolve => relay.close(resolve));
  }
});
