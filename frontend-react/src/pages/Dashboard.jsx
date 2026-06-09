import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { AreaChart, Badge, ProgressBar } from '@tremor/react'
import { getPortfolio, getPortfolioById, getPortfolioList, createPortfolio, updatePortfolio, deletePortfolio } from '../api/client'
import AddTransactionModal from '../components/AddTransactionModal'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'

const PERIOD_OPTIONS = [
  { label: '1W',  api: '5d',  months: null, days: 7 },
  { label: '1M',  api: '1mo', months: 1,    days: null },
  { label: 'YTD', api: 'ytd', months: null, days: null },
  { label: '1Y',  api: '1y',  months: 12,   days: null },
  { label: '5Y',  api: '5y',  months: 60,   days: null },
  { label: 'MAX', api: 'max', months: null, days: null },
]

function thinData(data, opt) {
  if (!data.length) return data
  let step
  if (opt.days || (opt.months && opt.months <= 1)) step = 1
  else if (opt.label === 'YTD' || (opt.months && opt.months <= 12)) step = 7
  else if (opt.months && opt.months <= 60) step = 14
  else step = 30
  return data.filter((_, i) => i % step === 0 || i === data.length - 1)
}

function formatDate(dateStr, opt) {
  const d = new Date(dateStr)
  if (opt.days || opt.label === 'YTD' || (opt.months && opt.months <= 12)) {
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
}

function riskLabel(score) {
  if (score <= 26) return 'Low (Defensive)'
  if (score <= 42) return 'Medium (Conservative)'
  if (score <= 56) return 'Medium-High (Balanced)'
  return 'High (Aggressive)'
}

function riskColor(score) {
  if (score <= 26) return 'emerald'
  if (score <= 42) return 'yellow'
  if (score <= 56) return 'orange'
  return 'red'
}

import { getMarketHistory, getDividends } from '../api/client'

async function buildChartData(holdings, period) {
  if (!holdings?.length) return []

  const [histories, dividendData] = await Promise.all([
    Promise.all(
      holdings.map((h) =>
        getMarketHistory(h.ticker, period.api)
          .then((r) => ({
            shares: h.shares,
            value: h.value,
            purchaseDate: h.purchase_date ?? null,
            data: r.data,
          }))
          .catch(() => ({
            shares: h.shares,
            value: h.value,
            purchaseDate: h.purchase_date ?? null,
            data: [],
          }))
      )
    ),
    Promise.all(
      holdings.map((h) =>
        getDividends(h.ticker, h.purchase_date)
          .then((r) => ({ shares: h.shares, purchaseDate: h.purchase_date, dividends: r.dividends }))
          .catch(() => ({ shares: h.shares, purchaseDate: h.purchase_date, dividends: [] }))
      )
    ),
  ])

  // Initialize all dates in the period to 0
  const byDate = {}
  histories.forEach(({ data: rows }) => {
    rows.forEach((row) => {
      const date = row.Date?.split('T')[0] ?? row.Datetime?.split('T')[0]
      if (date && byDate[date] === undefined) byDate[date] = 0
    })
  })

  // Add each holding's value only from its purchase date onwards.
  // For dates with no price data, forward-fill with the last known price.
  const allDates = Object.keys(byDate).sort()

  histories.forEach(({ shares, value, purchaseDate, data: rows }) => {
    // Build a price map for known dates
    const priceMap = {}
    rows.forEach((row) => {
      const date = row.Date?.split('T')[0] ?? row.Datetime?.split('T')[0]
      if (date && row.Close != null) priceMap[date] = row.Close
    })

    const knownDates = Object.keys(priceMap).sort()
    const perShareValue = shares > 0 ? value / shares : 0

    // getMarketHistory returns raw Close prices in the ticker's native quoting
    // unit/currency (e.g. GBp pence for LSE tickers), which can't be summed
    // directly across holdings. h.value is already converted to the display
    // currency (and pence-adjusted) by the backend, so the ratio between it
    // and the latest raw close gives a single factor that folds in both the
    // unit conversion and the FX rate (approximated as constant over the period).
    let factor = 1
    if (knownDates.length > 0 && perShareValue > 0) {
      const latestRaw = priceMap[knownDates.at(-1)]
      if (latestRaw) factor = perShareValue / latestRaw
    }

    allDates.forEach((date) => {
      if (purchaseDate && date < purchaseDate) return

      if (priceMap[date] != null) {
        byDate[date] += shares * priceMap[date] * factor
      } else if (knownDates.length > 0) {
        // Last known price before or on this date
        const last = knownDates.filter((d) => d <= date).at(-1)
          ?? knownDates[0]  // if no data before this date, use earliest available
        byDate[date] += shares * priceMap[last] * factor
      } else {
        // No history at all — use current value per share (already in display currency)
        byDate[date] += shares * perShareValue
      }
    })
  })

  // Build cumulative dividend map: date → total dividends received up to that date
  const dividendByDate = {}
  dividendData.forEach(({ shares, purchaseDate, dividends }) => {
    dividends.forEach(({ date, amount }) => {
      if (purchaseDate && date < purchaseDate) return
      // Add dividend to all chart dates >= payment date
      Object.keys(byDate).forEach((chartDate) => {
        if (chartDate >= date) {
          dividendByDate[chartDate] = (dividendByDate[chartDate] ?? 0) + shares * amount
        }
      })
    })
  })

  let sorted = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({
      rawDate: date,
      Value: parseFloat((value + (dividendByDate[date] ?? 0)).toFixed(2)),
    }))

  if (period.months !== null) {
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - period.months)
    sorted = sorted.filter((d) => new Date(d.rawDate) >= cutoff)
  }

  return thinData(sorted, period).map((d) => ({
    date: formatDate(d.rawDate, period),
    Value: d.Value,
  }))
}

