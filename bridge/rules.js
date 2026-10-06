import { WAVEFORMS, EVENT_LABELS, extendRule, modifiers } from './features.js';
export const SOURCE_LABELS = { enemy: '敌人攻击', trap: '陷阱伤害', self: '自己或友方造成的伤害', dot: '中毒 / 灼烧（来源不明）', unknown: '其他 / 来源不明' };
export function normalizeConfig(c) {
  if (c.channels) { for (const k of ['A','B']) c.channels[k]=extendRule({mergeDamage:false,mergeWindowMs:500,...c.channels[k]}); return c; }
  const legacy = { enabled: true, minIntensity: c.minIntensity ?? 0, maxIntensity: c.maxIntensity ?? 0,
    fullScaleDamageRatio: c.fullScaleDamageRatio ?? 0.2, durationMs: c.durationMs ?? 1000, cooldownMs: c.cooldownMs ?? 500,
    deathFeedback: true, deathDurationMs: c.deathDurationMs ?? 3000 };
  const a = { ...legacy, sources: ['enemy'] };
  const b = { ...legacy, minIntensity: 0, maxIntensity: 0, sources: ['trap'], deathFeedback: false };
  if (c.channel === 'B') { b.minIntensity = legacy.minIntensity; b.maxIntensity = legacy.maxIntensity; a.minIntensity = 0; a.maxIntensity = 0; }
  const next = { ...c, channels: { A: a, B: b } };
  for (const k of ['minIntensity', 'maxIntensity', 'fullScaleDamageRatio', 'durationMs', 'cooldownMs', 'deathDurationMs', 'channel']) delete next[k];
  return normalizeConfig(next);
}
export function validateConfig(c) {
  for (const [key, lo, hi] of [
    ['collectorTimeoutMs', 2000, 30000], ['udpPort', 1024, 65535], ['httpPort', 1024, 65535],
  ]) {
    if (!Number.isFinite(c[key]) || c[key] < lo || c[key] > hi) throw new Error(`无效设置：${key} (${lo}–${hi})`);
  }
  for (const k of ['collectorTimeoutMs', 'udpPort', 'httpPort'])
    if (!Number.isInteger(c[k])) throw new Error(`${k} 必须是整数`);
  for (const channel of ['A', 'B']) {
    const rule = c.channels?.[channel];
    if (!rule || typeof rule.enabled !== 'boolean' || typeof rule.deathFeedback !== 'boolean' || typeof rule.mergeDamage !== 'boolean') throw new Error(`${channel} 通道设置不完整`);
    if (!Array.isArray(rule.sources) || rule.sources.length > 5 || new Set(rule.sources).size !== rule.sources.length || rule.sources.some(s => !Object.hasOwn(SOURCE_LABELS, s))) throw new Error(`${channel} 通道伤害类型无效`);
    if (rule.enabled && !rule.sources.length) throw new Error(`${channel} 通道至少选择一种伤害`);
    for (const [key, lo, hi, integer] of [['minIntensity', 0, 200, true], ['maxIntensity', 0, 200, true],
      ['fullScaleDamageRatio', 0.01, 1, false], ['mergeWindowMs', 100, 10000, true], ['durationMs', 100, 3000, true], ['cooldownMs', 100, 3000, true], ['deathDurationMs', 100, 3000, true]]) {
      if (!Number.isFinite(rule[key]) || rule[key] < lo || rule[key] > hi || (integer && !Number.isInteger(rule[key]))) throw new Error(`${channel} 通道 ${key} 设置无效 (${lo}–${hi})`);
    }
    for(const key of ['lowHealthEnabled']) if(typeof rule[key]!=='boolean') throw Error(channel+' 低血量开关无效');
    for(const [key,lo,hi] of [['lowHealthThreshold',0.01,1],['lowHealthMultiplier',1,5]]) if(!Number.isFinite(rule[key])||rule[key]<lo||rule[key]>hi)throw Error(channel+' '+key+' 无效');
    for(const k of ['Monster','Elite','Boss']) if(!Number.isFinite(rule.enemyMultipliers?.[k])||rule.enemyMultipliers[k]<0||rule.enemyMultipliers[k]>5)throw Error(channel+' 敌人倍率无效');
    for(const k of Object.keys(SOURCE_LABELS)) if(!Object.hasOwn(WAVEFORMS,rule.waveforms?.[k]))throw Error(channel+' 波形无效');
    for(const k of Object.keys(EVENT_LABELS)) {const e=rule.eventFeedback?.[k]; if(!e||typeof e.enabled!=='boolean'||!Number.isInteger(e.intensity)||e.intensity<0||e.intensity>200||!Number.isInteger(e.durationMs)||e.durationMs<100||e.durationMs>3000||!Object.hasOwn(WAVEFORMS,e.waveform))throw Error(channel+' 事件设置无效');}
    if (rule.minIntensity > rule.maxIntensity) throw new Error(`${channel} 通道强度下限不能超过强度上限`);
  }
  const url = new URL(c.relayUrl);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.search) throw new Error('中继地址必须为不含查询参数的 ws/wss 地址');
  return c;
}

