import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_CANVAS, MAX_DEPTH, MAX_ISSUES, MAX_NODES, PLAN_INSTRUCTIONS, PlanValidationError, validate_plan } from '../plan.ts';

const node = (id: string, parentId: string | null = null, kind: unknown = 'container', patch: Record<string, unknown> = {}) =>
  ({ id, parentId, kind, name: '节点', x: 0, y: 0, width: 100, height: 100, ...patch });
const plan = (nodes: ReturnType<typeof node>[], patch: Record<string, unknown> = {}) => ({ width: 100, height: 100, nodes, issues: [], ...patch });
const no_assets = new Set<string>();

test('canonicalizes a valid out-of-order hierarchy without mutating raw values', () => {
  const raw = plan([node('balance.label', 'balance', 'label', { text: '', fontAssetId: 'font', x: 60, width: 40 }),
    node('root', null, 'container', { name: '　主画面 ' }),
    node('balance', 'root', 'layout', { direction: 'row', gap: .5, align: 'center' }),
    node('add-button', 'balance', 'button', { assetId: 'plus', x: 18, y: 5, width: 30, height: 20 })],
    { issues: [{ message: '底框未提供', resolution: '用条目容器占位', severity: 'warning' }] });
  const actual = validate_plan(raw, new Set(['font', 'plus']));
  assert.deepEqual(actual.nodes.map(n => n.id), ['balance.label', 'root', 'balance', 'add-button']);
  assert.equal(actual.nodes[2]?.direction, 'horizontal');
  assert.equal(actual.nodes[1]?.name, '主画面');
  assert.equal((raw.nodes[2] as Record<string, unknown>).direction, 'row');
  assert.notEqual(actual.issues, raw.issues);
  assert.match(PLAN_INSTRUCTIONS, /nodes 最多 400 个/);
});
test('rejects unsafe objects, IDs and unknown fields without echoing input', () => {
  for (const child of [node('a\n', 'root'), node('a', 'root', []), node('a', 'root', 'container', { align: {} }),
    node('a', 'root', 'container', { text: 'not allowed' }), node('a', 'root', 'container', { direction: 'row' }),
    node('a', 'root', 'container', { hostile: '<hostile>' }), node('a', 'root', 'layout'), node('a', 'root', 'label')]) {
    assert.throws(() => validate_plan(plan([node('root'), child]), no_assets), (e) =>
      e instanceof PlanValidationError && !e.message.includes('<hostile>'));
  }
  assert.throws(() => validate_plan(Object.create({ width: 100 }), no_assets), /JSON 对象/);
  assert.throws(() => validate_plan(JSON.parse('{"height":100,"width":100,"nodes":[],"issues":[],"__proto__":null}'), no_assets), /不支持的字段/);
});
test('requires known sprite assets; allows empty text and placeholder containers', () => {
  for (const n of [node('a','root','sprite'), node('a','root','sprite',{assetId:'invented'})]) {
    assert.throws(() => validate_plan(plan([node('root'), n]), new Set(['known'])), /资产/);
  }
  assert.equal(validate_plan(plan([node('root'),node('placeholder','root')], { issues:[{message:'缺图'}] }), no_assets).nodes[1]?.kind, 'container');
});
test('checks geometry, graph, depth and issue limits', () => {
  for (const patch of [{width:true},{x:-1},{y:NaN},{x:Infinity},{height:0},{x:10,width:91},{y:99,height:1.5},{width:BigInt(1)}]) {
    assert.throws(() => validate_plan(plan([node('root',null,'container',patch)]), no_assets), /数字|超出画布/);
  }
  assert.throws(() => validate_plan(plan([node('root')],{width:MAX_CANVAS+1}), no_assets), /画布宽度/);
  for (const nodes of [
    [node('root'),node('second-root')],[node('root'),node('root','root')],[node('root'),node('a','missing')],
    [node('root'),node('a','b'),node('b','a')],[node('root'),node('a','a')],
    [node('root'),node('leaf','root','label',{text:''}),node('child','leaf')],[node('root',null,'label',{text:''})]
  ]) assert.throws(() => validate_plan(plan(nodes), no_assets), PlanValidationError);
  const deep = Array.from({length:MAX_DEPTH},(_,i)=>node('a'+i,i===0?'root':'a'+(i-1)));
  assert.equal(validate_plan(plan([node('root'),...deep]), no_assets).nodes.length, MAX_DEPTH+1);
  assert.throws(() => validate_plan(plan([node('root'),...deep,node('too-deep','a'+(MAX_DEPTH-1))]), no_assets), /层级深度/);
  assert.throws(() => validate_plan(plan(Array.from({length:MAX_NODES+1},(_,i)=>node('a'+i))), no_assets), /节点列表/);
  assert.throws(() => validate_plan(plan([node('root')],{issues:Array(MAX_ISSUES+1).fill({message:'x'})}), no_assets), /问题列表/);
  assert.throws(() => validate_plan(plan([node('root')],{issues:[{message:'x',severity:'alarm'}]}), no_assets), /问题等级/);
});
test('Unicode scalar length, empty text, and Python whitespace parity', () => {
  const text = '𠮷'.repeat(4000);
  const raw = (value: unknown) => plan([node('root'),node('a','root','label',{text:value})]);
  assert.equal(validate_plan(raw(text), no_assets).nodes[1]?.text, text);
  for (const value of [text+'人', 42, '尬\ud800', '\u0000test', 'A\u007f', '\u0085']) {
    assert.throws(() => validate_plan(raw(value), no_assets), PlanValidationError);
  }
  assert.equal(validate_plan(raw('\r\n\t'), no_assets).nodes[1]?.text, '\r\n\t');
  assert.equal(validate_plan(plan([node('root',null,'container',{name:'\uFEFF'})]), no_assets).nodes[0]?.name, '\uFEFF');
  assert.throws(() => validate_plan(plan([node('root',null,'container',{name:'\u3000'})]), no_assets), /非空/);
});
