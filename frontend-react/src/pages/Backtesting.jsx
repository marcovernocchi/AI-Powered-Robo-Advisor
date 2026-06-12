import { useState } from 'react'
import { AreaChart, LineChart } from '@tremor/react'
import { runBacktest, getPortfolio, getPortfolioById, getPortfolioList } from '../api/client'
import { useLang } from '../context/LangContext'
import NumberInput from '../components/NumberInput'

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

function makeCompactFormatter(lang) {
  const bln = lang === 'it' ? 'MLD' : 'BLN'
  return (v) => {
    const abs = Math.abs(v)
    if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}${bln}€`
    if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}MLN€`
    if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K€`
    return `${v.toFixed(0)}€`
  }
}

const SERIES_COLORS = {
  Portfolio: { dot: '#10b981', text: 'text-emerald-500' },
  Benchmark: { dot: '#3b82f6', text: 'text-blue-500' },
}

function BacktestTooltip({ payload, active, label }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div
      className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg px-3 py-2.5 min-w-[160px]"
      style={{ pointerEvents: 'none' }}
    >
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 border-b border-gray-100 dark:border-gray-800 pb-1">
        {label}
      </p>
      {payload.map((entry) => {
        const cfg = SERIES_COLORS[entry.name] ?? {}
        return (
          <div key={entry.name} className="flex items-center justify-between gap-4 py-0.5">
            <span className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                style={{ backgroundColor: cfg.dot ?? entry.color }}
              />
              {entry.name}
            </span>
            <span className={`text-xs font-semibold tabular-nums ${cfg.text ?? ''}`}>
              {typeof entry.value === 'number'
                ? entry.value >= 1000
                  ? `${(entry.value / 1000).toFixed(2)}K€`
                  : `${entry.value.toFixed(0)}€`
                : entry.value}
            </span>
          </div>
        )
      })}
    </div>
  )
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
  const { t, lang } = useLang()
  const bt = (key) => t(`backtesting.${key}`)
  const fmtCompact = makeCompactFormatter(lang)

  // --- Form state ---
  const [assets, setAssets] = useState([{ ticker: '', weight: '' }])
  const [capital, setCapital] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [rebalance, setRebalance] = useState('annual')
  const [driftThreshold, setDriftThreshold] = useState('')
  const [txCost, setTxCost] = useState('')
  const [ter, setTer] = useState('')
  const [spread, setSpread] = useState('')
  const [benchmark, setBenchmark] = useState('')

  // --- Load from portfolio ---
  const [portfolioList, setPortfolioList] = useState(null)  // null = not fetched yet
  const [loadingPortfolio, setLoadingPortfolio] = useState(false)
  const [portfolioWarn, setPortfolioWarn] = useState(null)
  const [showPortfolioPicker, setShowPortfolioPicker] = useState(false)

  // --- Results state ---
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const totalWeight = assets.reduce((s, a) => s + (parseFloat(a.weight) || 0), 0)
  const weightsOk = Math.abs(totalWeight - 100) < 0.01
  const hasAssetContent = assets.some((a) => a.ticker.trim() || a.weight !== '')
  const formValid =
    weightsOk &&
    assets.some((a) => a.ticker.trim()) &&
    parseFloat(capital) > 0 &&
    startDate &&
    endDate

  function addAsset() {
    setAssets([...assets, { ticker: '', weight: '' }])
  }

  function removeAsset(i) {
    setAssets(assets.filter((_, idx) => idx !== i))
  }

  function updateAsset(i, field, value) {
    setAssets(assets.map((a, idx) => idx === i ? { ...a, [field]: value } : a))
  }

  async function handleOpenPortfolioPicker() {
    setLoadingPortfolio(true)
    setPortfolioWarn(null)
    try {
      const list = await getPortfolioList()
      setPortfolioList(list)
      if (list.length === 1) {
        await applyPortfolio(list[0].id)
      } else if (list.length === 0) {
        setPortfolioWarn('Nessun portafoglio trovato.')
      } else {
        setShowPortfolioPicker(true)
      }
    } catch {
      setPortfolioWarn('Impossibile caricare i portafogli.')
    } finally {
      setLoadingPortfolio(false)
    }
  }

  async function applyPortfolio(portfolioId) {
    setShowPortfolioPicker(false)
    setPortfolioWarn(null)
    setLoadingPortfolio(true)
    try {
      const data = portfolioId === 'aggregated'
        ? await getPortfolio()
        : await getPortfolioById(portfolioId)

      const holdings = data.holdings ?? []
      if (holdings.length === 0) {
        setPortfolioWarn('Il portafoglio selezionato non ha posizioni.')
        return
      }
      const totalValue = data.total_value ?? holdings.reduce((s, h) => s + h.value, 0)
      if (totalValue === 0) {
        setPortfolioWarn('Valore totale del portafoglio è zero — impossibile calcolare i pesi.')
        return
      }

      // Aggrega più righe dello stesso ticker (es. acquisti multipli)
      const byTicker = {}
      for (const h of holdings) {
        byTicker[h.ticker] = (byTicker[h.ticker] ?? 0) + h.value
      }

      // Calcola e normalizza i pesi in modo che sommino esattamente a 100
      const entries = Object.entries(byTicker)
      const rawTotal = entries.reduce((s, [, v]) => s + v, 0)
      let newAssets = entries.map(([ticker, value]) => ({
        ticker,
        weight: ((value / rawTotal) * 100).toFixed(2),
      }))

      // Correggi l'errore di arrotondamento sull'ultimo elemento
      const sumSoFar = newAssets.slice(0, -1).reduce((s, a) => s + parseFloat(a.weight), 0)
      newAssets[newAssets.length - 1].weight = (100 - sumSoFar).toFixed(2)

      setAssets(newAssets)
    } catch {
      setPortfolioWarn('Errore nel caricamento del portafoglio.')
    } finally {
      setLoadingPortfolio(false)
    }
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
        drift_threshold: (parseFloat(driftThreshold) || 5) / 100,
        transaction_cost_bps: parseFloat(txCost) || 0,
        annual_ter_bps: parseFloat(ter) || 0,
        spread_bps: parseFloat(spread) || 0,
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
  const totalDays = result ? result.portfolio_series.length : 0
  const dateFmt = totalDays > 365 * 2
    ? (s) => { const d = new Date(s); return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) }
    : (s) => { const d = new Date(s); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) }

  const chartData = result
    ? result.portfolio_series.map((p) => ({
        date: dateFmt(p.date),
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
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{bt('sectionPortfolio')}</p>
                <button
                  type="button"
                  onClick={handleOpenPortfolioPicker}
                  disabled={loadingPortfolio}
                  className="text-xs text-blue-500 hover:text-blue-600 font-medium disabled:opacity-50 transition-colors"
                >
                  {loadingPortfolio ? '…' : bt('loadMyPortfolio')}
                </button>
              </div>

              {/* Portfolio picker dropdown */}
              {showPortfolioPicker && portfolioList && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden text-sm">
                  <button
                    type="button"
                    onClick={() => applyPortfolio('aggregated')}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-100 dark:border-gray-700 font-medium"
                  >
                    Tutti i portafogli (aggregato)
                  </button>
                  {portfolioList.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPortfolio(p.id)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-100 dark:border-gray-700 last:border-0"
                    >
                      {p.name}
                      <span className="ml-2 text-xs text-gray-400">{p.holdings_count} asset</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowPortfolioPicker(false)}
                    className="w-full text-left px-3 py-2 text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-xs"
                  >
                    Annulla
                  </button>
                </div>
              )}

              {portfolioWarn && (
                <p className="text-xs text-amber-600 dark:text-amber-400">{portfolioWarn}</p>
              )}

              {assets.map((a, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="text"
                    placeholder={bt('ticker')}
                    value={a.ticker}
                    onChange={(e) => updateAsset(i, 'ticker', e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 dark:focus:ring-gray-100 font-mono uppercase"
                  />
                  <NumberInput
                    placeholder="%"
                    value={a.weight}
                    min={0}
                    max={100}
                    step={0.1}
                    fallback={0}
                    onChange={(v) => updateAsset(i, 'weight', v)}
                    className="w-16 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-right focus:outline-none focus:ring-1 focus:ring-gray-900 dark:focus:ring-gray-100"
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
                {hasAssetContent && (
                  <span className={`text-xs font-mono font-semibold ${weightsOk ? 'text-emerald-500' : 'text-red-500'}`}>
                    {totalWeight.toFixed(1)}%
                  </span>
                )}
              </div>
              {hasAssetContent && !weightsOk && (
                <p className="text-xs text-red-500">{bt('weightsError')}</p>
              )}
            </div>

            {/* Parameters */}
            <div className="bg-white dark:bg-gray-900 rounded-xl p-5 space-y-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{bt('sectionParams')}</p>

              <div>
                <label className={labelClass}>{bt('capital')}</label>
                <NumberInput value={capital} onChange={setCapital} min={1} max={10000000} step={100} optional className={inputClass} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelClass}>{bt('startDate')}</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>{bt('endDate')}</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
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
                  <NumberInput value={driftThreshold} onChange={setDriftThreshold} min={0.1} max={50} step={0.1} optional placeholder="5" className={inputClass} />
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={labelClass}>Tx cost<br />(bps)</label>
                  <NumberInput value={txCost} onChange={setTxCost} min={0} max={500} step={1} optional placeholder="0" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Annual TER<br />(bps)</label>
                  <NumberInput value={ter} onChange={setTer} min={0} max={500} step={1} optional placeholder="0" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Spread<br />(bps)</label>
                  <NumberInput value={spread} onChange={setSpread} min={0} max={500} step={1} optional placeholder="0" className={inputClass} />
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
              disabled={loading || !formValid}
              className="w-full py-2.5 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? bt('running') : bt('runBtn')}
            </button>
            {!formValid && hasAssetContent && (
              <p className="text-xs text-center text-gray-400">{bt('formIncomplete')}</p>
            )}
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
                    className="h-64 [&_.recharts-cartesian-axis-tick_text]:dark:fill-white [&_.recharts-cartesian-axis-tick_text]:text-xs"
                    data={thinned}
                    index="date"
                    categories={chartCategories}
                    colors={chartColors}
                    valueFormatter={fmtCompact}
                    showLegend={chartCategories.length > 1}
                    showXAxis
                    showYAxis
                    yAxisWidth={58}
                    curveType="linear"
                    customTooltip={BacktestTooltip}
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

              {/* Rolling metrics charts */}
              {(m.rolling_sharpe?.length > 0 || m.rolling_volatility?.length > 0) && (
                <div className="bg-white dark:bg-gray-900 rounded-xl p-5 space-y-5">
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{bt('sectionRolling')}</p>

                  {m.rolling_sharpe?.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{bt('rollingSharpeLabel')}</p>
                      <LineChart
                        className="h-40 [&_.recharts-cartesian-axis-tick_text]:dark:fill-white [&_.recharts-cartesian-axis-tick_text]:text-xs"
                        data={m.rolling_sharpe.map((p) => ({ date: p.date, [bt('rollingSharpeLabel')]: p.value }))}
                        index="date"
                        categories={[bt('rollingSharpeLabel')]}
                        colors={['blue']}
                        showLegend={false}
                        showXAxis
                        showYAxis
                        yAxisWidth={44}
                        curveType="monotone"
                        valueFormatter={(v) => v.toFixed(2)}
                      />
                    </div>
                  )}

                  {m.rolling_volatility?.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{bt('rollingVolLabel')}</p>
                      <LineChart
                        className="h-40 [&_.recharts-cartesian-axis-tick_text]:dark:fill-white [&_.recharts-cartesian-axis-tick_text]:text-xs"
                        data={m.rolling_volatility.map((p) => ({ date: p.date, [bt('rollingVolLabel')]: p.value }))}
                        index="date"
                        categories={[bt('rollingVolLabel')]}
                        colors={['violet']}
                        showLegend={false}
                        showXAxis
                        showYAxis
                        yAxisWidth={44}
                        curveType="monotone"
                        valueFormatter={(v) => `${v.toFixed(1)}%`}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* VaR / CVaR */}
              {(m.var_95_pct !== null && m.var_95_pct !== undefined) && (
                <div className="bg-white dark:bg-gray-900 rounded-xl p-5 space-y-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{bt('sectionRisk')}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <MetricCard
                      label={bt('var95')}
                      value={`-${m.var_95_pct.toFixed(2)}%`}
                      highlight="negative"
                    />
                    <MetricCard
                      label={bt('cvar95')}
                      value={`-${m.cvar_95_pct.toFixed(2)}%`}
                      highlight="negative"
                    />
                  </div>
                  <p className="text-xs text-gray-400 italic">{bt('varNote')}</p>
                </div>
              )}

              {/* Monthly returns heatmap */}
              {m.monthly_returns?.length > 0 && (() => {
                const months = bt('months')
                const years = [...new Set(m.monthly_returns.map((r) => r.year))].sort()
                const byYearMonth = {}
                for (const r of m.monthly_returns) {
                  byYearMonth[`${r.year}-${r.month}`] = r.return_pct
                }
                const maxAbs = Math.min(
                  10,
                  Math.max(...m.monthly_returns.map((r) => Math.abs(r.return_pct)))
                )
                function cellColor(v) {
                  if (v === undefined || v === null) return 'bg-gray-50 dark:bg-gray-800'
                  const intensity = Math.min(1, Math.abs(v) / maxAbs)
                  if (v >= 0) {
                    if (intensity > 0.66) return 'bg-emerald-500 text-white'
                    if (intensity > 0.33) return 'bg-emerald-300 dark:bg-emerald-700'
                    return 'bg-emerald-100 dark:bg-emerald-900/40'
                  } else {
                    if (intensity > 0.66) return 'bg-red-500 text-white'
                    if (intensity > 0.33) return 'bg-red-300 dark:bg-red-700'
                    return 'bg-red-100 dark:bg-red-900/40'
                  }
                }
                return (
                  <div className="bg-white dark:bg-gray-900 rounded-xl p-5 space-y-3 overflow-x-auto">
                    <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{bt('sectionHeatmap')}</p>
                    <table className="text-xs w-full min-w-[520px]">
                      <thead>
                        <tr>
                          <th className="text-left pr-2 pb-1 font-medium text-gray-400 w-10">{bt('year')}</th>
                          {months.map((mo) => (
                            <th key={mo} className="text-center pb-1 font-medium text-gray-400 w-10">{mo}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {years.map((yr) => (
                          <tr key={yr}>
                            <td className="pr-2 py-0.5 font-semibold text-gray-600 dark:text-gray-300">{yr}</td>
                            {Array.from({ length: 12 }, (_, i) => i + 1).map((mo) => {
                              const val = byYearMonth[`${yr}-${mo}`]
                              return (
                                <td key={mo} className={`text-center py-0.5 rounded ${cellColor(val)}`}>
                                  {val !== undefined ? `${val > 0 ? '+' : ''}${val.toFixed(1)}` : ''}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
