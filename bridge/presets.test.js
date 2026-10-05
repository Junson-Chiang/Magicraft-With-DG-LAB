import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Presets} from './presets.js';
import {normalizeConfig} from './rules.js';
test('custom presets persist, preserve settings and built-ins never raise limits',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'magicraft-presets-'));try{
 const config=normalizeConfig(JSON.parse(await readFile(new URL('./config.example.json',import.meta.url))));config.channels.A.maxIntensity=20;
 const p=new Presets(join(folder,'presets.json'),config);await p.init();await p.save('自己的方案',config.channels);
 config.channels.A.maxIntensity=2;assert.equal(p.channels('自己的方案').A.maxIntensity,20);assert.equal(p.channels('builtin:gentle').A.maxIntensity,2);assert.equal(p.channels('builtin:split').A.maxIntensity,2);
 const q=new Presets(p.path,config);await q.init();assert.equal(q.list().length,3);await q.remove('自己的方案');assert.equal(q.list().length,2);
 await assert.rejects(q.save('builtin:bad',config.channels));await assert.rejects(q.remove('builtin:split'));
 }finally{await rm(folder,{recursive:true,force:true});}
});
