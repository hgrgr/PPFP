/**
 * Fake community skill catalog for documentation screenshots (loaded by fake-market.cjs, active
 * only when PPFP_FAKE_SKILLS=1 so a local demo still shows the real skills.sh ranking). Answers
 * the skills.sh search and the GitHub tree and raw-file requests the app makes. Every owner,
 * repository, skill and install count here is made up.
 */
'use strict';

if (process.env.PPFP_FAKE_SKILLS === '1') {
  // [owner/repo, skill, installs, description, steps]
  const SKILLS = [
    ['value-lab/investing-skills', 'moat-analysis', 8210, 'Judge how durable a company\'s competitive advantage is. Use when the user asks about a moat, pricing power, or whether a business can defend its returns.', ['List the sources of advantage: brand, network effects, switching costs, cost advantages, regulation.', 'Check returns on capital over 5-10 years; a moat shows up as returns that stay above the cost of capital.', 'Name what could erode it and how fast.', 'Rate the moat none / narrow / wide and say why in one sentence.']],
    ['earnings-lab/earnings-skills', 'earnings-preview', 6900, 'Prepare for an upcoming earnings release: consensus, what matters, and scenarios. Use before a company reports.', ['Find the report date and consensus revenue and EPS.', 'Pick the two or three numbers the market will react to.', 'Write bull, base and bear reactions and what each would change.']],
    ['value-lab/investing-skills', 'dcf-valuation', 6420, 'Rough discounted cash flow valuation with explicit assumptions. Use when the user asks what a stock is worth.', ['State free cash flow, growth for 5 years, terminal growth and discount rate.', 'Show the value per share and a sensitivity table for growth and discount rate.', 'Compare with the current price and call out the assumption that matters most.']],
    ['macro-desk/macro-skills', 'macro-regime', 5560, 'Classify the current macro regime (growth and inflation rising or falling) and what tends to work in it.', ['Look at the growth and inflation trend.', 'Name the regime and the asset classes that historically did well in it.', 'Compare with the user\'s allocation.']],
    ['earnings-lab/earnings-skills', 'earnings-recap', 5300, 'Summarize a released earnings report against expectations. Use right after a company reports.', ['Actual vs consensus for revenue, margins and EPS.', 'Guidance change and management tone.', 'What it means for the thesis.']],
    ['quant-notes/trading-skills', 'position-sizer', 5120, 'Size a position from account risk and a stop level. Use when the user asks how much to buy.', ['Risk per trade as a share of the account (default 1%).', 'Distance from entry to stop.', 'Shares = risk amount / distance; check the resulting weight.']],
    ['dividend-garden/dividend-skills', 'dividend-safety', 4870, 'Check whether a dividend is safe: payout ratio, cash coverage, debt and history.', ['Payout ratio on earnings and on free cash flow.', 'Net debt and interest coverage.', 'Years of growth and any past cuts; rate safe / watch / at risk.']],
    ['sage-lens/investing-lens', 'buffett-letters', 4400, 'Read a stock or portfolio through ideas from Berkshire Hathaway shareholder letters.', ['Circle of competence, durable advantage, honest management, sensible price.', 'Say which idea the holding fits and which it breaks.']],
    ['macro-desk/macro-skills', 'sector-rotation', 4010, 'Where in the business cycle we are and which sectors usually lead there.', ['Place the cycle phase.', 'List leading and lagging sectors.', 'Compare with the user\'s sector weights.']],
    ['portfolio-kit/portfolio-skills', 'rebalance-plan', 3900, 'Turn target weights into a concrete rebalancing plan with the fewest trades.', ['Current vs target weight per holding.', 'Use new cash first, then trims of the most overweight.', 'List the trades and the weights after.']],
    ['trading-journal-kit/trading-journal-skills', 'trade-postmortem', 3600, 'Post-mortem of a closed trade: plan vs what happened, and one lesson.', ['Entry reason, planned target and stop.', 'What actually happened and why.', 'One rule to keep or change.']],
    ['dividend-garden/dividend-skills', 'etf-overlap-check', 3330, 'Find overlap between ETFs and stocks the user holds.', ['Top holdings of each ETF.', 'Combined exposure to the largest names.', 'Flag hidden concentration.']],
    ['sage-lens/investing-lens', 'lynch-categories', 3150, 'Sort holdings into Peter Lynch\'s six categories and check each against its playbook.', ['Slow grower, stalwart, fast grower, cyclical, turnaround, asset play.', 'What to watch for each category.']],
    ['quant-notes/trading-skills', 'backtest-review', 7340, 'Review a backtest for overfitting and unrealistic assumptions before trusting it.', ['Sample size and period.', 'Costs, slippage and look-ahead bias.', 'Out-of-sample result.']],
    ['quant-notes/trading-skills', 'momentum-screener', 3010, 'Screen for stocks in strong uptrends near highs.', ['Price above rising 50 and 200 day averages.', 'Within 15% of the 52-week high.', 'Relative strength vs the index.']],
    ['macro-desk/macro-skills', 'economic-calendar', 2900, 'This week\'s economic releases and central bank events that could move markets.', ['List the events with dates.', 'Which holdings are sensitive to each.']],
    ['kr-market/kr-stock-skills', 'korean-stock-filings', 2750, 'Read Korean DART filings (사업보고서, 분기보고서, 주요사항보고서) for a listed company.', ['Find the latest periodic report.', 'Segment revenue, margins, related-party deals.', 'Recent material event reports.']],
    ['portfolio-kit/portfolio-skills', 'risk-budget', 2600, 'Look at how much of the portfolio\'s risk each holding contributes, not just its weight.', ['Volatility and correlation of the main holdings.', 'Risk share vs weight share.', 'Where to cut if risk is concentrated.']],
    ['trading-journal-kit/trading-journal-skills', 'bias-check', 2450, 'Spot behavioral biases in recent trades: loss aversion, chasing, anchoring.', ['Holding time of winners vs losers.', 'Buys after big up days.', 'One habit to change.']],
    ['value-lab/investing-skills', 'owner-earnings', 2310, 'Owner earnings: cash a business can return to owners after maintenance capex.', ['Net income plus depreciation minus maintenance capex.', 'Compare with reported earnings over years.']],
    ['quant-notes/trading-skills', 'drawdown-guard', 2200, 'Rules for cutting risk after a portfolio drawdown.', ['Current drawdown from peak.', 'Pre-set steps to reduce exposure.']],
    ['portfolio-kit/portfolio-skills', 'concentration-check', 2100, 'Flag single-stock, sector and currency concentration.', ['Top 5 weight, largest sector, currency split.', 'Compare with the user\'s limits.']],
    ['value-lab/investing-skills', 'margin-of-safety', 1980, 'How far below estimated value the price is, and whether that is enough.', ['Value range, not a point.', 'Discount needed given uncertainty.']],
    ['earnings-lab/earnings-skills', 'guidance-tracker', 1700, 'Track how management guidance changed quarter by quarter.', ['Guidance history.', 'Beat/miss pattern vs own guidance.']],
    ['kr-market/kr-stock-skills', 'kospi-sector-map', 1600, 'Map KOSPI and KOSDAQ holdings to sectors and themes.', ['Sector of each holding.', 'Theme overlap.']],
  ];

  const title = (s) => s.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  const skillMd = ([, skill, , description, steps]) =>
    `---\nname: ${skill}\ndescription: ${JSON.stringify(description)}\nlicense: MIT\n---\n\n# ${title(skill)}\n\n${description}\n\n## Steps\n\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n## Output\n\nA short table with the key numbers, then a one-paragraph verdict. Say which inputs were assumed.\n`;
  // One skill ships a data script and a reference file, like many real ones
  const EXTRA = { 'dcf-valuation': ['references/assumptions.md', 'scripts/fetch_financials.py'] };

  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
  const text = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async function skillsDemoFetch(input, init) {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let url;
    try {
      url = new URL(raw);
    } catch {
      return prevFetch(input, init);
    }
    if (url.hostname === 'skills.sh' && url.pathname === '/api/search') {
      const skills = SKILLS.map(([source, skill, installs]) => ({ id: `${source}/${skill}`, source, skillId: skill, name: skill, installs }));
      return json({ query: url.searchParams.get('q'), searchType: 'fuzzy', skills, count: skills.length });
    }
    const tree = url.hostname === 'api.github.com' && url.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/git\/trees\/HEAD$/);
    if (tree) {
      const mine = SKILLS.filter((s) => s[0] === tree[1]);
      if (!mine.length) return json({ message: 'Not Found' }, 404);
      const paths = ['README.md', ...mine.flatMap((s) => [`skills/${s[1]}/SKILL.md`, ...(EXTRA[s[1]] ?? []).map((p) => `skills/${s[1]}/${p}`)])];
      return json({ sha: 'demo', truncated: false, tree: paths.map((path) => ({ path, type: 'blob' })) });
    }
    const file = url.hostname === 'raw.githubusercontent.com' && decodeURIComponent(url.pathname).match(/^\/([^/]+\/[^/]+)\/HEAD\/skills\/([^/]+)\/(.+)$/);
    if (file) {
      const s = SKILLS.find((x) => x[0] === file[1] && x[1] === file[2]);
      if (!s) return new Response('404: Not Found', { status: 404 });
      if (file[3] === 'SKILL.md') return text(skillMd(s));
      return text(`# ${file[3]}\n\nDefault assumptions: discount rate 9%, terminal growth 2.5%, 5-year explicit forecast.\n`);
    }
    return prevFetch(input, init);
  };
}
