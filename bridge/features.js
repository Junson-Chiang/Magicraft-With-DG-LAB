import { COYOTE_WAVEFORMS } from 'dglab-kit';
export const WAVEFORMS = Object.fromEntries(Object.entries(COYOTE_WAVEFORMS).map(([key,v])=>[key,v.label.cn||key]));
export const EVENT_LABELS = { bossEntered:'进入 Boss 房间', roomCompleted:'房间完成', bossCompleted:'Boss 房间完成', chapterCompleted:'章节完成', victory:'本局通关' };
export function extras() { return {
  lowHealthEnabled:false, lowHealthThreshold:0.3, lowHealthMultiplier:1.5,
  enemyMultipliers:{Monster:1,Elite:1,Boss:1},
  waveforms:{enemy:'BUBBLE',trap:'BUBBLE',self:'BUBBLE',dot:'BUBBLE',unknown:'BUBBLE'},
  eventFeedback:Object.fromEntries(Object.keys(EVENT_LABELS).map(k=>[k,{enabled:false,intensity:0,durationMs:1000,waveform:'BUBBLE'}]))
}; }
export function extendRule(rule) { const d=extras();return {...d,...rule, enemyMultipliers:{...d.enemyMultipliers,...rule.enemyMultipliers},waveforms:{...d.waveforms,...rule.waveforms},eventFeedback:Object.fromEntries(Object.keys(EVENT_LABELS).map(k=>[k,{...d.eventFeedback[k],...rule.eventFeedback?.[k]}]))}; }
export function modifiers(data,rule,snapshot) {
 const enemy=data.damageType==='enemy' ? rule.enemyMultipliers?.[data.attackerUnitType]??1 : 1;
 const hp=Number.isFinite(data.hpAfter)?data.hpAfter:snapshot?.hp;
 const max=Number.isFinite(data.maxHp)?data.maxHp:snapshot?.maxHp;
 const low=rule.lowHealthEnabled&&Number.isFinite(hp)&&max>0&&hp/max<=rule.lowHealthThreshold ? rule.lowHealthMultiplier : 1;
 return {multiplier:enemy*low,enemy,low};
}
