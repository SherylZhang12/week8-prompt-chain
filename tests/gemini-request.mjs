import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestGemini} from '../lib/gemini-request.ts';

test('retries a transient Gemini 503 with the same image request', async t => {
  const body = JSON.stringify({photo:'fixture'});
  let calls = 0;
  const fetch = t.mock.method(globalThis,'fetch',async (_url,options) => {
    assert.equal(options.body,body);
    return new Response(null,{status:++calls === 1 ? 503 : 200});
  });
  const result = await requestGemini('https://example.com',{method:'POST',body},Date.now()+5000);
  assert.equal(result.status,200);
  assert.equal(fetch.mock.callCount(),2);
});

test('returns a non-transient Gemini error without retrying', async t => {
  const fetch = t.mock.method(globalThis,'fetch',async () => new Response(null,{status:403}));
  assert.equal((await requestGemini('https://example.com',{},Date.now()+5000)).status,403);
  assert.equal(fetch.mock.callCount(),1);
});