export default function Dashboard() {
  const { user } = useAuth()
  const { t } = useLang()
  const navigate = useNavigate()

  const [portfolioList, setPortfolioList] = useState([])   // [{id, name, ...}]
  const [activeTab, setActiveTab] = useState('aggregated') // 'aggregated' | portfolio.id
  const [portfolioData, setPortfolioData] = useState(null)
  const [chartData, setChartData] = useState([])
  const [showCapital, setShowCapital] = useState(true)
  const [loading, setLoading] = useState(true)
  const [chartLoading, setChartLoading] = useState(false)
  const [selectedPeriod, setSelectedPeriod] = useState(PERIOD_OPTIONS[3])

  // Add account modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [newPortfolioName, setNewPortfolioName] = useState('')
  const [addingPortfolio, setAddingPortfolio] = useState(false)
  const inputRef = useRef(null)

  // Settings modal
  const [showSettings, setShowSettings] = useState(false)
  const [settingsDetail, setSettingsDetail] = useState(null)

  // Add transaction modal
  const [showTxModal, setShowTxModal] = useState(false)

  const loadPortfolio = useCallback(async (tab, period) => {
    setChartLoading(true)
    setChartData([])
    try {
      const data = tab === 'aggregated'
        ? await getPortfolio()
        : await getPortfolioById(tab)
      setPortfolioData(data)
      if (data.holdings?.length) {
        const chart = await buildChartData(data.holdings, period)
        setChartData(chart)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setChartLoading(false)
    }
  }, [])

  useEffect(() => {
    async function init() {
      try {
        const [list, data] = await Promise.all([getPortfolioList(), getPortfolio()])
        setPortfolioList(list)
        setPortfolioData(data)
        setLoading(false)
        if (data.holdings?.length) {
          setChartLoading(true)
          try {
            const chart = await buildChartData(data.holdings, selectedPeriod)
            setChartData(chart)
          } finally {
            setChartLoading(false)
          }
        }
      } catch (e) {
        console.error(e)
        setLoading(false)
      }
    }
    init()
  }, [])

  useEffect(() => {
    if (showAddModal) setTimeout(() => inputRef.current?.focus(), 50)
  }, [showAddModal])

  async function handleTabChange(tab) {
    if (tab === activeTab) return
    setActiveTab(tab)
    await loadPortfolio(tab, selectedPeriod)
  }

  async function handlePeriod(period) {
    if (period.label === selectedPeriod.label) return
    setSelectedPeriod(period)
    if (!portfolioData?.holdings?.length) return
    setChartLoading(true)
    try {
      const chart = await buildChartData(portfolioData.holdings, period)
      setChartData(chart)
    } finally {
      setChartLoading(false)
    }
  }

  async function handleToggleAggregated(portfolio, value) {
    await updatePortfolio(portfolio.id, { include_in_aggregated: value })
    const list = await getPortfolioList()
    setPortfolioList(list)
    setSettingsDetail((prev) => prev ? { ...prev, include_in_aggregated: value } : prev)
    if (activeTab === 'aggregated') await loadPortfolio('aggregated', selectedPeriod)
  }

  async function handleDeletePortfolio(portfolio) {
    if (!window.confirm(`Delete "${portfolio.name}"? This will remove all its holdings.`)) return
    await deletePortfolio(portfolio.id)
    const list = await getPortfolioList()
    setPortfolioList(list)
    setSettingsDetail(null)
    setShowSettings(false)
    if (activeTab === portfolio.id) {
      setActiveTab('aggregated')
      await loadPortfolio('aggregated', selectedPeriod)
    }
  }

  async function handleCreatePortfolio(e) {
    e.preventDefault()
    if (!newPortfolioName.trim()) return
    setAddingPortfolio(true)
    try {
      await createPortfolio(newPortfolioName.trim())
      const list = await getPortfolioList()
      setPortfolioList(list)
      setShowAddModal(false)
      setNewPortfolioName('')
    } catch (err) {
      console.error(err)
    } finally {
      setAddingPortfolio(false)
    }
  }

  if (loading) return <p className="text-gray-400 text-sm">Loading...</p>

  const total = portfolioData?.total_value ?? 0
  const holdings = portfolioData?.holdings ?? []
  const displayCurrency = portfolioData?.display_currency ?? 'USD'

  function fmtCurrency(value) {
    return value.toLocaleString('en-US', {
      style: 'currency', currency: displayCurrency, maximumFractionDigits: 0,
    })
  }

  const periodChangePct = chartData.length >= 2
    ? ((chartData.at(-1).Value - chartData[0].Value) / chartData[0].Value * 100)
    : null
  const isUp = periodChangePct === null || periodChangePct >= 0

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <p className="text-sm text-gray-400 dark:text-gray-500">
        {t('dashboard.breadcrumb')} <span className="mx-1">›</span>
        <span className="text-gray-700 dark:text-gray-300">{t('dashboard.investments')}</span>
      </p>

      {/* Two-column layout */}
      <div className="flex gap-6 items-start">

        {/* Left — Portfolio chart */}
        <div className="flex-1 min-w-0 bg-white dark:bg-gray-900 rounded-xl p-6 space-y-4">

          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-base">{t('dashboard.portfolios')}</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-medium hover:opacity-90 transition-opacity"
              >
                {t('dashboard.addAccount')}
              </button>
              {activeTab !== 'aggregated' && portfolioList.find((p) => p.id === activeTab) && (
                <button
                  onClick={() => handleDeletePortfolio(portfolioList.find((p) => p.id === activeTab))}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-500 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                >
                  Delete account
                </button>
              )}
              <button
                onClick={() => { setSettingsDetail(null); setShowSettings(true) }}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-lg"
                title="Net worth settings"
              >
                ⚙
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-gray-100 dark:border-gray-800 flex-wrap">
            <button
              onClick={() => handleTabChange('aggregated')}
              className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                activeTab === 'aggregated'
                  ? 'border-gray-900 dark:border-gray-100 text-gray-900 dark:text-gray-100'
                  : 'border-transparent text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {t('dashboard.aggregated')}
            </button>
            {portfolioList.map((p) => (
              <button
                key={p.id}
                onClick={() => handleTabChange(p.id)}
                className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                  activeTab === p.id
                    ? 'border-gray-900 dark:border-gray-100 text-gray-900 dark:text-gray-100'
                    : 'border-transparent text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Show/hide + value */}
          <div className="space-y-1">
            <button
              onClick={() => setShowCapital((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              <span>{showCapital ? '◎' : '⊘'}</span>
              <span>{showCapital ? t('dashboard.hide') : t('dashboard.show')}</span>
            </button>
            {holdings.length > 0 && (
              <div className="flex items-end gap-3">
                <span className="text-3xl font-bold tracking-tight">
                  {showCapital ? fmtCurrency(total) : '● ● ● ● ●'}
                </span>
                {periodChangePct !== null && showCapital && (
                  <span className={`text-sm font-medium mb-1 ${isUp ? 'text-emerald-500' : 'text-red-500'}`}>
                    {isUp ? '↗' : '↘'} {isUp ? '+' : ''}{periodChangePct.toFixed(2)}%
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Chart */}
          {holdings.length > 0 ? (
            <>
              <p className="text-xs text-gray-400 text-right">{t('dashboard.chartIncludesDividends')}</p>
              <div className="flex gap-1 justify-end">
                {PERIOD_OPTIONS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => handlePeriod(p)}
                    className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                      selectedPeriod.label === p.label
                        ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                        : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {chartLoading && chartData.length === 0 ? (
                <div className="h-56 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse mt-2" />
              ) : (() => {
                const vals = chartData.map((d) => d.Value)
                const lo = Math.min(...vals)
                const hi = Math.max(...vals)
                const pad = (hi - lo) * 0.4
                const yMin = Math.max(0, lo - pad)
                const fmtCompact = (v) => new Intl.NumberFormat('en-US', {
                  style: 'currency', currency: displayCurrency,
                  notation: 'compact', maximumFractionDigits: 1,
                }).format(v)
                const fmtFull = (v) => new Intl.NumberFormat('en-US', {
                  style: 'currency', currency: displayCurrency,
                  maximumFractionDigits: 0,
                }).format(v)
                const CustomTooltip = ({ payload, active, label }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg px-4 py-3">
                      <p className="text-xs text-gray-400 mb-1">{label}</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{fmtFull(payload[0].value)}</p>
                    </div>
                  )
                }
                return (
                  <div className={chartLoading ? 'opacity-40 pointer-events-none' : ''}>
                    <AreaChart
                      className="h-56 [&_.recharts-cartesian-axis-tick_text]:dark:fill-white [&_.recharts-cartesian-axis-tick_text]:text-xs"
                      data={chartData}
                      index="date"
                      categories={['Value']}
                      colors={[isUp ? 'emerald' : 'red']}
                      valueFormatter={fmtCompact}
                      customTooltip={CustomTooltip}
                      showLegend={false}
                      showXAxis showYAxis
                      minValue={yMin}
                      yAxisWidth={70}
                      curveType="linear"
                    />
                  </div>
                )
              })()}
            </>
          ) : (
            <p className="text-sm text-gray-400 py-8 text-center">
              {t('dashboard.noHoldings')}{' '}
              <button onClick={() => navigate('/portfolio')} className="text-blue-500 hover:underline">
                {t('dashboard.addFirstPosition')}
              </button>
            </p>
          )}
        </div>

        {/* Right column */}
        <div className="w-72 shrink-0 space-y-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl p-5">
            <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-3">{t('dashboard.riskProfile')}</p>
            {user?.risk_score ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold">
                    {user.risk_score}<span className="text-sm font-normal text-gray-400">/68</span>
                  </span>
                  <Badge color={riskColor(user.risk_score)} size="sm">{riskLabel(user.risk_score)}</Badge>
                </div>
                <ProgressBar value={(user.risk_score / 68) * 100} color={riskColor(user.risk_score)} />
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-gray-400">{t('dashboard.notSetYet')}</p>
                <button onClick={() => navigate('/advisor')} className="text-xs text-blue-500 hover:underline">
                  {t('dashboard.setUpRiskProfile')}
                </button>
              </div>
            )}
          </div>

          {holdings.length > 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-xl p-5 space-y-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{t('dashboard.summary')}</p>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t('dashboard.positions')}</span>
                <span className="font-medium">{holdings.length}</span>
              </div>
              {(() => {
                const best = [...holdings].sort((a, b) => b.pnl_pct - a.pnl_pct)[0]
                const worst = [...holdings].sort((a, b) => a.pnl_pct - b.pnl_pct)[0]
                return (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">{t('dashboard.best')}</span>
                      <span className="font-medium text-emerald-500">
                        {best.ticker} {best.pnl_pct >= 0 ? '+' : ''}{best.pnl_pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">{t('dashboard.worst')}</span>
                      <span className={`font-medium ${worst.pnl_pct < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                        {worst.ticker} {worst.pnl_pct >= 0 ? '+' : ''}{worst.pnl_pct.toFixed(1)}%
                      </span>
                    </div>
                  </>
                )
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Positions table */}
      {holdings.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-base">{t('dashboard.positions')}</h2>
            <button
              onClick={() => setShowTxModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-medium hover:opacity-90 transition-opacity"
            >
              {t('dashboard.addTransaction')}
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 text-xs text-gray-400 uppercase tracking-wide">
                <th className="text-left pb-2 font-medium">{t('dashboard.colTitle')}</th>
                <th className="text-right pb-2 font-medium">{t('dashboard.colBuyIn')}</th>
                <th className="text-right pb-2 font-medium">{t('dashboard.colPosition')}</th>
                <th className="text-right pb-2 font-medium">{t('dashboard.colPL')}</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.id} className="border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs font-bold text-gray-600 dark:text-gray-400 shrink-0">
                        {h.ticker.slice(0, 2)}
                      </div>
                      <div>
                        <p className="font-semibold">{h.ticker}</p>
                        <p className="text-xs text-gray-400">{h.shares} {t('dashboard.positions').toLowerCase()}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 text-right text-gray-500 dark:text-gray-400">
                    {h.avg_buy_price.toLocaleString('en-US', {
                      style: 'currency', currency: h.currency ?? displayCurrency, maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="py-3 text-right font-medium">{fmtCurrency(h.value)}</td>
                  <td className="py-3 text-right">
                    <span className={`font-medium ${h.pnl_pct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      {h.pnl_pct >= 0 ? '↗' : '↘'} {h.pnl_pct >= 0 ? '+' : ''}{h.pnl_pct.toFixed(2)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showTxModal && portfolioList.length > 0 && (
        <AddTransactionModal
          portfolioList={portfolioList}
          defaultPortfolioId={activeTab !== 'aggregated' ? activeTab : portfolioList[0]?.id}
          onClose={() => setShowTxModal(false)}
          onAdded={async () => { await loadPortfolio(activeTab, selectedPeriod); const list = await getPortfolioList(); setPortfolioList(list) }}
        />
      )}

      {/* Net worth settings modal */}
      {showSettings && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowSettings(false); setSettingsDetail(null) } }}
        >
          <div className="bg-white dark:bg-gray-900 rounded-2xl w-[480px] shadow-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                {settingsDetail && (
                  <button
                    onClick={() => setSettingsDetail(null)}
                    className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mr-1"
                  >
                    ←
                  </button>
                )}
                <h3 className="font-bold text-lg">
                  {settingsDetail ? settingsDetail.name : t('dashboard.netWorthSettings')}
                </h3>
              </div>
              <button
                onClick={() => { setShowSettings(false); setSettingsDetail(null) }}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none"
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-4">
              {!settingsDetail ? (
                // Portfolio list
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('dashboard.yourAccounts')}</p>
                  {portfolioList.length === 0 && (
                    <p className="text-sm text-gray-400 py-4 text-center">{t('dashboard.noPortfolios')}</p>
                  )}
                  {portfolioList.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSettingsDetail(p)}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400 shrink-0">
                        $
                      </div>
                      <span className="flex-1 text-left font-medium text-sm">{p.name}</span>
                      {!p.include_in_aggregated && (
                        <span className="text-xs text-gray-400 mr-1">{t('dashboard.excluded')}</span>
                      )}
                      <span className="text-gray-300 dark:text-gray-600">›</span>
                    </button>
                  ))}
                </div>
              ) : (
                // Portfolio detail settings
                <div className="space-y-4 py-2">
                  <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-800">
                    <div>
                      <p className="text-sm font-medium">{t('dashboard.includeInAggregated')}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{t('dashboard.includeDesc')}</p>
                    </div>
                    <button
                      onClick={() => handleToggleAggregated(settingsDetail, !settingsDetail.include_in_aggregated)}
                      className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${
                        settingsDetail.include_in_aggregated
                          ? 'bg-gray-900 dark:bg-gray-100'
                          : 'bg-gray-200 dark:bg-gray-700'
                      }`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full shadow transition-all duration-200 ${
                        settingsDetail.include_in_aggregated
                          ? 'left-6 bg-white dark:bg-gray-900'
                          : 'left-0.5 bg-white dark:bg-gray-400'
                      }`} />
                    </button>
                  </div>

                  <button
                    onClick={() => handleDeletePortfolio(settingsDetail)}
                    className="w-full flex items-center gap-2 py-3 text-sm text-red-500 hover:text-red-600 transition-colors"
                  >
                    <span>🗑</span>
                    <span>{t('dashboard.deletePortfolio')} "{settingsDetail.name}"</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add portfolio modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAddModal(false) }}
        >
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-80 space-y-4 shadow-xl">
            <h3 className="font-semibold text-base">{t('dashboard.newPortfolio')}</h3>
            <form onSubmit={handleCreatePortfolio} className="space-y-3">
              <input
                ref={inputRef}
                type="text"
                placeholder={t('dashboard.portfolioPlaceholder')}
                value={newPortfolioName}
                onChange={(e) => setNewPortfolioName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100"
                required
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
                >
                  {t('dashboard.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={addingPortfolio}
                  className="px-4 py-2 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {addingPortfolio ? t('dashboard.creating') : t('dashboard.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
