import { useEffect, useState, useCallback } from 'react'
import {
  Card, Title, Text, Button, Badge,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  Flex, Legend, AreaChart,
} from '@tremor/react'
import { PieChart, Pie, Cell } from 'recharts'
import { getPortfolio, getPortfolioById, getPortfolioList, deleteHolding, optimizePortfolio, downloadPortfolioExport, getMarketHistory, getDividends } from '../api/client'
import AddTransactionModal from '../components/AddTransactionModal'
import EditHoldingModal from '../components/EditHoldingModal'
import ImportModal from '../components/ImportModal'
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

async function buildChartData(holdings, period) {
  if (!holdings?.length) return []
  const [histories, dividendData] = await Promise.all([
    Promise.all(holdings.map((h) =>
      getMarketHistory(h.ticker, period.api)
        .then((r) => ({ shares: h.shares, value: h.value, purchaseDate: h.purchase_date ?? null, data: r.data }))
        .catch(() => ({ shares: h.shares, value: h.value, purchaseDate: h.purchase_date ?? null, data: [] }))
    )),
    Promise.all(holdings.map((h) =>
      getDividends(h.ticker, h.purchase_date)
        .then((r) => ({ shares: h.shares, purchaseDate: h.purchase_date, dividends: r.dividends }))
        .catch(() => ({ shares: h.shares, purchaseDate: h.purchase_date, dividends: [] }))
    )),
  ])
  const byDate = {}
  histories.forEach(({ data: rows }) => {
    rows.forEach((row) => {
      const date = row.Date?.split('T')[0] ?? row.Datetime?.split('T')[0]
      if (date && byDate[date] === undefined) byDate[date] = 0
    })
  })
  const allDates = Object.keys(byDate).sort()
  histories.forEach(({ shares, value, purchaseDate, data: rows }) => {
    const priceMap = {}
    rows.forEach((row) => {
      const date = row.Date?.split('T')[0] ?? row.Datetime?.split('T')[0]
      if (date && row.Close != null) priceMap[date] = row.Close
    })
    const knownDates = Object.keys(priceMap).sort()
    const perShareValue = shares > 0 ? value / shares : 0
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
        const last = knownDates.filter((d) => d <= date).at(-1) ?? knownDates[0]
        byDate[date] += shares * priceMap[last] * factor
      } else {
        byDate[date] += shares * perShareValue
      }
    })
  })
  const dividendByDate = {}
  dividendData.forEach(({ shares, purchaseDate, dividends }) => {
    dividends.forEach(({ date, amount }) => {
      if (purchaseDate && date < purchaseDate) return
      Object.keys(byDate).forEach((chartDate) => {
        if (chartDate >= date) dividendByDate[chartDate] = (dividendByDate[chartDate] ?? 0) + shares * amount
      })
    })
  })
  let sorted = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ rawDate: date, Value: parseFloat((value + (dividendByDate[date] ?? 0)).toFixed(2)) }))
  if (period.months !== null) {
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - period.months)
    sorted = sorted.filter((d) => new Date(d.rawDate) >= cutoff)
  }
  return thinData(sorted, period).map((d) => ({ date: formatDate(d.rawDate, period), Value: d.Value }))
}

