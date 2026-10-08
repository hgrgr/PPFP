import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, hashtags, key, related, SAGE_PRESETS, TOPIC_PRESETS, type KRef } from '../knowledge';
import { PRESETS } from '../traits';

const r = (type: KRef['type'], id: string): KRef => ({ type, id });
const link = (x: KRef, y: KRef) => canonical(x, y);

describe('links', () => {
  it('stores a pair in one order whichever side made it', () => {
    assert.deepEqual(canonical(r('asset', 'a'), r('sage', 's')), canonical(r('sage', 's'), r('asset', 'a')));
    assert.equal(canonical(r('asset', 'a'), r('sage', 's')).a.type, 'sage');
  });

  it('reads #tags from a note', () => {
    assert.deepEqual(hashtags('오늘 #가치투자 공부. #안전마진, #경제적_해자 #1 a#b (#PER)'), ['가치투자', '안전마진', '경제적 해자', 'PER']);
    assert.deepEqual(hashtags('메일 me@x.com 과 C# 언어'), []);
  });
});

describe('related items', () => {
  // 버핏 —(키워드)— 가치투자 —(성질)— 가치주 —(지정)— 삼성전자
  const buffett = r('sage', 'buffett');
  const value = r('topic', 'value');
  const valueTrait = r('trait', 'value-stock');
  const book = r('book', 'intelligent-investor');
  const note = r('note', 'n1');
  const links = [link(buffett, value), link(value, valueTrait), link(book, valueTrait), link(note, r('asset', 'samsung')), link(buffett, book)];
  const tags = new Map([
    ['samsung', ['value-stock']],
    ['aapl', ['growth']],
  ]);
  const by = (list: ReturnType<typeof related>) => Object.fromEntries(list.map((x) => [key(x.ref), x.via.map((v) => (v ? key(v) : 'direct'))]));

  it('finds the investors and books behind a stock through its traits and their topics', () => {
    const out = by(related(r('asset', 'samsung'), links, tags));
    assert.deepEqual(out['sage:buffett'], ['topic:value']);
    assert.deepEqual(out['book:intelligent-investor'], ['trait:value-stock']);
    assert.deepEqual(out['note:n1'], ['direct']);
    assert.deepEqual(out['topic:value'], ['trait:value-stock']);
    assert.equal(out['asset:aapl'], undefined);
  });

  it('finds the stocks that fit an investor through the topics they stand for', () => {
    const out = by(related(buffett, links, tags));
    assert.deepEqual(out['asset:samsung'], ['trait:value-stock']);
    assert.deepEqual(out['trait:value-stock'], ['topic:value']);
    assert.deepEqual(out['book:intelligent-investor'], ['direct']);
    assert.equal(out['asset:aapl'], undefined);
  });

  it('shows a trait its stocks, topics and what those topics are about', () => {
    const out = by(related(valueTrait, links, tags));
    assert.deepEqual(out['asset:samsung'], ['direct']);
    assert.deepEqual(out['sage:buffett'], ['topic:value']);
    assert.deepEqual(out['topic:value'], ['direct']);
  });
});

describe('presets', () => {
  const traitNames = new Set(PRESETS.flatMap((p) => p.traits.map((t) => t.name)));
  const topicNames = new Set(TOPIC_PRESETS.map((t) => t.name));
  it('point only at traits and topics that exist', () => {
    for (const t of TOPIC_PRESETS) for (const n of t.traits) assert.ok(traitNames.has(n), `${t.name} → ${n}`);
    for (const s of SAGE_PRESETS) {
      for (const n of s.traits) assert.ok(traitNames.has(n), `${s.name} → ${n}`);
      for (const n of s.topics) assert.ok(topicNames.has(n), `${s.name} → ${n}`);
    }
    assert.equal(new Set(SAGE_PRESETS.map((s) => s.key)).size, SAGE_PRESETS.length);
  });
});
