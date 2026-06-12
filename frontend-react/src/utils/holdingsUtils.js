/**
 * Groups holdings by ticker, computing weighted-average buy price and summed shares/value.
 * Each aggregated row carries an `ids` array of the underlying holding IDs.
 */
export function aggregateHoldings(holdings) {
  const map = {}
  for (const h of holdings) {
    const shares = h.shares ?? 0
    const price  = h.avg_buy_price ?? 0
    if (!map[h.ticker]) {
      map[h.ticker] = {
        ...h,
        ids: [h.id],
        _totalCost: shares * price,
      }
    } else {
      const agg = map[h.ticker]
      agg.ids.push(h.id)
      agg._totalCost += shares * price
      agg.shares      = (agg.shares ?? 0) + shares
      agg.value       = (agg.value  ?? 0) + (h.value ?? 0)
      if (h.price_stale) agg.price_stale = true
    }
  }

  return Object.values(map).map(({ _totalCost, ...rest }) => {
    const avg_buy_price = rest.shares > 0 ? _totalCost / rest.shares : (rest.avg_buy_price ?? 0)
    const pnl_pct =
      avg_buy_price > 0 && rest.current_price != null
        ? (rest.current_price - avg_buy_price) / avg_buy_price * 100
        : 0
    return {
      ...rest,
      avg_buy_price: Math.round(avg_buy_price * 10000) / 10000,
      pnl_pct:       Math.round(pnl_pct       * 100)   / 100,
      value:         Math.round((rest.value ?? 0) * 100) / 100,
    }
  })
}