export default function Portfolio() {
  const { t } = useLang()
  const [portfolio, setPortfolio]       = useState(null)
  const [portfolioList, setPortfolioList] = useState([])
  const [activeTab, setActiveTab]        = useState('aggregated')
  const [loading, setLoading]           = useState(true)
  const [showModal, setShowModal]       = useState(false)
  const [showImport, setShowImport]     = useState(false)
  const [editingHolding, setEditingHolding] = useState(null)
  const [optimization, setOptimization] = useState(null)
  const [optLoading, setOptLoading]     = useState(false)
  const [optError, setOptError]         = useState('')
  const [sortKey, setSortKey]           = useState(null)
  const [sortDir, setSortDir]           = useState('desc')
  const [chartView, setChartView]       = useState('type')
  const [exportLoading, setExportLoading] = useState(null)   // 'excel' | 'pdf' | null
  const [exportError, setExportError]   = useState('')
  const [chartData, setChartData]       = useState([])
  const [chartLoading, setChartLoading] = useState(false)
  const [selectedPeriod, setSelectedPeriod] = useState(PERIOD_OPTIONS[3])
  const [selectedSlice, setSelectedSlice] = useState(null)

  async function handleExport(format) {
    setExportError('')
    setExportLoading(format)
    try {
      await downloadPortfolioExport(format)
    } catch (err) {
      setExportError(err.message)
    } finally {
      setExportLoading(null)
    }
  }

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  async function fetchAll(tab = activeTab, period = selectedPeriod) {
    try {
      const [data, list] = await Promise.all([
        tab === 'aggregated' ? getPortfolio() : getPortfolioById(tab),
        getPortfolioList(),
      ])
      setPortfolio(data)
      setPortfolioList(list)
      if (data.holdings?.length) {
        setChartLoading(true)
        setChartData([])
        try {
          const chart = await buildChartData(data.holdings, period)
          setChartData(chart)
        } finally {
          setChartLoading(false)
        }
      } else {
        setChartData([])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [])

  async function handleTabChange(tab) {
    if (tab === activeTab) return
    setActiveTab(tab)
    setLoading(true)
    await fetchAll(tab, selectedPeriod)
  }

  async function handlePeriod(period) {
    if (period.label === selectedPeriod.label) return
    setSelectedPeriod(period)
    const h = portfolio?.holdings ?? []
    if (!h.length) return
    setChartLoading(true)
    try {
      const chart = await buildChartData(h, period)
      setChartData(chart)
    } finally {
      setChartLoading(false)
    }
  }

  async function handleDelete(id) {
    try {
      await deleteHolding(id)
      await fetchAll()
    } catch (e) { console.error(e) }
  }

  async function handleOptimize() {
    setOptError('')
    setOptLoading(true)
    setOptimization(null)
    try {
      const result = await optimizePortfolio()
      setOptimization(result)
    } catch (err) {
      setOptError(err.message)
    } finally {
      setOptLoading(false)
    }
  }

  if (loading) return <p className="text-gray-400 text-sm">Loading...</p>

  const rawHoldings = portfolio?.holdings ?? []
  const holdings = sortKey
    ? [...rawHoldings].sort((a, b) => sortDir === 'desc' ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey])
    : rawHoldings
  const total    = portfolio?.total_value ?? 0
  const displayCurrency = portfolio?.display_currency ?? 'USD'

  function fmtCurrency(value, currency) {
    return value.toLocaleString('en-US', {
      style: 'currency', currency: currency ?? displayCurrency, maximumFractionDigits: 2,
    })
  }

  const firstPortfolioId = activeTab !== 'aggregated' ? activeTab : portfolioList[0]?.id

  const ASSET_TYPE_LABEL = {
    equity:     'Equity',
    etf_equity: 'ETF Azionario',
    etf_bond:   'ETF Obbligazionario',
    bond:       'Bond',
    crypto:     'Crypto',
    commodity:  'Commodity',
    cash:       'Cash',
    security:   'Equity',
  }

  const CHART_COLORS = [
    'emerald', 'blue', 'violet', 'amber', 'cyan', 'orange', 'rose', 'indigo',
    'teal', 'yellow', 'purple', 'sky', 'lime', 'fuchsia', 'red', 'green',
  ]

  const CHART_HEX = [
    '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#06b6d4', '#f97316', '#f43f5e', '#6366f1',
    '#14b8a6', '#eab308', '#a855f7', '#0ea5e9', '#84cc16', '#d946ef', '#ef4444', '#22c55e',
  ]

  const chartDataByType = Object.entries(
    holdings.reduce((acc, h) => {
      const label = ASSET_TYPE_LABEL[h.asset_type] ?? h.asset_type
      acc[label] = (acc[label] ?? 0) + h.value
      return acc
    }, {})
  ).map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
   .sort((a, b) => b.value - a.value)

  // Aggregate duplicate tickers then sort by value descending — no hard cap
  const tickerMap = holdings.reduce((acc, h) => {
    if (!acc[h.ticker]) acc[h.ticker] = { value: 0, displayName: h.asset_name || h.ticker }
    acc[h.ticker].value += h.value
    return acc
  }, {})
  const chartDataByTicker = Object.entries(tickerMap)
    .map(([ticker, { value, displayName }]) => ({ name: ticker, displayName, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, CHART_COLORS.length)

  const totalCost = holdings.reduce((sum, h) => sum + h.avg_buy_price * h.shares, 0)
  const totalPnl = total - totalCost
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0
  const allocationData = chartView === 'type' ? chartDataByType : chartDataByTicker
  const tickerNameMap = holdings.reduce((acc, h) => {
    if (h.asset_name && !acc[h.ticker]) acc[h.ticker] = h.asset_name
    return acc
  }, {})

  const boxClass = "bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm"
  const periodChangePct = chartData.length >= 2
    ? ((chartData.at(-1).Value - chartData[0].Value) / chartData[0].Value * 100)
    : null
  const isUp = periodChangePct === null || periodChangePct >= 0

  return (
    <div className="space-y-4">

      {/* Two-column layout */}
      <div className="flex gap-5 items-start" style={{ gridTemplateColumns: '3fr 2fr' }}>

        {/* LEFT */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Box 1: portfolio tabs + value + actions */}
          <div className={`${boxClass} p-5`}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('portfolio.title')}</h1>
                {holdings.length > 0 && (
                  <div className="mt-2">
                    <p className="text-3xl font-bold text-gray-900 dark:text-gray-100 tabular-nums leading-none">
                      {fmtCurrency(total)}
                    </p>
                    <p className={`text-sm font-medium mt-1.5 ${totalPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      {totalPnl >= 0 ? '+' : ''}{fmtCurrency(totalPnl)}&nbsp;&nbsp;
                      <span className="font-normal opacity-80">({totalPnl >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}%)</span>
                    </p>
                  </div>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setShowImport(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  {t('portfolio.importFile')}
                </button>
                <button
                  onClick={() => setShowModal(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  {t('portfolio.addTransaction')}
                </button>
              </div>
            </div>

            {/* Portfolio selector tabs */}
            <div className="flex gap-1 border-b border-gray-100 dark:border-gray-800 flex-wrap -mx-1 px-1">
              <button
                onClick={() => handleTabChange('aggregated')}
                className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                  activeTab === 'aggregated'
                    ? 'border-gray-900 dark:border-gray-100 text-gray-900 dark:text-gray-100'
                    : 'border-transparent text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >All portfolios</button>
              {portfolioList.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleTabChange(p.id)}
                  className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                    activeTab === p.id
                      ? 'border-gray-900 dark:border-gray-100 text-gray-900 dark:text-gray-100'
                      : 'border-transparent text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                >{p.name}</button>
              ))}
            </div>

            {/* Chart */}
            {holdings.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-400">{t('dashboard.chartIncludesDividends')}</p>
                  <div className="flex gap-1">
                    {PERIOD_OPTIONS.map((p) => (
                      <button
                        key={p.label}
                        onClick={() => handlePeriod(p)}
                        className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                          selectedPeriod.label === p.label
                            ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                            : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                        }`}
                      >{p.label}</button>
                    ))}
                  </div>
                </div>
                {chartLoading && chartData.length === 0 ? (
                  <div className="h-48 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
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
                    style: 'currency', currency: displayCurrency, maximumFractionDigits: 0,
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
                        className="h-48 [&_.recharts-cartesian-axis-tick_text]:dark:fill-white [&_.recharts-cartesian-axis-tick_text]:text-xs"
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
              </div>
            )}
          </div>

          {/* Box 2: Holdings table */}
          <div className={`${boxClass} p-5`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('portfolio.holdings')}</h2>
              <div className="flex items-center gap-2">
                <Button size="xs" variant="secondary"
                  disabled={holdings.length === 0 || exportLoading !== null}
                  loading={exportLoading === 'excel'}
                  onClick={() => handleExport('excel')}
                >Excel</Button>
                <Button size="xs" variant="secondary"
                  disabled={holdings.length === 0 || exportLoading !== null}
                  loading={exportLoading === 'pdf'}
                  onClick={() => handleExport('pdf')}
                >PDF</Button>
              </div>
            </div>
            {exportError && <p className="mb-3 text-xs text-red-500">{exportError}</p>}
            {holdings.length > 0 ? (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>{t('portfolio.asset')}</TableHeaderCell>
                    <TableHeaderCell>{t('portfolio.type')}</TableHeaderCell>
                    <TableHeaderCell>{t('portfolio.shares')}</TableHeaderCell>
                    <TableHeaderCell>{t('portfolio.avgBuy')}</TableHeaderCell>
                    <TableHeaderCell>{t('portfolio.current')}</TableHeaderCell>
                    <TableHeaderCell>
                      <button onClick={() => handleSort('value')} className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-100">
                        {t('portfolio.value')}
                        <span className="text-gray-300 dark:text-gray-600">{sortKey === 'value' ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
                      </button>
                    </TableHeaderCell>
                    <TableHeaderCell>
                      <button onClick={() => handleSort('pnl_pct')} className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-100">
                        {t('portfolio.pl')}
                        <span className="text-gray-300 dark:text-gray-600">{sortKey === 'pnl_pct' ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
                      </button>
                    </TableHeaderCell>
                    <TableHeaderCell></TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {holdings.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell>
                        <div>
                          <p className="font-semibold">{h.ticker}</p>
                          {h.asset_name && <p className="text-xs text-gray-400 truncate max-w-32">{h.asset_name}</p>}
                        </div>
                      </TableCell>
                      <TableCell><span className="text-xs text-gray-400">{ASSET_TYPE_LABEL[h.asset_type] ?? h.asset_type}</span></TableCell>
                      <TableCell>{h.shares}</TableCell>
                      <TableCell>{fmtCurrency(h.avg_buy_price, h.currency)}</TableCell>
                      <TableCell>
                        {fmtCurrency(h.current_price, h.currency)}
                        {h.price_stale && <span title="Prezzo non aggiornato" className="ml-1 text-xs text-amber-400">⚠</span>}
                      </TableCell>
                      <TableCell>{fmtCurrency(h.value)}</TableCell>
                      <TableCell>
                        <Badge color={h.pnl_pct >= 0 ? 'emerald' : 'red'}>
                          {h.pnl_pct >= 0 ? '+' : ''}{h.pnl_pct.toFixed(2)}%
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-3">
                          <button onClick={() => setEditingHolding(h)} className="text-xs text-blue-400 hover:text-blue-600">{t('portfolio.edit')}</button>
                          <button onClick={() => handleDelete(h.id)} className="text-xs text-red-400 hover:text-red-600">{t('portfolio.remove')}</button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-gray-400 text-sm text-center py-10">{t('portfolio.noHoldings')}</p>
            )}
          </div>

          {/* Box 3: Optimization */}
          {holdings.length >= 2 && (
            <div className={`${boxClass} p-5`}>
              <div className="flex items-start justify-between mb-1">
                <div>
                  <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('portfolio.optimization')}</h2>
                  <p className="text-sm text-gray-400 mt-0.5">{t('portfolio.optimizationDesc')}</p>
                </div>
                <Button variant="secondary" onClick={handleOptimize} loading={optLoading}>
                  {t('portfolio.optimize')}
                </Button>
              </div>
              {optError && <p className="mt-3 text-sm text-red-500">{optError}</p>}
              {optimization && (
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
                      <p className="text-xs text-gray-400 mb-1">{t('portfolio.expectedReturn')}</p>
                      <p className="font-bold text-emerald-500">{optimization.expected_annual_return_pct?.toFixed(2) ?? '–'}%</p>
                    </div>
                    <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
                      <p className="text-xs text-gray-400 mb-1">{t('portfolio.volatility')}</p>
                      <p className="font-bold text-orange-500">{optimization.annual_volatility_pct?.toFixed(2) ?? '–'}%</p>
                    </div>
                    <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
                      <p className="text-xs text-gray-400 mb-1">{t('portfolio.sharpeRatio')}</p>
                      <p className="font-bold text-gray-900 dark:text-gray-100">{optimization.sharpe_ratio?.toFixed(2) ?? '–'}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('portfolio.suggestedWeights')}</p>
                    <div className="space-y-2">
                      {Object.entries(optimization.weights ?? {}).map(([ticker, w]) => (
                        <div key={ticker} className="flex items-center gap-3">
                          <span className="w-14 text-sm font-semibold text-gray-800 dark:text-gray-200">{ticker}</span>
                          <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                            <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${(w * 100).toFixed(1)}%` }} />
                          </div>
                          <span className="w-10 text-right text-sm text-gray-500 dark:text-gray-400">{(w * 100).toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT — allocation sidebar */}
        {holdings.length > 0 && (
          <div className="w-[500px] shrink-0 sticky top-6">
            <div className={`${boxClass} p-5`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Allocation</h2>
                <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                  <button
                    onClick={() => setChartView('type')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      chartView === 'type'
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                        : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                    }`}
                  >Type</button>
                  <button
                    onClick={() => setChartView('ticker')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      chartView === 'ticker'
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                        : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                    }`}
                  >Asset</button>
                </div>
              </div>

              {/* Donut with hover-interactive center */}
              <div className="relative mx-auto" style={{ width: 240, height: 240 }}>
                <PieChart width={240} height={240}>
                  <Pie
                    data={allocationData}
                    cx={120}
                    cy={120}
                    innerRadius={78}
                    outerRadius={115}
                    dataKey="value"
                    strokeWidth={0}
                    onMouseEnter={(data) => setSelectedSlice(data)}
                    onMouseLeave={() => setSelectedSlice(null)}
                  >
                    {allocationData.map((entry, i) => (
                      <Cell
                        key={entry.name}
                        fill={CHART_HEX[i % CHART_HEX.length]}
                        opacity={selectedSlice && selectedSlice.name !== entry.name ? 0.25 : 1}
                        style={{ cursor: 'default', transition: 'opacity 0.15s' }}
                      />
                    ))}
                  </Pie>
                </PieChart>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-4">
                  {selectedSlice ? (
                    <>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug mb-1 line-clamp-3">
                        {selectedSlice.displayName ?? selectedSlice.name}
                      </p>
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums">{fmtCurrency(selectedSlice.value)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{total > 0 ? ((selectedSlice.value / total) * 100).toFixed(1) : 0}%</p>
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] text-gray-400 mb-1">Total</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums">{fmtCurrency(total)}</p>
                    </>
                  )}
                </div>
              </div>

              {/* Legend with % bars */}
              <div className="mt-5 space-y-3">
                {allocationData.map((d, i) => {
                  const pct = total > 0 ? (d.value / total) * 100 : 0
                  return (
                    <div key={d.name}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: CHART_HEX[i % CHART_HEX.length] }}
                          />
                          <span className="text-xs text-gray-700 dark:text-gray-300 truncate">{d.name}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className="text-xs font-medium text-gray-900 dark:text-gray-100 tabular-nums">{fmtCurrency(d.value)}</span>
                          <span className="text-xs text-gray-400 w-10 text-right tabular-nums">{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1">
                        <div
                          className="h-1 rounded-full transition-all duration-500"
                          style={{ width: `${pct.toFixed(1)}%`, backgroundColor: CHART_HEX[i % CHART_HEX.length] }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {showImport && (
        <ImportModal portfolioList={portfolioList} defaultPortfolioId={firstPortfolioId} onClose={() => setShowImport(false)} onImported={fetchAll} />
      )}
      {editingHolding && (
        <EditHoldingModal holding={editingHolding} onClose={() => setEditingHolding(null)} onSaved={fetchAll} />
      )}
      {showModal && (
        <AddTransactionModal portfolioList={portfolioList} defaultPortfolioId={firstPortfolioId} onClose={() => setShowModal(false)} onAdded={fetchAll} />
      )}
    </div>
  )
}
