/**
 * 빗썸 Open API 2.0 (https://apidocs.bithumb.com). Same resource shapes as
 * Upbit; differences: HS256 JWT with a timestamp claim, order history at
 * /v2/orders/history (with executed funds, no per-order lookup needed), and
 * separate KRW deposit/withdrawal lists.
 */
import { Dec } from '@/domain/decimal';
import { coinOf, num } from '@/domain/broker-format';
import type { ExchangeEvent } from '@/domain/exchange-replay';
import { rows, str } from './http';
import { jwt, nonce, sha512Hex } from './sign';
import type { BrokerId } from './types';
import { UpbitAdapter } from './upbit';

const DAY = 86_400_000;

export class BithumbAdapter extends UpbitAdapter {
  override readonly broker: BrokerId = 'BITHUMB';
  protected override base = 'https://api.bithumb.com';
  protected override label = '빗썸';

  protected override token(query: string): string {
    const payload: Record<string, unknown> = { access_key: this.cfg.appKey, nonce: nonce(), timestamp: Date.now() };
    if (query) Object.assign(payload, { query_hash: sha512Hex(query), query_hash_alg: 'SHA512' });
    return jwt(payload, this.cfg.secret, 'HS256');
  }

  /** Bithumb takes `to` in KST ("yyyy-MM-dd HH:mm:ss"). */
  protected override pageTo(c: Record<string, unknown>): string {
    return str(c.candle_date_time_kst).replace('T', ' ');
  }

  /** No all-market ticker endpoint: ask for the KRW markets in batches. */
  protected override async allKrwTickers(): Promise<Record<string, unknown>[]> {
    const markets = [...(await this.names()).keys()];
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < markets.length; i += 50) out.push(...rows(await this.request('/v1/ticker', [['markets', markets.slice(i, i + 50).join(',')]], false)));
    return out;
  }

  protected override async orderEvents(since: Date, until: Date): Promise<ExchangeEvent[]> {
    const events: ExchangeEvent[] = [];
    for (let start = since.getTime(); start < until.getTime(); start += 7 * DAY) {
      const end = Math.min(start + 7 * DAY, until.getTime());
      let nextKey = '';
      for (let guard = 0; guard < 50; guard++) {
        const params: [string, string][] = [
          ['start_time', String(start)],
          ['end_time', String(end)],
          ['limit', '1000'],
          ['order_by', 'asc'],
        ];
        if (nextKey) params.push(['next_key', nextKey]);
        const body = (await this.request('/orders/history', params, true, 'https://api.bithumb.com/v2')) as Record<string, unknown>;
        for (const o of rows(body.data)) {
          const qty = Dec.of(num(o.executed_volume));
          if (!str(o.market).startsWith('KRW-') || !qty.isPos()) continue;
          events.push({
            id: str(o.order_id),
            kind: str(o.side) === 'bid' ? 'BUY' : 'SELL',
            at: new Date(str(o.created_at)).toISOString(),
            currency: coinOf(str(o.market)),
            qty: qty.toString(),
            price: Dec.of(num(o.executed_funds)).div(qty).round(8).toString(),
            fee: num(o.paid_fee),
          });
        }
        nextKey = body.has_next ? str(body.next_key) : '';
        if (!nextKey) break;
      }
    }
    return events;
  }

  protected override async transferEvents(kind: 'DEPOSIT' | 'WITHDRAW', since: Date, until: Date): Promise<ExchangeEvent[]> {
    const lists =
      kind === 'DEPOSIT'
        ? [
            { path: '/v1/deposits', done: 'DEPOSIT_ACCEPTED' },
            { path: '/v1/deposits/krw', done: 'ACCEPTED' },
          ]
        : [
            { path: '/v1/withdraws', done: 'DONE' },
            { path: '/v1/withdraws/krw', done: 'DONE' },
          ];
    const events: ExchangeEvent[] = [];
    for (const { path, done } of lists) {
      for (let page = 1; page <= 100; page++) {
        const list = rows(await this.request(path, [['limit', '100'], ['page', String(page)], ['order_by', 'desc']]));
        let older = false;
        for (const t of list) {
          const at = new Date(str(t.done_at) || str(t.created_at));
          if (at < since) {
            older = true;
            continue;
          }
          if (at >= until || str(t.state).toUpperCase() !== done) continue;
          events.push({ id: str(t.uuid), kind, at: at.toISOString(), currency: (str(t.currency) || 'KRW').toUpperCase(), qty: num(t.amount), price: null, fee: num(t.fee) });
        }
        if (older || list.length < 100) break;
      }
    }
    return events;
  }
}
