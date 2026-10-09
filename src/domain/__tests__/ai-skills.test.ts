import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toChat } from '../ai';
import { categoriesOf, isInvestingSkill, parseSkillMd, pickSkillPath, rankCatalog, skillFolderFiles, skillSlug, skillsPrompt, suggestAgents, toSkillMd } from '../ai-skills';

describe('SKILL.md', () => {
  it('reads front matter in its usual shapes', () => {
    const p = parseSkillMd(`---\nname: Dividend Safety\ndescription: >\n  Check whether a dividend\n  is safe.\nlicense: "MIT"\nmetadata:\n  version: 1.0.0\n  author: someone\n---\n\n# Dividend\n\nSteps here.\n`);
    assert.deepEqual(p, { name: 'dividend-safety', description: 'Check whether a dividend is safe.', license: 'MIT', instructions: '# Dividend\n\nSteps here.' });
    const q = parseSkillMd(`---\r\nname: x\r\ndescription: |\r\n  line one\r\n  line two\r\n---\r\nbody`);
    assert.equal(q.description, 'line one\nline two');
    assert.equal(q.instructions, 'body');
  });

  it('falls back to the first heading without front matter, and round-trips', () => {
    assert.equal(parseSkillMd('# 내 매수 원칙\n\n1. 비중').name, '내-매수-원칙');
    const md = toSkillMd({ name: 'a-b', description: 'Use "this" when', instructions: '# A\nbody', license: 'MIT' });
    assert.deepEqual(parseSkillMd(md), { name: 'a-b', description: 'Use "this" when', license: 'MIT', instructions: '# A\nbody' });
    assert.equal(skillSlug('  Stock Analysis (v2)! '), 'stock-analysis-v2');
  });
});

describe('community catalog', () => {
  it('keeps investing skills only, most installed first, once each', () => {
    const items = rankCatalog([
      {
        skills: [
          { id: 'a/trading-skills/position-sizer', source: 'a/trading-skills', skillId: 'position-sizer', name: 'position-sizer', installs: 300 },
          { id: 'b/ui/ui-ux-pro-max', source: 'b/ui', skillId: 'ui-ux-pro-max', name: 'ui-ux-pro-max', installs: 9000 },
          { id: 'c/skills/stock-analysis', source: 'c/skills', skillId: 'stock-analysis', name: 'stock-analysis', installs: 500 },
          { id: 'okx/agent-skills/okx-cex-trade', source: 'okx/agent-skills', skillId: 'okx-cex-trade', name: 'x', installs: 999 },
          { id: 'd.com/stock', source: 'd.com', skillId: 'stock', name: 'stock', installs: 999 },
        ],
      },
      { skills: [{ id: 'a/trading-skills/position-sizer', source: 'a/trading-skills', skillId: 'position-sizer', name: 'position-sizer', installs: 310 }] },
      null,
    ]);
    assert.deepEqual(
      items.map((i) => [i.id, i.installs]),
      [
        ['c/skills/stock-analysis', 500],
        ['a/trading-skills/position-sizer', 310],
      ],
    );
  });

  it('tells investing skills from look-alikes', () => {
    const ok = (source: string, skillId: string) => isInvestingSkill({ source, skillId });
    assert.equal(ok('x/finance-skills', 'earnings-preview'), true);
    assert.equal(ok('x/skills', 'dividend-safety'), true);
    assert.equal(ok('x/agents', 'investigate-first'), false);
    assert.equal(ok('x/resumeskills', 'portfolio-case-study-writer'), false);
    assert.equal(ok('x/ecc', 'investor-materials'), false);
    assert.equal(ok('coinbase/agentic-wallet-skills', 'trade'), false);
    assert.deepEqual(categoriesOf({ id: 'x/dividend-skills/etf-overlap-check' }), ['income']);
  });

  it('finds a skill folder in a repository', () => {
    const paths = ['examples/demo/.claude/skills/vcp-screener/SKILL.md', 'skills/vcp-screener/SKILL.md', 'skills/vcp-screener/references/rules.md', 'skills/vcp-screener/scripts/scan.py', 'skills/other/SKILL.md', 'README.md'];
    const p = pickSkillPath(paths, 'vcp-screener');
    assert.equal(p, 'skills/vcp-screener/SKILL.md');
    assert.deepEqual(skillFolderFiles(paths, p!), { docs: ['skills/vcp-screener/references/rules.md'], skipped: ['scripts/scan.py'] });
    assert.equal(pickSkillPath(paths, 'missing'), null);
  });
});

describe('skills and agents', () => {
  it('suggests agents from the text', () => {
    assert.deepEqual(suggestAgents('dcf-valuation Rough discounted cash flow'), ['RESEARCH']);
    assert.deepEqual(suggestAgents('rebalance-plan target weights'), ['MANAGER']);
    assert.deepEqual(suggestAgents('trade-postmortem review a closed trade'), ['COACH']);
    assert.deepEqual(suggestAgents('zzz'), ['RESEARCH']);
  });

  it('lists skills for the agent and says what they cannot do', () => {
    assert.equal(skillsPrompt([], true), '');
    const p = skillsPrompt([{ name: 'moat-analysis', description: 'Judge the moat.' }], false);
    assert.match(p, /- `moat-analysis`: Judge the moat\./);
    assert.match(p, /use_skill/);
    assert.doesNotMatch(p, /웹 검색으로 대신/);
  });

  it('shows which skill an answer used', () => {
    const turns = toChat([
      { role: 'user', content: [{ type: 'text', text: '애플 어때?' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'use_skill', input: { name: 'moat-analysis' } }] },
    ]);
    assert.deepEqual((turns[1] as { parts: unknown[] }).parts, [{ kind: 'tool', name: 'use_skill', label: '스킬 ‘moat-analysis’ 사용' }]);
  });
});
