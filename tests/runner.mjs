import test from 'node:test';
import assert from 'node:assert/strict';
import {runChain} from '../lib/runner.ts';

const step = (position) => ({position,id:String(position),name:'Step '+position,model:'gemini',instruction:'Example'});
test('runs saved order, passes previous text, attaches the image only to step one', async () => {
  const photo = {mimeType:'image/png',data:'fixture'};
  const calls = [];
  const run = await runChain([step(3),step(1),step(2)],'input',photo,async (config,input,image)=>{
    calls.push([config.position,input,image]);
    return 'output '+config.position;
  });
  assert.deepEqual(calls,[[1,'input',photo],[2,'output 1',null],[3,'output 2',null]]);
  assert.equal(run.status,'succeeded');
  assert.equal(run.output,'output 3');
  assert.equal(run.trace.length,3);
});
test('stops after a failure and retains completed step output',async()=>{
  const calls=[];
  const run=await runChain([step(1),step(2),step(3)],'input',null,async config=>{
    calls.push(config.position);
    if(config.position===2) throw Error('provider failed');
    return 'first result';
  });
  assert.deepEqual(calls,[1,2]);
  assert.equal(run.status,'failed');
  assert.match(run.output,/Step 2.*provider failed/);
  assert.equal(run.trace[0].text,'first result');
});
