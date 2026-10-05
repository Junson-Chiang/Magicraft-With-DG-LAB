import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RuleEngine, damageIntensity, validateConfig, normalizeConfig } from './rules.js';
const base = JSON.parse(await readFile(new URL('./config.example.json', import.meta.url)));
const config = normalizeConfig(base);
config.channels.A = { ...config.channels.A, minIntensity: 5, maxIntensity: 20 };
const mapping = config.channels.A;
function setup() {
  let now = 1700000000000, sequence = 0;
  const calls = [];
  const output = { stop: reason => calls.push(['stop', reason]), play: (...args) => calls.push(['play', ...args]) };
  const engine = new RuleEngine({ ...config }, output, () => now);
  const event = (name, data = {}, extra = {}) => engine.accept({ schemaVersion: 1, source: 'magicraft', sessionId: 'test',
    sequence: ++sequence, timestampUtc: new Date(now).toISOString(), event: name, data: { scene: 'Battle', damageType: 'enemy', ...data }, ...extra });
  event('player.snapshot', { hp: 100, maxHp: 100, timeScale: 1 });
  engine.enable();
  calls.length = 0;
  return { engine, calls, event, advance: ms => { now += ms; } };
}
test('damage proportion maps to bounded intensity and shield-only hits are ignored', () => {
  assert.equal(damageIntensity({ hpDamage: 10, maxHp: 100 }, mapping).intensity, 13);
  assert.equal(damageIntensity({ hpDamage: 1000, maxHp: 100 }, mapping).intensity, 20);
  for (const data of [{ realDamage: 40, hpDamage: 0, maxHp: 100 }, { realDamage: 40, maxHp: 100 }, { hpDamage: 5, maxHp: 0 }])
    assert.equal(damageIntensity(data, mapping), null);
  assert.throws(() => validateConfig({ ...config, channels: { ...config.channels, A: { ...mapping, minIntensity: 50 } } }));
});
test('enemy goes only to A, trap only to B, and per-channel cooldown is independent', () => {
  const t = setup();
  t.engine.config = structuredClone(config);
  t.engine.config.channels.B.maxIntensity = 20;
  t.event('player.damaged', { hpDamage: 10, maxHp: 100, damageType: 'enemy' });
  t.advance(100);
  t.event('player.damaged', { hpDamage: 10, maxHp: 100, damageType: 'trap', isTrap: true });
  t.event('player.damaged', { hpDamage: 20, maxHp: 100, damageType: 'unknown' });
  assert.deepEqual(t.calls.filter(c => c[0] === 'play').map(c => c[4]), ['A', 'B']);
  assert.equal(t.calls[1][2], 1000);
});
test('one event can match both ranges; disabled channel and unchecked source never trigger', () => {
  const t = setup(); t.engine.config = structuredClone(config);
  t.engine.config.channels.B = { ...mapping, sources: ['enemy'] };
  t.event('player.damaged', { hpDamage: 10, maxHp: 100 });
  assert.deepEqual(t.calls.filter(c => c[0] === 'play').map(c => c[4]), ['A', 'B']);
  t.advance(1500); t.calls.length = 0;
  t.engine.config.channels.B.enabled = false;
  t.event('player.damaged', { hpDamage: 10, maxHp: 100 });
  assert.deepEqual(t.calls.filter(c => c[0] === 'play').map(c => c[4]), ['A']);
});
test('higher consecutive hit replaces only remaining time; lower hit does not extend', () => {
  const t = setup();
  t.event('player.damaged', { hpDamage: 5, maxHp: 100 });
  t.advance(200);
  t.event('player.damaged', { hpDamage: 20, maxHp: 100 });
  t.advance(200);
  t.event('player.damaged', { hpDamage: 5, maxHp: 100 });
  assert.deepEqual(t.calls.map(c => c.slice(0, 3)), [['play', 9, 1000], ['play', 20, 800]]);
});
test('pause stops output; resume does not replay old damage', () => {
  const t = setup();
  t.event('time_scale.changed', { timeScale: 0 });
  t.event('player.damaged', { hpDamage: 20, maxHp: 100 });
  assert.equal(t.calls.filter(c => c[0] === 'play').length, 0);
  t.event('player.snapshot', { hp: 100, maxHp: 100, timeScale: 1 });
  assert.equal(t.calls.filter(c => c[0] === 'play').length, 0);
  t.event('player.damaged', { hpDamage: 5, maxHp: 100 });
  assert.equal(t.calls.filter(c => c[0] === 'play').length, 1);
});
test('death plays one bounded feedback and disables subsequent hits', () => {
  const t = setup();
  t.event('player.died', { confirmedDeath: true });
  t.event('player.died');
  t.event('player.damaged', { hpDamage: 20, maxHp: 100 });
  assert.equal(t.engine.enabled, false);
  assert.deepEqual(t.calls.filter(c => c[0] === 'play').map(c => c.slice(0, 3)), [['play', 20, 3000]]);
});
test('snapshot timeout, sequence gap and scene exit disable output', () => {
  const t = setup();
  t.advance(5001); t.engine.tick();
  assert.equal(t.engine.enabled, false);
  const u = setup(); u.event('player.damaged', { hpDamage: 20, maxHp: 100 }, { sequence: 10 });
  assert.equal(u.engine.enabled, false);
  assert.equal(u.calls.filter(c => c[0] === 'play').length, 0);
  const v = setup(); v.event('scene.changed', { scene: 'Camp' });
  assert.equal(v.engine.enabled, false);
});
test('duplicate/stale/session replay events cannot trigger output', () => {
  const t = setup();
  assert.equal(t.event('player.damaged', { hpDamage: 20, maxHp: 100 }, { sequence: 1 }), false);
  assert.equal(t.event('player.damaged', { hpDamage: 20, maxHp: 100 }, { timestampUtc: '2000-01-01' }), false);
  t.event('collector.started', {}, { sessionId: 'new' });
  assert.equal(t.event('player.damaged', { hpDamage: 20, maxHp: 100 }), false);
  assert.equal(t.calls.filter(c => c[0] === 'play').length, 0);
});

