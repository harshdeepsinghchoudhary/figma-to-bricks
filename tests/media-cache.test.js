import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCachedMedia } from '../scripts/media-cache.js';
const entry = { id: 12, url: 'https://example.test/old.png', filename: 'a.png' };
const check = (status, data) => verifyCachedMedia(entry, {site:'https://example.test',auth:'test',fetchImpl:async()=>({status,ok:status===200,json:async()=>data})});
test('deleted or trashed cached media must be uploaded again', async()=>{
  assert.equal(await check(404),null);
  assert.equal(await check(410),null);
  assert.equal(await check(200,{status:'trash'}),null);
});
test('live media uses the current attachment URL',async()=>{
  assert.equal((await check(200,{id:12,source_url:'https://example.test/current.png'})).url,'https://example.test/current.png');
});
test('authorization and server failures stop reuse instead of causing duplicate uploads',async()=>{
  for(const status of [401,403,500]) await assert.rejects(check(status),/Cannot verify/);
  await assert.rejects(check(200,{id:99,source_url:'https://example.test/wrong.png'}),/Invalid media/);
});
