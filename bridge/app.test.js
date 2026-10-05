import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import dgram from 'node:dgram';
import net from 'node:net';
import { WebSocketServer } from 'ws';
import { normalizeConfig } from './rules.js';

async function freePort() {
  const s = net.createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening');
  const port = s.address().port; await new Promise(resolve => s.close(resolve)); return port;
}
async function waitFor(fn, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 30)); }
  throw new Error('Condition timed out');
}
test('whole bridge receives UDP events, pairs V4 APP and enforces HTTP controls', { timeout: 15000 }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'magicraft-bridge-'));
  const config = normalizeConfig(JSON.parse(await readFile(new URL('./config.example.json', import.meta.url))));
  const relay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(relay, 'listening');
  config.relayUrl = `ws://127.0.0.1:${relay.address().port}`;
  config.httpPort = await freePort();
  config.udpPort = await freePort();
  const path = join(folder, 'config.json');
  await writeFile(path, JSON.stringify(config));
  const frames = [], timers = new Set();
  relay.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'hello', clientId: 'controller' }));
    ws.send(JSON.stringify({ type: 'client_attached', clientId: 'app' }));
    ws.on('message', bytes => {
      const f = JSON.parse(bytes);
      if (f.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
      if (f.type !== 'message') return;
      frames.push(f);
      const respond = () => ws.send(JSON.stringify({ type: 'message', clientId: 'app', data: {
        t: 'resp', reqId: f.data.reqId, result: f.data.m === 'devices.get' ? { devices: [{ slotId: 'device', name: 'Mock', type: 'COYOTE_030', slotState: { hasDevice: true } }] } : {}
      } }));
      if (f.data.m === 'device.op' && f.data.data.d) {
        const timer = setTimeout(() => { timers.delete(timer); respond(); }, f.data.data.d); timers.add(timer);
      } else respond();
    });
  });
  const child = spawn(process.execPath, [new URL('./main.js', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
    { env: { ...process.env, MAGICRAFT_BRIDGE_CONFIG: path }, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout.on('data', chunk => text += chunk);
  child.stderr.on('data', chunk => text += chunk);
  const udp = dgram.createSocket('udp4');
  try {
    const token = await waitFor(() => text.match(/\/#([a-f0-9]{48})/)?.[1]);
    const base = `http://127.0.0.1:${config.httpPort}`;
    const api = async (route, body) => {
      const res = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'X-Control-Token': token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const result = await res.json(); assert.equal(res.ok, true, JSON.stringify(result)); return result;
    };
    assert.equal((await fetch(base + '/status')).status, 403);
    await api('/command/connect', {});
    assert.match((await api('/status')).qrSvg, /^<svg /);
    await waitFor(async () => (await api('/status')).devices.length);
    await api('/command/select', { clientId: 'app', slotId: 'device' });
    config.channels.A.minIntensity = 5;
    config.channels.A.maxIntensity = 20;
    config.channels.B.maxIntensity = 20;
    await api('/command/configure', { channels: config.channels });
    let sequence = 0;
    const send = async (event, data) => {
      const frame = { schemaVersion: 1, source: 'magicraft', sessionId: 'smoke', sequence: ++sequence,
        timestampUtc: new Date().toISOString(), event, data: { scene: 'Battle', damageType: 'enemy', ...data } };
      await new Promise((resolve, reject) => udp.send(Buffer.from(JSON.stringify(frame)), config.udpPort, '127.0.0.1', e => e ? reject(e) : resolve()));
      await waitFor(async () => (await api('/status')).sequence === sequence);
    };
    await send('player.snapshot', { hp: 100, maxHp: 100, timeScale: 1 });
    await api('/command/enable', {});
    await send('player.damaged', { hpDamage: 10, maxHp: 100 });
    await waitFor(() => frames.some(f => f.data.m === 'device.op' && f.data.data.t === 4));
    const intensity = frames.find(f => f.data.m === 'device.op' && f.data.data.t === 4);
    assert.equal(intensity.data.data.v, 13);
    await send('player.damaged', { hpDamage: 10, maxHp: 100, isTrap: true, damageType: 'trap' });
    await waitFor(() => frames.some(f => f.data.m === 'device.op' && f.data.data.t === 4 && f.data.data.c === 1));
    const started = Date.now();
    await api('/command/stop', {});
    assert.ok(Date.now() - started < 800, 'stop must not wait for feedback task completion');
    assert.equal((await api('/status')).enabled, false);
    const count = frames.filter(f => f.data.m === 'device.op' && f.data.data.t === 4).length;
    await send('player.damaged', { hpDamage: 20, maxHp: 100 });
    await new Promise(r => setTimeout(r, 50));
    assert.equal(frames.filter(f => f.data.m === 'device.op' && f.data.data.t === 4).length, count);
  } finally {
    udp.close(); child.kill();
    if (child.exitCode === null) await once(child, 'exit');
    for (const t of timers) clearTimeout(t);
    for (const ws of relay.clients) ws.terminate();
    await new Promise(resolve => relay.close(resolve));
    await rm(folder, { recursive: true, force: true });
  }
});
