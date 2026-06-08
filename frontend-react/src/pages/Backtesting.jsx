import { useState } from 'react'
import { AreaChart } from '@tremor/react'
import { runBacktest } from '../api/client'
import { useLang } from '../context/LangContext'

const REBALANCE_OPTIONS = [
  { value: 'none', labelKey: 'rebalanceNone' },
  { value: 'monthly', labelKey: 'rebalanceMonthly' },
  { value: 'quarterly', labelKey: 'rebalanceQuarterly' },
  { value: 'annual', labelKey: 'rebalanceAnnual' },
  { value: 'drift', labelKey: 'rebalanceDrift' },
]

function fmt(value, suffix = '%') {
  if (value === null || value === undefined) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}${suffix}`
}

function fmtEur(value) {
  return value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
}

function MetricCard({ label, value, highlight }) {
  const color =
    highlight === 'positive' ? 'text-emerald-500' :
    highlight === 'negative' ? 'text-red-500' :
    'text-gray-900 dark:text-gray-100'
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl p-4 space-y-1">
      <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

export default function Backtesting() {
  const { t } = useLang()
  const bt = (key) => t(`backtesting.${key}`)

  // --- Form state ---
  const [assets, setAssets] = useState([
    { ticker: 'VWCE.MI', weight: '60' },
    { ticker: 'AGGH.MI', weight: '40' },
  ])
  const [capital, setCapital] = useState('10000')
  const [startDate, setStartDate] = useState('2018-01-01')
  const [endDate, setEndDate] = useState('2023-12-31')
  const [rebalance, setRebalance] = useState('annual')
  const [driftThreshold, setDriftThreshold] = useState('5')
  const [txCost, setTxCost] = useState('10')
  const [ter, setTer] = useState('20')
  const [spread, setSpread] = useState('2')
  const [benchmark, setBenchmark] = useState('SPY')

  // --- Results state ---
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const totalWeight = assets.reduce((s, a) => s + (parseFloat(a.weight) || 0), 0)
  const weightsOk = Math.abs(totalWeight - 100) < 0.01

  function addAsset() {
    setAssets([...assets, { ticker: '', weight: '' }])
  }

  function removeAsset(i) {
    setAssets(assets.filter((_, idx) => idx !== i))
  }

  function updateAsset(i, field, value) {
    setAssets(assets.map((a, idx) => idx === i ? { ...a, [field]: value } : a))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!weightsOk) return
    setLoading(true)
    setError(null)
    setResult(null)

    const weights = {}
    for (const a of assets) {
      if (a.ticker.trim()) weights[a.ticker.trim().toUpperCase()] = (parseFloat(a.weight) || 0) / 100
    }

    try {
      const data = await runBacktest({
        weights,
        initial_capital: parseFloat(capital),
        start_date: startDate,
        end_date: endDate,
        rebalance_frequency: rebalance,
        drift_threshold: parseFloat(driftThreshold) / 100,
        transaction_cost_bps: parseFloat(txCost),
        annual_ter_bps: parseFloat(ter),
        spread_bps: parseFloat(spread),
        benchmark_ticker: benchmark.trim() || null,
      })
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Build chart data from result
  const chartData = result
    ? result.portfolio_series.map((p) => ({
        date: p.date,
        [bt('portfolio')]: Math.round(p.portfolio_value * 100) / 100,
        ...(p.benchmark_value !== null ? { [bt('benchmarkLabel')]: Math.round(p.benchmark_value * 100) / 100 } : {}),
      }))
    : []

  const thinned = chartData.filter((_, i) => i % Math.max(1, Math.floor(chartData.length / 300)) === 0 || i === chartData.length - 1)

  const m = result?.metrics
  const bm = result?.benchmark_metrics
  const isUp = m ? m.total_return_pct >= 0 : true
  const chartCategories = result
    ? [bt('portfolio'), ...(result.benchmark_metrics ? [bt('benchmarkLabel')] : [])]
    : [bt('portfolio')]
  const chartColors = [isUp ? 'emerald' : 'red', 'blue']

  const inputClass = "w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100"
  const labelClass = "block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium"

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">{bt('title')}</h1>
        <p className="text-sm text-gray-400 mt-1">{bt('subtitle')}</p>
      </div>

      <div className="flex gap-6 items-start">
        {/* ── Left panel: form ── */}
        <div className="w-80 shrink-0 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Portfolio assets */}
            <div className="bg-white dark:bg-gray-900 rounded-xl p-5 space-y-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{bt('sectionPortfolio')}</p>

              {assets.map((a, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="text"
                    placeholder={bt('ticker')}
                    value={a.ticker}
                    onChange={(e) => updateAsset(i, 'ticker', e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 dark:focus:ring-gray-100 font-mono uppercase"
                    required
                  />
                  <input
                    type="number"
                    placeholder="%"
                    value={a.weight}
                    min="0"
                    max="100"
                    step="0.1"
                    onChange={(e) => updateAsset(i, 'weight', e.target.value)}
                    className="w-16 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-right focus:outline-none focus:ring-1 focus:ring-gray-900 dark:focus:ring-gray-100"
                    required
                  />
                  {assets.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeAsset(i)}
                      className="text-gray-300 dark:text-gray-600 hover:text-red-400 transition-colors text-lg leading-none"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}

              {/* Weight sum indicator */}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={addAsset}
                  className="text-xs text-blue-500 hover:text-blue-600 font-medium"
                >
                  {bt('addAsset')}
                </button>
                <span className={`text-xs font-mono font-semibold ${weightsOk ? 'text-emerald-500' : 'text-red-500'}`}>
                  {totalWeight.toFixed(1)}%
                </span>
              </div>
              {!weightsOk && (
                <p className="text-xs text-red-500">{bt('weightsError')}</p>
              )}
            </div>

            {/* Parameters */}
            <div className="bg-white dark:bg-gray-900 rounded-xl p-5 space-y-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{bt('sectionParams')}</p>

              <div>
                <label className={labelClass}>{bt('capital')}</label>
                <input type="number" value={capital} onChange={(e) => setCapital(e.target.value)} min="100" step="100" className={inputClass} required />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelClass}>{bt('startDate')}</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} required />
                </div>
                <div>
                  <label className={labelClass}>{bt('endDate')}</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} required />
                </div>
              </div>

              <div>
                <label className={labelClass}>{bt('rebalance')}</label>
                <select value={rebalance} onChange={(e) => setRebalance(e.target.value)} className={inputClass}>
                  {REBALANCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{bt(o.labelKey)}</option>
                  ))}
                </select>
              </div>

              {rebalance === 'drift' && (
                <div>
                  <label className={labelClass}>{bt('driftThreshold')}</label>
                  <input type="number" value={driftThreshold} onChange={(e) => setDriftThreshold(e.target.value)} min="0.1" max="50" step="0.1" className={inputClass} />
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={labelClass}>{bt('txCost')}</label>
                  <input type="number" value={txCost} onChange={(e) => setTxCost(e.target.value)} min="0" step="1" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>{bt('ter')}</label>
                  <input type="number" value={ter} onChange={(e) => setTer(e.target.value)} min="0" step="1" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>{bt('spread')}</label>
                  <input type="number" value={spread} onChange={(e) => setSpread(e.target.value)} min="0" step="1" className={inputClass} />
                </div>
              </div>

              <div>
                <label className={labelClass}>{bt('benchmark')}</label>
                <input
                  type="text"
                  value={benchmark}
                  onChange={(e) => setBenchmark(e.target.value)}
                  placeholder="SPY, IWDA.AS, …"
                  className={`${inputClass} font-mono uppercase`}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !weightsOk}
              className="w-full py-2.5 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? bt('running') : bt('runBtn')}
            </button>
          </form>
        </div>

        {/* ── Right panel: results ── */}
        <div className="flex-1 min-w-0 space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {!result && !loading && !error && (
            <div className="bg-white dark:bg-gray-900 rounded-xl p-12 text-center text-sm text-gray-400">
              {bt('noResults')}
            </div>
          )}

          {loading && (
            <div className="bg-white dark:bg-gray-900 rounded-xl p-12 flex items-center justify-center gap-3 text-sm text-gray-400">
              <span className="animate-spin text-lg">⟳</span>
              {bt('running')}
            </div>
          )}

          {result && (
            <>
              {/* Warnings */}
              {result.warnings?.length > 0 && (
                <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4 space-y-1">
                  <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 uppercase tracking-wide">{bt('warnings')}</p>
                  {result.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-yellow-600 dark:text-yellow-400">{w}</p>
                  ))}
                </div>
              )}

              {/* Chart */}
              <div className="bg-white dark:bg-gray-900 rounded-xl p-5 space-y-3">
                <h2 className="font-semibold text-sm">{bt('sectionResults')}</h2>
                {thinned.length > 1 && (
                  <AreaChart
                    className="h-64"
                    data={thinned}
                    index="date"
                    categories={chartCategories}
                    colors={chartColors}
                    valueFormatter={(v) => fmtEur(v)}
                    showLegend={chartCategories.length > 1}
                    showXAxis
                    showYAxis
                    yAxisWidth={80}
                    curveType="linear"
                  />
                )}
              </div>

              {/* Key metrics */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricCard label={bt('totalReturn')} value={fmt(m.total_return_pct)} highlight={m.total_return_pct >= 0 ? 'positive' : 'negative'} />
                <MetricCard label={bt('cagr')} value={fmt(m.cagr_pct)} highlight={m.cagr_pct >= 0 ? 'positive' : 'negative'} />
                <MetricCard label={bt('volatility')} value={fmt(m.annualized_volatility_pct)} />
                <MetricCard label={bt('maxDrawdown')} value={fmt(m.max_drawdown_pct)} highlight="negative" />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricCard label={bt('sharpe')} value={m.sharpe_ratio !== null ? m.sharpe_ratio.toFixed(2) : '—'} />
                <MetricCard label={bt('sortino')} value={m.sortino_ratio !== null ? m.sortino_ratio.toFixed(2) : '—'} />
                <MetricCard label={bt('maxDrawdownDuration')} value={`${m.max_drawdown_duration_days} ${bt('days')}`} />
                <MetricCard label={bt('rebalanceDates')} value={result.rebalance_dates.length} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <MetricCard label={bt('txCosts')} value={fmtEur(result.total_transaction_costs)} />
                <MetricCard label={bt('terCosts')} value={fmtEur(result.total_ter_costs)} />
              </div>

              {/* Benchmark comparison */}
              {bm && (
                <div className="bg-white dark:bg-gray-900 rounded-xl p-5 space-y-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{bt('benchmarkLabel')}</p>
                  <div className="grid grid-cols-3 gap-3">
                    <MetricCard label={bt('totalReturn')} value={fmt(bm.total_return_pct)} highlight={bm.total_return_pct >= 0 ? 'positive' : 'negative'} />
                    <MetricCard label={bt('cagr')} value={fmt(bm.cagr_pct)} highlight={bm.cagr_pct >= 0 ? 'positive' : 'negative'} />
                    <MetricCard label={bt('sharpe')} value={bm.sharpe_ratio !== null ? bm.sharpe_ratio.toFixed(2) : '—'} />
                  </div>
                </div>
              )}

              {/* Annual returns table */}
              {m.annual_returns?.length > 0 && (
                <div className="bg-white dark:bg-gray-900 rounded-xl p-5 space-y-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{bt('annualReturns')}</p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-800 text-xs text-gray-400 uppercase tracking-wide">
                        <th className="text-left pb-2 font-medium">{bt('year')}</th>
                        <th className="text-right pb-2 font-medium">{bt('portfolio')}</th>
                        {bm?.annual_returns?.length > 0 && (
                          <th className="text-right pb-2 font-medium">{bt('benchmarkLabel')}</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {m.annual_returns.map((row) => {
                        const bmRow = bm?.annual_returns?.find((r) => r.year === row.year)
                        return (
                          <tr key={row.year} className="border-b border-gray-50 dark:border-gray-800 last:border-0">
                            <td className="py-2 font-medium">{row.year}</td>
                            <td className={`py-2 text-right font-semibold ${row.return_pct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                              {fmt(row.return_pct)}
                            </td>
                            {bm?.annual_returns?.length > 0 && (
                              <td className={`py-2 text-right font-semibold ${bmRow && bmRow.return_pct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                {bmRow ? fmt(bmRow.return_pct) : '—'}
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
