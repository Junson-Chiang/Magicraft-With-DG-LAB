import { WAVEFORMS, EVENT_LABELS } from './features.js';
import { Presets } from './presets.js';
import dgram from 'node:dgram';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DglabSocket } from 'dglab-kit';
import qrcode from 'qrcode-terminal';
import { RuleEngine, validateConfig, normalizeConfig } from './rules.js';
import { DeviceOutput } from './device-output.js';
import { pairingSvg } from './qr-svg.js';

const configPath = process.env.MAGICRAFT_BRIDGE_CONFIG || new URL('./config.json', import.meta.url);
let configText;
try { configText = await readFile(configPath, 'utf8'); }
catch (error) {
  if (error.code !== 'ENOENT' || process.env.MAGICRAFT_BRIDGE_CONFIG) throw error;
  configText = await readFile(new URL('./config.example.json', import.meta.url), 'utf8');
  await writeFile(configPath, configText, { flag: 'wx' });
}
const config = validateConfig(normalizeConfig(JSON.parse(configText)));
const presetPath = process.env.MAGICRAFT_BRIDGE_PRESETS || new URL('./presets.json', import.meta.url);
const presets = new Presets(presetPath,config); await presets.init();
const page = await readFile(new URL('./panel.html', import.meta.url));
const token = process.env.MAGICRAFT_BRIDGE_TOKEN || randomBytes(24).toString('hex');
const logs = [];
function log(message) {
  const entry = { time: new Date().toISOString(), message };
  logs.push(entry);
  if (logs.length > 80) logs.shift();
  console.log(`[${entry.time}] ${message}`);
}
let socket, output, engine;
let pairingUrl = '', qrSvg = '', relayState = '未连接', connecting = false;
const devices = new Map();
function initializeSocket() {
  socket = new DglabSocket({ url: config.relayUrl, responseTimeout: 1500 });
  const currentSocket = socket;
  output = new DeviceOutput(socket, log, () => {
    if (socket !== currentSocket) return;
    engine.enabled = false;
    engine.resetChannels();
    engine.reason = '设备操作失败，需要重新启用';
  });
  if (engine) engine.output = output;
  else engine = new RuleEngine(config, output);
  socket.on('state', state => { if (socket === currentSocket) relayState = state; });
  socket.on('error', error => log(`中继错误：${error?.message ?? error}`));
  socket.on('close', () => {
    if (socket !== currentSocket) return;
    engine.halt('中继已断开');
    pairingUrl = '';
    qrSvg = '';
    devices.clear();
    output.select(null);
  });
  socket.on('client-disconnected', clientId => {
    if (socket !== currentSocket) return;
    devices.delete(clientId);
    if (output.target?.clientId === clientId) {
      engine.halt('目标 APP 已断开');
      output.select(null);
    }
  });
  socket.on('devices', (list, clientId) => {
    if (socket !== currentSocket) return;
    const previous = devices.get(clientId);
    devices.set(clientId, list);
    if (output.target?.clientId === clientId) {
      const selected = list.find(d => d.slotId === output.target.slotId);
      if (!selected || selected.slotState?.hasDevice === false) {
        engine.halt('目标设备已移除');
        output.select(null);
      }
    }
    if (!previous || previous.map(d => d.slotId).join() !== list.map(d => d.slotId).join()) log(`已连接 ${list.length} 台设备`);
  });
  socket.on('client-attached', async clientId => {
    log(`APP 已接入：${clientId}`);
    try {
      const result = await currentSocket.requestDevices(clientId);
      if (socket !== currentSocket) return;
      if (!devices.has(clientId)) devices.set(clientId, result.devices);
    } catch (error) { log(`设备查询失败：${error.message}`); }
  });
}
initializeSocket();

async function connect() {
  if (connecting) throw new Error('正在连接');
  connecting = true;
  try {
    await engine.halt('重新连接，需要重新启用');
    socket.destroy();
    devices.clear();
    pairingUrl = '';
    qrSvg = '';
    initializeSocket();
    const { targetId } = await socket.connect();
    const appUrl = new URL(config.relayUrl);
    appUrl.searchParams.set('tid', targetId);
    pairingUrl = `https://dungeon-lab.cn/s/?v=1&action=socket&url=${encodeURIComponent(appUrl.href)}`;
    qrSvg = pairingSvg(pairingUrl);
    log('配对二维码（用 DG-LAB 4 APP 扫描）：');
    qrcode.generate(pairingUrl, { small: true });
    log(pairingUrl);
  } finally { connecting = false; }
}

const udp = dgram.createSocket('udp4');
udp.on('message', (buffer, remote) => {
  if (remote.address !== '127.0.0.1' || buffer.length > 32768) return;
  try { engine.accept(JSON.parse(buffer.toString('utf8'))); } catch (error) { log(`事件处理失败：${error.message}`); engine.halt('事件处理失败'); }
});
udp.on('error', error => { log(`UDP 错误：${error.message}`); engine.halt('UDP 接收失败'); });
udp.bind(config.udpPort, '127.0.0.1');
const watchdog = setInterval(() => engine.tick(), 50);

