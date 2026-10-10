/**
 * Replays the phone's trades into holdings, lots, cash, realized profit and income, with the
 * web app's lot engine (src/domain/lots). Pure: give it the rows and today's USD rate.
 * Follows the server's rules (src/server/services/trading.ts): a buy without the portfolio's
 * cash is money brought in from outside, a liability counts against the total.
 */
import { Dec } from '@/domain/decimal';
import { applyPicks, applySplit, averageCost, lotUnitCost, planSale, realize, totalQty, type Lot } from '@/domain/lots';
import type { Asset, Portfolio, Txn } from './types';

export interface HoldingView {
  portfolioId: string;
  asset: Asset;
  qty: Dec;
  lots: Lot[];
  /** Average cost per unit in the asset's currency, fees included */
  avgCost: Dec;
  /** What the open lots cost, in KRW at each lot's rate */
  costKrw: Dec;
  /** Unit price used for the value, and where it came from */
  price: Dec | null;
  priceFrom: 'market' | 'valuation' | 'cost';
  /** Signed: a liability is negative */
  valueKrw: Dec;
  pnlKrw: Dec;
}

export interface RealizedRow {
  txnId: string;
  date: string;
  portfolioId: string;
  asset: Asset;
  qty: Dec;
  proceeds: Dec;
  cost: Dec;
  pnl: Dec;
  pnlKrw: Dec;
}

export interface IncomeRow {
  txnId: string;
  date: string;
  portfolioId: string;
  asset: Asset | null;
  type: 'DIVIDEND' | 'INTEREST';
  amount: Dec;
  currency: string;
  amountKrw: Dec;
}

export interface PortfolioView {
  portfolio: Portfolio;
  holdings: HoldingView[];
  cash: Map<string, Dec>;
  cashKrw: Dec;
  valueKrw: Dec;
  /** Money brought in from outside, net, in KRW */
  investedKrw: Dec;
  realized: RealizedRow[];
  income: IncomeRow[];
  problems: { txnId: string; message: string }[];
}

export interface BookView {
  portfolios: PortfolioView[];
  holdings: HoldingView[];
  valueKrw: Dec;
  cashKrw: Dec;
  investedKrw: Dec;
  /** Assets minus liabilities is valueKrw; these split it */
  assetsKrw: Dec;
  liabilitiesKrw: Dec;
  realized: RealizedRow[];
  income: IncomeRow[];
  problems: { txnId: string; message: string }[];
}

const sign = (a: Asset) => (a.type === 'LIABILITY' ? -1 : 1);
const rateOf = (t: Txn) => (t.currency === 'KRW' ? Dec.ONE : Dec.of(t.fxRate ?? '0'));

/** Trades in replay order: by time, then by when they were entered. */
export const sortTxns = (txns: Txn[]) => [...txns].sort((a, b) => (a.tradeAt < b.tradeAt ? -1 : a.tradeAt > b.tradeAt ? 1 : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));