test('exit never triggers death feedback, including legacy menu damage', () => {
 for(const name of ['battle.exited','player.damaged','player.died']) {
 const t=setup(); t.event(name,{attackerType:'FromUI',hpDamage:100,maxHp:100}); t.event('player.died',{confirmedDeath:true});
 assert.equal(t.engine.enabled,false); assert.equal(t.calls.filter(c=>c[0]==='play').length,0);
 }
});
test('merge sums ratios at fixed deadline and channels stay independent', () => {
 const t=setup(); t.engine.config=structuredClone(config);
 Object.assign(t.engine.config.channels.A,{mergeDamage:true,mergeWindowMs:500});
 Object.assign(t.engine.config.channels.B,{mergeDamage:true,mergeWindowMs:1000,maxIntensity:20});
 t.event('player.damaged',{hpDamage:5,maxHp:100}); t.advance(200);
 t.event('player.damaged',{hpDamage:5,maxHp:100}); t.event('player.damaged',{damageType:'trap',hpDamage:1000,maxHp:100});
 t.advance(299); t.engine.tick(); assert.equal(t.calls.length,0); t.advance(1); t.engine.tick();
 assert.deepEqual(t.calls[0].slice(0,3),['play',13,1000]); t.engine.tick(); assert.equal(t.calls.length,1);
 t.advance(700); t.engine.tick(); assert.equal(t.calls[1][1],20); assert.equal(t.calls[1][4],'B');
});
test('pending batches cancel on pause, quit, room change, stop, death or timeout', () => {
 for(const name of ['time_scale.changed','battle.exited','room.left','player.died','stop','timeout']) {
 const t=setup(); t.engine.config=structuredClone(config); Object.assign(t.engine.config.channels.A,{mergeDamage:true,mergeWindowMs:500});
 t.event('player.damaged',{hpDamage:5,maxHp:100});
 if(name==='stop')t.engine.halt('stop'); else if(name==='timeout')t.advance(5001); else t.event(name,{timeScale:0});
 t.advance(1000);t.engine.tick();assert.equal(t.calls.filter(c=>c[0]==='play').length,0,name);
 }
});
test('invalid merge windows rejected',()=>{
 for(const mergeWindowMs of [0,99,10001,NaN,500.5])assert.throws(()=>validateConfig({...config,channels:{...config.channels,A:{...mapping,mergeWindowMs}}}));
});