export function damageIntensity(data, c) {
  // Do not substitute realDamage: the game includes absorbed shield damage in it.
  const { hpDamage, maxHp } = data;
  if (!Number.isFinite(hpDamage) || hpDamage <= 0 || !Number.isFinite(maxHp) || maxHp <= 0) return null;
  const ratio = hpDamage / maxHp;
  const intensity = Math.round(c.minIntensity + (c.maxIntensity - c.minIntensity) * Math.min(1, ratio / c.fullScaleDamageRatio));
  return { intensity: Math.max(0, Math.min(c.maxIntensity, intensity)), ratio };
}

export class RuleEngine {
  constructor(config, output, now = Date.now) {
    this.config = validateConfig(normalizeConfig(config));
    this.output = output;
    this.now = now;
    this.history = [];
    this.eventKeys = new Set();
    this.enabled = false;
    this.session = null;
    this.sequence = 0;
    this.lastSeen = 0;
    this.lastSnapshot = 0;
    this.scene = '';
    this.paused = true;
    this.dead = false;
    this.resetChannels();
    this.reason = '等待游戏事件';
  }
  record(channel, outcome, detail, extra={}) { this.history.push({at:this.now(),channel,outcome,detail,...extra}); if(this.history.length>100)this.history.shift(); }
  preview() {return Object.fromEntries(['A','B'].map(c=>{const b=this.channelState[c].batch;return[c,b?{count:b.count,ratio:b.ratio,remainingMs:Math.max(0,b.until-this.now()),intensity:damageIntensity({hpDamage:b.weightedRatio,maxHp:1},this.config.channels[c]).intensity,waveform:b.waveform}:null]}));}
  feedbackEvent(key,d,terminal=false) {
    const id=key+':'+(d.stage??'')+':'+(d.level??'')+':'+(d.roomKey??d.roomId??'');
    if(this.eventKeys.has(id))return;
    this.eventKeys.add(id); if(this.eventKeys.size>256)this.eventKeys.delete(this.eventKeys.values().next().value);
    const can=this.enabled&&!this.paused&&!this.dead&&this.now()-this.lastSnapshot<=this.config.collectorTimeoutMs;
    if(terminal)this.halt('本局通关，联动已关闭');
    for(const c of ['A','B']) {const r=this.config.channels[c],e=r.eventFeedback[key]; const intensity=Math.min(r.maxIntensity,e.intensity);
      if(can&&r.enabled&&e.enabled&&intensity>0){const s=this.channelState[c];s.batch=null;s.activeUntil=this.now()+e.durationMs;s.activeIntensity=intensity;s.lastHit=this.now();this.output.play(intensity,e.durationMs,EVENT_LABELS[key],c,e.waveform);this.record(c,'已下发',EVENT_LABELS[key],{intensity,waveform:e.waveform});}
      else this.record(c,'未输出',EVENT_LABELS[key]+'：'+(!can?'联动未开启、暂停或快照超时':!e.enabled?'事件反馈未开启':'通道关闭或强度为 0'));
    }
  }
  halt(reason, disable = true) {
    if(this.enabled)for(const c of ['A','B'])this.record(c,'已停止',reason);
    if(this.channelState)for(const c of ['A','B'])if(this.channelState[c].batch)this.record(c,'已取消',reason);
    if (disable) this.enabled = false;
    this.resetChannels();
    this.reason = reason;
    return this.output.stop(reason);
  }
  resetChannels() {
    this.channelState = Object.fromEntries(['A', 'B'].map(c => [c, { lastHit: -Infinity, activeUntil: 0, activeIntensity: 0, batch: null }]));
  }
  enable() {
    if (!this.lastSnapshot || this.now() - this.lastSnapshot > this.config.collectorTimeoutMs || this.scene !== 'Battle' || this.paused || this.dead)
      throw new Error('需要游戏处于活动战斗中，并收到新鲜的玩家快照');
    if (!Object.values(this.config.channels).some(c => c.enabled && c.maxIntensity > 0)) throw new Error('至少开启一个通道，并设置大于 0 的强度上限');
    this.enabled = true;
    this.reason = '联动已启用';
    this.resetChannels();
  }
  tick() {
    if (this.enabled && this.now() - this.lastSnapshot > this.config.collectorTimeoutMs) this.halt('玩家快照超时，请检查游戏采集连接');
    if (this.enabled && !this.paused && !this.dead) for (const c of ['A', 'B']) this.flushBatch(c);
  }
  flushBatch(channel) {
    const state = this.channelState[channel], rule = this.config.channels[channel], batch = state.batch;
    if (!batch || this.now() < batch.until) return;
    state.batch = null;
    if (!rule.enabled || !rule.mergeDamage || rule.maxIntensity <= 0) return;
    const mapped = damageIntensity({ hpDamage: batch.weightedRatio, maxHp: 1 }, rule);
    this.reason = `${channel} 通道 · 合并 ${batch.count} 次受伤 ${(batch.ratio * 100).toFixed(1)}% → 强度 ${mapped.intensity}`;
    state.lastHit = this.now();
    state.activeUntil = this.now() + rule.durationMs;
    state.activeIntensity = mapped.intensity;
    if (mapped.intensity > 0) this.output.play(mapped.intensity, rule.durationMs, this.reason, channel, batch.waveform);
    this.record(channel,'已下发',this.reason,{intensity:mapped.intensity,waveform:batch.waveform});
  }
  accept(frame) {
    const now = this.now();
    if (frame?.schemaVersion !== 1 || frame.source !== 'magicraft' || typeof frame.sessionId !== 'string' ||
        !Number.isSafeInteger(frame.sequence) || frame.sequence < 1 || !frame.data || typeof frame.event !== 'string') return false;
    const timestamp = Date.parse(frame.timestampUtc);
    if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 2000) return false;
    if (this.session !== frame.sessionId) {
      // Ignore old sessions once a new stream has been adopted.
      if (this.retired?.has(frame.sessionId)) return false;
      this.retired ??= new Set();
      if (this.session) this.retired.add(this.session);
      this.session = frame.sessionId;
      this.sequence = 0;
      this.eventKeys.clear();
      this.lastSnapshot = 0;
      this.paused = true;
      this.dead = false;
      this.halt('新的采集会话，需要重新启用');
    }
    if (frame.sequence <= this.sequence) return false;
    if (this.sequence && frame.sequence !== this.sequence + 1) this.halt('事件序号出现缺口，需要重新启用');
    this.sequence = frame.sequence;
    this.lastSeen = now;
    const d = frame.data;
    this.scene = typeof d.scene === 'string' ? d.scene : this.scene;
    if (frame.event === 'time_scale.changed') {
      if (!Number.isFinite(d.timeScale) || d.timeScale <= 0) { this.paused = true; this.halt('游戏暂停', false); }
      else this.paused = false;
    }
    if (frame.event === 'player.snapshot') {
      if (Number.isFinite(d.hp) && Number.isFinite(d.maxHp) && d.maxHp > 0) {
        this.lastSnapshot = now;
        this.snapshot = d;
        if (Number.isFinite(d.timeScale)) {
          if (!this.paused && d.timeScale <= 0) this.halt('游戏暂停', false);
          this.paused = d.timeScale <= 0;
        }
        if (d.hp <= 0) this.dead = true;
      }
    }
    if (frame.event === 'battle.initialized') {this.dead = false;this.eventKeys.clear();}
    if (frame.event === 'battle.exited') { this.halt('主动退出本局，联动已关闭'); return true; }
    if (this.scene !== 'Battle') {
      this.dead = false;
      if (this.enabled || Object.values(this.channelState).some(s => s.activeUntil) || this.reason !== '已离开战斗') this.halt('已离开战斗');
      return true;
    }
    if(frame.event==='room.entered'&&d.hasBossFight===true)this.feedbackEvent('bossEntered',d);
    if(frame.event==='chapter.completed')this.feedbackEvent('chapterCompleted',d);
    if(frame.event==='battle.victory'){if(d.confirmedVictory===true)this.feedbackEvent('victory',d,true);return true;}
    if(frame.event==='room.completed'){
      this.halt('房间完成',false);this.feedbackEvent(d.hasBossFight===true?'bossCompleted':'roomCompleted',d);return true;
    }
    if (['collector.stopped', 'room.completed', 'room.left'].includes(frame.event)) {
      this.halt({ 'collector.stopped': '采集插件已停止', 'room.completed': '房间完成', 'room.left': '离开房间' }[frame.event], frame.event === 'collector.stopped'); return true;
    }
    if (frame.event === 'player.died') {
      if (d.confirmedDeath !== true) { this.halt('未确认的结束事件，联动已关闭'); return true; }
      const canPlay = this.enabled && !this.paused;
      this.dead = true;
      this.halt('玩家死亡，联动已关闭');
      if (canPlay) for (const channel of ['A', 'B']) {
        const rule = this.config.channels[channel];
        if (rule.enabled && rule.deathFeedback && rule.maxIntensity > 0) {
          this.output.play(rule.maxIntensity, rule.deathDurationMs, `${channel} 通道死亡反馈`, channel);
          this.record(channel,'已下发','死亡反馈',{intensity:rule.maxIntensity,waveform:'BUBBLE'});
        }
      }
      return true;
    }
    if (frame.event !== 'player.damaged') return true;
    if (d.attackerType === 'FromUI') { this.halt('主动退出本局，联动已关闭'); return true; }
    const source = d.isTrap === true ? 'trap' : Object.hasOwn(SOURCE_LABELS, d.damageType) ? d.damageType : 'unknown';
    this.lastDamage = { source, label: SOURCE_LABELS[source], hpDamage: d.hpDamage, maxHp: d.maxHp, at: now };
    if (!this.enabled || this.paused || this.dead) {for(const c of ['A','B'])this.record(c,'未输出',!this.enabled?'联动未开启':this.paused?'游戏暂停':'玩家已死亡',{source});return true;}
    if (!this.lastSnapshot || now - this.lastSnapshot > this.config.collectorTimeoutMs) { this.halt('玩家快照超时'); return true; }
    for (const channel of ['A', 'B']) {
      const rule = this.config.channels[channel], state = this.channelState[channel];
      if (!rule.enabled || !rule.sources.includes(source)) {this.record(channel,'未输出',!rule.enabled?'通道关闭':'此伤害来源未勾选',{source});continue;}
      const raw=damageIntensity(d,rule), mod=modifiers({...d,damageType:source},rule,this.snapshot);
      const mapped=raw&&damageIntensity({hpDamage:raw.ratio*mod.multiplier,maxHp:1},rule);
      const waveform=rule.waveforms[source];
      if (!mapped || rule.maxIntensity <= 0) {this.record(channel,'未输出',!mapped?'无有效生命伤害（可能仅护盾受伤）':'强度上限为 0',{source});continue;}
      if (rule.mergeDamage) {
        this.flushBatch(channel);
        if (!state.batch) state.batch = { until: now + rule.mergeWindowMs, ratio: 0, weightedRatio:0, waveform, count: 0 };
        state.batch.ratio += raw.ratio;
        state.batch.weightedRatio += mapped.ratio;
        if(!state.batch.strongest||mapped.ratio>state.batch.strongest){state.batch.strongest=mapped.ratio;state.batch.waveform=waveform;}
        state.batch.count++;
        this.reason = `${channel} 通道 · 正在合并受伤，等待 ${rule.mergeWindowMs / 1000} 秒窗口结束`;
        this.record(channel,'合并中',this.reason,{source,multiplier:mod.multiplier});
        continue;
      }
      if (mapped.intensity <= 0) {this.record(channel,'未输出','倍率或计算强度为 0',{source});continue;}
      const withinCooldown = now - state.lastHit < rule.cooldownMs;
      const active = now < state.activeUntil;
      if ((withinCooldown || active) && mapped.intensity <= state.activeIntensity) {this.record(channel,'未输出','冷却或正在反馈，强度未提高',{source,intensity:mapped.intensity});continue;}
      const duration = active ? Math.max(1, state.activeUntil - now) : rule.durationMs;
      if (!active) state.activeUntil = now + duration;
      state.activeIntensity = mapped.intensity;
      state.lastHit = now;
      this.reason = `${channel} 通道 · ${SOURCE_LABELS[source]} ${(mapped.ratio * 100).toFixed(1)}% → 强度 ${mapped.intensity}`;
      this.output.play(mapped.intensity, duration, this.reason, channel,waveform);
      this.record(channel,'已下发',this.reason,{source,intensity:mapped.intensity,waveform,multiplier:mod.multiplier});
    }
    return true;
  }
}