export function replayPortfolio(portfolio: Portfolio, txns: Txn[], assets: Map<string, Asset>, usdKrw: Dec): PortfolioView {
  const lots = new Map<string, Lot[]>();
  const cash = new Map<string, Dec>();
  const lastValuation = new Map<string, Dec>();
  const realized: RealizedRow[] = [];
  const income: IncomeRow[] = [];
  const problems: { txnId: string; message: string }[] = [];
  let invested = Dec.ZERO;
  const addCash = (ccy: string, d: Dec) => cash.set(ccy, (cash.get(ccy) ?? Dec.ZERO).add(d));

  for (const t of sortTxns(txns.filter((x) => x.portfolioId === portfolio.id))) {
    const asset = t.assetId ? assets.get(t.assetId) : undefined;
    const fx = rateOf(t);
    try {
      switch (t.type) {
        case 'BUY': {
          if (!asset) throw new Error('자산이 없습니다.');
          const qty = Dec.of(t.qty ?? '0');
          const price = Dec.of(t.price ?? '0');
          const cost = price.mul(qty).add(t.fee || '0').add(t.tax || '0');
          const list = lots.get(asset.id) ?? [];
          list.push({ id: t.id, acquiredAt: t.tradeAt, qtyRemaining: qty, unitCost: lotUnitCost(price, qty, t.fee || '0', t.tax || '0'), fxRate: fx });
          lots.set(asset.id, list);
          if (t.useCash) addCash(t.currency, cost.neg());
          else invested = invested.add(cost.mul(fx).mul(sign(asset)));
          break;
        }
        case 'SELL': {
          if (!asset) throw new Error('자산이 없습니다.');
          const list = lots.get(asset.id) ?? [];
          const method = t.lotMethod && t.lotMethod !== 'SPECIFIC' ? t.lotMethod : portfolio.lotMethod === 'SPECIFIC' ? 'FIFO' : portfolio.lotMethod;
          const plan = planSale(list, t.qty ?? '0', method);
          if (!plan.ok) throw new Error(plan.message);
          const fees = Dec.of(t.fee || '0').add(t.tax || '0');
          const r = realize(list, plan.picks, { price: t.price ?? '0', fees, fxRate: fx, at: t.tradeAt });
          lots.set(asset.id, applyPicks(list, plan.picks).filter((l) => l.qtyRemaining.isPos()));
          realized.push({ txnId: t.id, date: t.tradeAt.slice(0, 10), portfolioId: portfolio.id, asset, qty: r.qty, proceeds: r.proceeds, cost: r.cost, pnl: r.pnl, pnlKrw: r.pnlBase.mul(sign(asset)) });
          if (t.useCash) addCash(t.currency, r.proceeds);
          else invested = invested.sub(r.proceeds.mul(fx).mul(sign(asset)));
          break;
        }
        case 'DEPOSIT':
          addCash(t.currency, Dec.of(t.amount ?? '0'));
          invested = invested.add(Dec.of(t.amount ?? '0').mul(fx));
          break;
        case 'WITHDRAW':
          addCash(t.currency, Dec.of(t.amount ?? '0').neg());
          invested = invested.sub(Dec.of(t.amount ?? '0').mul(fx));
          break;
        case 'DIVIDEND':
        case 'INTEREST': {
          const amount = Dec.of(t.amount ?? '0');
          addCash(t.currency, amount);
          income.push({ txnId: t.id, date: t.tradeAt.slice(0, 10), portfolioId: portfolio.id, asset: asset ?? null, type: t.type, amount, currency: t.currency, amountKrw: amount.mul(fx) });
          break;
        }
        case 'FEE':
        case 'TAX':
          addCash(t.currency, Dec.of(t.amount ?? '0').neg());
          break;
        case 'SPLIT':
          if (!asset) throw new Error('자산이 없습니다.');
          lots.set(asset.id, applySplit(lots.get(asset.id) ?? [], t.ratio ?? '1'));
          break;
        case 'VALUATION':
          if (!asset) throw new Error('자산이 없습니다.');
          lastValuation.set(asset.id, Dec.of(t.price ?? '0'));
          break;
        default:
          break;
      }
    } catch (e) {
      problems.push({ txnId: t.id, message: e instanceof Error ? e.message : String(e) });
    }
  }

  const holdings: HoldingView[] = [];
  for (const [assetId, list] of lots) {
    const asset = assets.get(assetId);
    if (!asset) continue;
    const qty = totalQty(list);
    if (!qty.isPos()) continue;
    const fxNow = asset.currency === 'KRW' ? Dec.ONE : usdKrw;
    const avgCost = averageCost(list);
    const market = asset.price ? Dec.of(asset.price) : null;
    const valuation = lastValuation.get(assetId) ?? null;
    // A price fetched after the last valuation wins; hand-valued assets use their valuation
    const price = market ?? valuation;
    const priceFrom: HoldingView['priceFrom'] = market ? 'market' : valuation ? 'valuation' : 'cost';
    const unit = price ?? avgCost;
    const s = sign(asset);
    const costKrw = Dec.sum(list.map((l) => l.qtyRemaining.mul(l.unitCost).mul(l.fxRate)));
    const valueKrw = qty.mul(unit).mul(fxNow).mul(s);
    holdings.push({ portfolioId: portfolio.id, asset, qty, lots: list, avgCost, costKrw, price, priceFrom, valueKrw, pnlKrw: valueKrw.sub(costKrw.mul(s)) });
  }
  holdings.sort((a, b) => b.valueKrw.abs().cmp(a.valueKrw.abs()));
  const cashKrw = Dec.sum([...cash].map(([ccy, v]) => v.mul(ccy === 'KRW' ? Dec.ONE : usdKrw)));
  const valueKrw = Dec.sum(holdings.map((h) => h.valueKrw)).add(cashKrw);
  return { portfolio, holdings, cash, cashKrw, valueKrw, investedKrw: invested, realized, income, problems };
}

export function replayBook(portfolios: Portfolio[], assets: Asset[], txns: Txn[], usdKrw: Dec): BookView {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const views = portfolios.filter((p) => !p.archived).map((p) => replayPortfolio(p, txns, byId, usdKrw));
  const holdings = views.flatMap((v) => v.holdings);
  const liabilities = Dec.sum(holdings.filter((h) => h.asset.type === 'LIABILITY').map((h) => h.valueKrw.neg()));
  const valueKrw = Dec.sum(views.map((v) => v.valueKrw));
  return {
    portfolios: views,
    holdings,
    valueKrw,
    cashKrw: Dec.sum(views.map((v) => v.cashKrw)),
    investedKrw: Dec.sum(views.map((v) => v.investedKrw)),
    assetsKrw: valueKrw.add(liabilities),
    liabilitiesKrw: liabilities,
    realized: views.flatMap((v) => v.realized),
    income: views.flatMap((v) => v.income),
    problems: views.flatMap((v) => v.problems),
  };
}

/** The same asset across portfolios, summed: what the 보유 자산 list shows. */
export function mergeByAsset(holdings: HoldingView[]) {
  const map = new Map<string, { asset: Asset; qty: Dec; valueKrw: Dec; costKrw: Dec; pnlKrw: Dec; price: Dec | null; portfolios: string[] }>();
  for (const h of holdings) {
    const m = map.get(h.asset.id);
    if (m) {
      m.qty = m.qty.add(h.qty);
      m.valueKrw = m.valueKrw.add(h.valueKrw);
      m.costKrw = m.costKrw.add(h.costKrw);
      m.pnlKrw = m.pnlKrw.add(h.pnlKrw);
      m.portfolios.push(h.portfolioId);
    } else map.set(h.asset.id, { asset: h.asset, qty: h.qty, valueKrw: h.valueKrw, costKrw: h.costKrw, pnlKrw: h.pnlKrw, price: h.price, portfolios: [h.portfolioId] });
  }
  return [...map.values()].sort((a, b) => b.valueKrw.abs().cmp(a.valueKrw.abs()));
}
