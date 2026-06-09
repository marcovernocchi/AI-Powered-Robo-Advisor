import { useState } from 'react'
import { AreaChart } from '@tremor/react'
import { runMonteCarlo, getPortfolio, getPortfolioById, getPortfolioList } from '../api/client'
import { useLang } from '../context/LangContext'

function fmt(value, decimals = 2) {
  if (value === null || value === undefined) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}%`
}

function fmtEur(value) {
  return value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
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

function MetricCard({ label, value, highlight, sub }) {
  const color =
    highlight === 'positive' ? 'text-emerald-500' :
    highlight === 'negative' ? 'text-red-500' :
    'text-gray-900 dark:text-gray-100'
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl p-4 space-y-1">
      <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

export default function MonteCarlo() {
  const { t, lang } = useLang()
  const mc = (key) => t(`monteCarlo.${key}`)
  const fmtCompact = makeCompactFormatter(lang)

  // --- Form state ---
  const [assets, setAssets] = useState([
    { ticker: 'VWCE.MI', weight: '60', overrideReturn: '', overrideVol: '' },
    { ticker: 'AGGH.MI', weight: '40', overrideReturn: '', overrideVol: '' },
  ])
  const [capital, setCapital] = useState('10000')
  const [horizonYears, setHorizonYears] = useState('20')
  const [nSimulations, setNSimulations] = useState('1000')
  const [monthlyContrib, setMonthlyContrib] = useState('0')
  const [targetValue, setTargetValue] = useState('')
  const [lookbackYears, setLookbackYears] = useState('5')
  // --- Return estimation ---
  const [shrinkageLambda, setShrinkageLambda] = useState('0.3')
  const [longRunReturn, setLongRunReturn] = useState('6')

  // --- Load from portfolio ---
  const [portfolioList, setPortfolioList] = useState(null)
  const [loadingPortfolio, setLoadingPortfolio] = useState(false)
  const [portfolioWarn, setPortfolioWarn] = useState(null)
  const [showPortfolioPicker, setShowPortfolioPicker] = useState(false)

  // --- Results state ---
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const totalWeight = assets.reduce((s, a) => s + (parseFloat(a.weight) || 0), 0)
  const weightsOk = Math.abs(totalWeight - 100) < 0.01

  function addAsset() {
    setAssets([...assets, { ticker: '', weight: '', overrideReturn: '', overrideVol: '' }])
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

      const byTicker = {}
      for (const h of holdings) {
        byTicker[h.ticker] = (byTicker[h.ticker] ?? 0) + h.value
      }
      const entries = Object.entries(byTicker)
      const rawTotal = entries.reduce((s, [, v]) => s + v, 0)
      if (rawTotal === 0) {
        setPortfolioWarn('Valore totale del portafoglio è zero.')
        return
      }
      let newAssets = entries.map(([ticker, value]) => ({
        ticker,
        weight: ((value / rawTotal) * 100).toFixed(2),
      }))
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
    const asset_overrides = {}
    for (const a of assets) {
      const ticker = a.ticker.trim().toUpperCase()
      if (!ticker) continue
      weights[ticker] = (parseFloat(a.weight) || 0) / 100
      const ov = {}
      if (a.overrideReturn.trim() !== '') ov.expected_return = parseFloat(a.overrideReturn) / 100
      if (a.overrideVol.trim() !== '') ov.expected_volatility = parseFloat(a.overrideVol) / 100
      if (Object.keys(ov).length > 0) asset_overrides[ticker] = ov
    }

    try {
      const data = await runMonteCarlo({
        weights,
        initial_capital: parseFloat(capital),
        horizon_years: parseInt(horizonYears, 10),
        n_simulations: parseInt(nSimulations, 10),
        monthly_contribution: parseFloat(monthlyContrib) || 0,
        target_value: targetValue.trim() ? parseFloat(targetValue) : null,
        lookback_years: parseInt(lookbackYears, 10),
        shrinkage_lambda: parseFloat(shrinkageLambda),
        long_run_return: parseFloat(longRunReturn) / 100,
        asset_overrides,
      })
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Build fan chart data from percentile series
  const chartData = result
    ? result.time_labels.map((label, i) => ({
        year: label,
        [mc('p95Label')]: Math.round(result.percentiles.p95[i]),
        [mc('p75Label')]: Math.round(result.percentiles.p75[i]),
        [mc('p50Label')]: Math.round(result.percentiles.p50[i]),
        [mc('p25Label')]: Math.round(result.percentiles.p25[i]),
        [mc('p5Label')]: Math.round(result.percentiles.p5[i]),
      }))
    : []

  const fanCategories = result
    ? [mc('p95Label'), mc('p75Label'), mc('p50Label'), mc('p25Label'), mc('p5Label')]
    : []
  const fanColors = ['emerald', 'teal', 'blue', 'indigo', 'violet']

  const probTarget = result?.prob_target
  const probPercent = probTarget !== null && probTarget !== undefined
    ? (probTarget * 100).toFixed(1)
    : null

  const inputClass = "w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100"
  const labelClass = "block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium"

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">{mc('title')}</h1>
        <p className="text-sm text-gray-400 mt-1">{mc('subtitle')}</p>
      </div>

      <div className="flex gap-6 items-start">
        {/* ── Left panel: form ── */}
        <div className="w-80 shrink-0 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Portfolio assets */}
            <div className="bg-white dark:bg-gray-900 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{mc('sectionPortfolio')}</p>
                <button
                  type="button"
                  onClick={handleOpenPortfolioPicker}
                  disabled={loadingPortfolio}
                  className="text-xs text-blue-500 hover:text-blue-600 font-medium disabled:opacity-50 transition-colors"
                >
                  {loadingPortfolio ? '…' : mc('loadMyPortfolio')}
                </button>
              </div>

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
                <div key={i} className="space-y-1">
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      placeholder={mc('ticker')}
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
                  {/* Per-asset manual overrides — aligned to ticker+weight+× row */}
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      placeholder={mc('overrideReturnPlaceholder')}
                      value={a.overrideReturn}
                      step="0.1"
                      onChange={(e) => updateAsset(i, 'overrideReturn', e.target.value)}
                      className="flex-1 px-2 py-1.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-right focus:outline-none focus:ring-1 focus:ring-amber-400 placeholder:text-gray-300 dark:placeholder:text-gray-600"
                      title={mc('overrideReturnTitle')}
                    />
                    <input
                      type="number"
                      placeholder={mc('overrideVolPlaceholder')}
                      value={a.overrideVol}
                      step="0.1"
                      min="0"
                      onChange={(e) => updateAsset(i, 'overrideVol', e.target.value)}
                      className="w-16 px-2 py-1.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-right focus:outline-none focus:ring-1 focus:ring-amber-400 placeholder:text-gray-300 dark:placeholder:text-gray-600"
                      title={mc('overrideVolTitle')}
                    />
                    {/* spacer to match × button width */}
                    {assets.length > 1 ? <span className="w-[18px] shrink-0" /> : null}
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={addAsset}
                  className="text-xs text-blue-500 hover:text-blue-600 font-medium"
                >
                  {mc('addAsset')}
                </button>
                <span className={`text-xs font-mono font-semibold ${weightsOk ? 'text-emerald-500' : 'text-red-500'}`}>
                  {totalWeight.toFixed(1)}%
                </span>
              </div>
              {!weightsOk && (
                <p className="text-xs text-red-500">{mc('weightsError')}</p>
              )}
            </div>

            {/* Simulation parameters */}
            <div className="bg-white dark:bg-gray-900 rounded-xl p-5 space-y-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{mc('sectionParams')}</p>

              <div>
                <label className={labelClass}>{mc('capital')}</label>
                <input type="number" value={capital} onChange={(e) => setCapital(e.target.value)} min="100" step="100" className={inputClass} required />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelClass}>{mc('horizonYears')}</label>
                  <input type="number" value={horizonYears} onChange={(e) => setHorizonYears(e.target.value)} min="1" max="50" step="1" className={inputClass} required />
                </div>
                <div>
                  <label className={labelClass}>{mc('nSimulations')}</label>
                  <input type="number" value={nSimulations} onChange={(e) => setNSimulations(e.target.value)} min="10" max="10000" step="100" className={inputClass} required />
                </div>
              </div>

              <div>
                <label className={labelClass}>{mc('monthlyContrib')}</label>
                <input type="number" value={monthlyContrib} onChange={(e) => setMonthlyContrib(e.target.value)} min="0" step="50" className={inputClass} />
              </div>

              <div>
                <label className={labelClass}>{mc('targetValue')}</label>
                <input
                  type="number"
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                  min="0"
                  step="1000"
                  placeholder={mc('targetValuePlaceholder')}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>{mc('lookbackYears')}</label>
                <input type="number" value={lookbackYears} onChange={(e) => setLookbackYears(e.target.value)} min="1" max="20" step="1" className={inputClass} />
              </div>

              {/* Shrinkage section */}
              <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{mc('sectionShrinkage')}</p>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={labelClass}>{mc('shrinkageLabel')}</label>
                    <span className="text-xs font-mono font-semibold text-gray-700 dark:text-gray-300">
                      λ = {parseFloat(shrinkageLambda).toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0" max="1" step="0.05"
                    value={shrinkageLambda}
                    onChange={(e) => setShrinkageLambda(e.target.value)}
                    className="w-full accent-gray-900 dark:accent-gray-100"
                  />
                  <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                    <span>{mc('shrinkageMin')}</span>
                    <span>{mc('shrinkageMax')}</span>
                  </div>
                </div>

                <div>
                  <label className={labelClass}>{mc('longRunReturn')}</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={longRunReturn}
                      onChange={(e) => setLongRunReturn(e.target.value)}
                      step="0.5"
                      min="-99"
                      className={inputClass + ' pr-7'}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !weightsOk}
              className="w-full py-2.5 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? mc('running') : mc('runBtn')}
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
              {mc('noResults')}
            </div>
          )}

          {loading && (
            <div className="bg-white dark:bg-gray-900 rounded-xl p-12 flex items-center justify-center gap-3 text-sm text-gray-400">
              <span className="animate-spin text-lg">⟳</span>
              {mc('running')}
            </div>
          )}

          {result && (
            <>
              {/* Warnings */}
              {result.warnings?.length > 0 && (
                <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4 space-y-1">
                  <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 uppercase tracking-wide">{mc('warnings')}</p>
                  {result.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-yellow-600 dark:text-yellow-400">{w}</p>
                  ))}
                </div>
              )}

              {/* Fan chart */}
              <div className="bg-white dark:bg-gray-900 rounded-xl p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-semibold text-sm">{mc('sectionChart')}</h2>
                    <p className="text-xs text-gray-400 mt-0.5">{mc('chartSubtitle')}</p>
                  </div>
                </div>
                <AreaChart
                  className="h-72 [&_.recharts-cartesian-axis-tick_text]:dark:fill-white [&_.recharts-cartesian-axis-tick_text]:text-xs"
                  data={chartData}
                  index="year"
                  categories={fanCategories}
                  colors={fanColors}
                  valueFormatter={fmtCompact}
                  showLegend
                  showXAxis
                  showYAxis
                  yAxisWidth={64}
                  curveType="monotone"
                  opacity={0.6}
                />
              </div>

              {/* Summary metrics */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricCard
                  label={mc('medianFinal')}
                  value={fmtEur(result.median_final)}
                  highlight={result.median_final >= parseFloat(capital) ? 'positive' : 'negative'}
                />
                <MetricCard
                  label={mc('meanFinal')}
                  value={fmtEur(result.mean_final)}
                />
                <MetricCard
                  label={mc('p5Final')}
                  value={fmtEur(result.percentiles.p5[result.percentiles.p5.length - 1])}
                  highlight="negative"
                />
                <MetricCard
                  label={mc('p95Final')}
                  value={fmtEur(result.percentiles.p95[result.percentiles.p95.length - 1])}
                  highlight="positive"
                />
              </div>

              {/* Probability of reaching target — prominent card */}
              {probPercent !== null && (
                <div className="bg-white dark:bg-gray-900 rounded-xl p-5 flex items-center gap-5">
                  <div
                    className={`text-4xl font-extrabold ${
                      parseFloat(probPercent) >= 70 ? 'text-emerald-500' :
                      parseFloat(probPercent) >= 40 ? 'text-amber-500' :
                      'text-red-500'
                    }`}
                  >
                    {probPercent}%
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{mc('probTargetLabel')}</p>
                    <p className="text-xs text-gray-400">
                      {mc('probTargetSub')} {fmtEur(parseFloat(targetValue))}
                    </p>
                  </div>
                </div>
              )}

              {/* Per-asset estimation stats */}
              <div className="bg-white dark:bg-gray-900 rounded-xl p-5 space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{mc('sectionEstimates')}</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800 text-xs text-gray-400 uppercase tracking-wide">
                      <th className="text-left pb-2 font-medium">{mc('asset')}</th>
                      <th className="text-right pb-2 font-medium">{mc('annReturn')}</th>
                      <th className="text-right pb-2 font-medium">{mc('annVol')}</th>
                      <th className="text-right pb-2 font-medium">{mc('source')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(result.annualized_returns).map((ticker) => {
                      const src = result.return_sources?.[ticker] ?? 'historical'
                      const srcLabel = src === 'manual'
                        ? { text: mc('sourceManual'), cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' }
                        : src === 'shrinkage'
                        ? { text: mc('sourceShrinkage'), cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' }
                        : { text: mc('sourceHistorical'), cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' }
                      return (
                        <tr key={ticker} className="border-b border-gray-50 dark:border-gray-800 last:border-0">
                          <td className="py-2 font-mono font-semibold">{ticker}</td>
                          <td className={`py-2 text-right font-semibold ${result.annualized_returns[ticker] >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {fmt(result.annualized_returns[ticker])}
                          </td>
                          <td className="py-2 text-right text-gray-500">
                            {fmt(result.annualized_volatilities[ticker])}
                          </td>
                          <td className="py-2 text-right">
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${srcLabel.cls}`}>
                              {srcLabel.text}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <p className="text-xs text-gray-400 italic">{mc('oasNote')}</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