function status() {
  return { config, relayState, pairingUrl, qrSvg, connecting, target: output.target,
    devices: [...devices].flatMap(([clientId, list]) => list.map(d => ({ ...d, clientId }))),
    enabled: engine.enabled, paused: engine.paused, reason: engine.reason,
    scene: engine.scene, snapshot: engine.snapshot, lastSeen: engine.lastSeen,
    waveforms:WAVEFORMS,eventLabels:EVENT_LABELS,presets:presets.list(),history:engine.history,mergePreview:engine.preview(),sequence: engine.sequence, lastDamage: engine.lastDamage, logs };
}
function authenticated(req) {
  const supplied = Buffer.from(req.headers['x-control-token'] ?? '');
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
let controlEpoch = 0;
async function command(action, body) {
  if (action === 'stop') { controlEpoch++; return engine.halt('手动停止'); }
  if (action === 'connect') return connect();
  if (action === 'select') {
    const found = devices.get(body.clientId)?.find(d => d.slotId === body.slotId);
    if (!found || found.slotState?.hasDevice === false) throw new Error('设备不存在或未连接');
    if (!['COYOTE_020', 'COYOTE_030'].includes(found.type)) throw new Error('当前波形只支持郊狼 V2/V3 设备');
    await engine.halt('切换设备，需要重新启用');
    output.select({ clientId: body.clientId, slotId: body.slotId });
    await output.stop('选择设备后归零');
    return;
  }
  if(action==='preset-save')return presets.save(body.name,body.channels);
  if(action==='preset-delete')return presets.remove(body.id);
  if(action==='preset-apply')return command('configure',{channels:presets.channels(body.id)});
  if (action === 'configure') {
    const allowed = ['channels', 'relayUrl'];
    const next = { ...config };
    for (const key of allowed) if (Object.hasOwn(body, key)) next[key] = body[key];
    normalizeConfig(next); validateConfig(next);
    await engine.halt('配置已更新，需要重新启用');
    if (next.relayUrl !== config.relayUrl) output.select(null);
    await writeFile(configPath, JSON.stringify(next, null, 2) + '\n');
    Object.assign(config, next);
    return;
  }
  if (action === 'enable') {
    const epoch = controlEpoch;
    if (!output.target || !devices.get(output.target.clientId)?.some(d => d.slotId === output.target.slotId && d.slotState?.hasDevice !== false)) throw new Error('先选择已连接的设备');
    // Ensure no death/previous operation remains before rearming.
    await output.stop('启用前归零');
    if (epoch !== controlEpoch) throw new Error('启用被停止操作取消');
    if (output.lastError) throw new Error('设备归零失败，需要检查连接');
    if (!output.target) throw new Error('目标设备已断开');
    const device = devices.get(output.target.clientId)?.find(d => d.slotId === output.target.slotId);
    for (const channel of ['A', 'B']) {
      const rule = config.channels[channel];
      if (rule.enabled && rule.maxIntensity > 0 && device?.slotState?.[`channel${channel}`]?.isMuted === true)
        throw new Error(`${channel} 通道在手机 APP 中被暂停输出，请先在 APP 中开启该通道`);
    }
    engine.enable();
    return;
  }
  throw new Error('未知操作');
}
let mutationBusy = false;
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  if (req.headers.host !== `127.0.0.1:${config.httpPort}`) { res.writeHead(403).end(); return; }
  if (req.url === '/' && req.method === 'GET') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page); return; }
  if (!authenticated(req)) { res.writeHead(403).end(); return; }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.url === '/status' && req.method === 'GET') { res.end(JSON.stringify(status())); return; }
  if (req.method !== 'POST' || !req.url.startsWith('/command/')) { res.writeHead(404).end('{}'); return; }
  if (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${config.httpPort}`) { res.writeHead(403).end('{}'); return; }
  const action = req.url.slice('/command/'.length);
  // Stop interrupts in-flight actions immediately, rather than waiting for other HTTP work.
  if (mutationBusy && action !== 'stop') { res.writeHead(409).end(JSON.stringify({ error: '操作正在执行' })); return; }
  if (action !== 'stop') mutationBusy = true;
  try {
    let text = '';
    for await (const chunk of req) { text += chunk; if (text.length > 32768) throw new Error('请求过大'); }
    await command(action, text ? JSON.parse(text) : {});
    res.end(JSON.stringify({ ok: true }));
  } catch (error) { res.writeHead(400).end(JSON.stringify({ error: error.message })); }
  finally { if (action !== 'stop') mutationBusy = false; }
});
server.on('error', error => { log(`面板启动失败：${error.message}`); shutdown(); });
server.listen(config.httpPort, '127.0.0.1', () => {
  log(`控制面板：http://127.0.0.1:${config.httpPort}/#${token}`);
  log('默认强度为 0、联动关闭。打开面板连接中继、选择设备并配置。');
});
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(watchdog);
  await engine.halt('程序退出');
  socket.destroy();
  try { udp.close(); } catch {}
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
