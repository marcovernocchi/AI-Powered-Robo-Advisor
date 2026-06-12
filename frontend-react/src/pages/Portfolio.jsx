import { useState, useRef } from 'react'
import {
  Button,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  AreaChart,
} from '@tremor/react'
import { PieChart, Pie, Cell } from 'recharts'
import { deleteHolding, optimizePortfolio, downloadPortfolioExport } from '../api/client'
import { aggregateHoldings } from '../utils/holdingsUtils'
import AddTransactionModal from '../components/AddTransactionModal'
import EditHoldingModal from '../components/EditHoldingModal'
import SellHoldingModal from '../components/SellHoldingModal'
import ImportModal from '../components/ImportModal'
import { useLang } from '../context/LangContext'
import { usePortfolio, PERIOD_OPTIONS } from '../context/PortfolioContext'

const MASKED_VALUE = '* * * * *'

export default function Portfolio() {
  const { t } = useLang()
  const {
    portfolio, portfolioList, chartData,
    activeTab, selectedPeriod,
    loading, chartLoading,
    handleTabChange, handlePeriod, refresh,
  } = usePortfolio()

  const [showCapital, setShowCapital]       = useState(true)
  const [showModal, setShowModal]           = useState(false)
  const [showImport, setShowImport]         = useState(false)
  const [editingHolding, setEditingHolding] = useState(null)
  const [actionMenu, setActionMenu]         = useState(null) // { id, top, left }
  const [buyingHolding, setBuyingHolding]   = useState(null)
  const [sellingHolding, setSellingHolding] = useState(null)
  const [optimization, setOptimization]     = useState(null)
  const [optLoading, setOptLoading]         = useState(false)
  const [optError, setOptError]             = useState('')
  const [sortKey, setSortKey]               = useState(null)
  const [sortDir, setSortDir]               = useState('desc')
  const [chartView, setChartView]           = useState('type')
  const [exportLoading, setExportLoading]   = useState(null)
  const [exportError, setExportError]       = useState('')
  const [showExportPanel, setShowExportPanel] = useState(false)
  const [exportTargetId, setExportTargetId]   = useState('aggregated')
  const [exportFormat, setExportFormat]       = useState('excel')
  const [selectedSlice, setSelectedSlice]   = useState(null)
  const optimizeRef = useRef(null)

  async function handleExport(format, portfolioId = 'aggregated') {
    setExportError('')
    setExportLoading(format)
    try {
      await downloadPortfolioExport(format, portfolioId !== 'aggregated' ? portfolioId : null)
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

  async function handleDelete(id) {
    if (!window.confirm(t('portfolio.confirmRemove'))) return
    try {
      await deleteHolding(id)
      await refresh()
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
  const aggregated  = aggregateHoldings(rawHoldings)
  const holdings = sortKey
    ? [...aggregated].sort((a, b) => sortDir === 'desc' ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey])
    : aggregated
  const total           = portfolio?.total_value ?? 0
  const displayCurrency = portfolio?.display_currency ?? 'USD'

  function fmtCurrency(value, currency) {
    return value.toLocaleString('en-US', {
      style: 'currency', currency: currency ?? displayCurrency, maximumFractionDigits: 2,
    })
  }

  const firstPortfolioId = activeTab !== 'aggregated' ? activeTab : portfolioList[0]?.id
  const actionMenuHolding = actionMenu ? holdings.find((x) => x.id === actionMenu.id) : null

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
    rawHoldings.reduce((acc, h) => {
      const label = ASSET_TYPE_LABEL[h.asset_type] ?? h.asset_type
      acc[label] = (acc[label] ?? 0) + h.value
      return acc
    }, {})
  ).map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
   .sort((a, b) => b.value - a.value)

  const tickerMap = rawHoldings.reduce((acc, h) => {
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

  const boxClass = "bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm"
  const periodChangePct = chartData.length >= 2
    ? ((chartData.at(-1).Value - chartData[0].Value) / chartData[0].Value * 100)
    : null
  const isUp = periodChangePct === null || periodChangePct >= 0

  return (
    <div className="space-y-4">

      {/* Top row: chart + allocation */}
      <div className="flex gap-5 items-stretch">

        {/* Box 1: portfolio tabs + value + chart */}
        <div className={`${boxClass} p-5 flex-1 min-w-0`}>
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('portfolio.title')}</h1>
              {holdings.length > 0 && (
                <div className="mt-2">
                  <button
                    onClick={() => setShowCapital((v) => !v)}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors mb-1"
                  >
                    <span>{showCapital ? '◎' : '⊘'}</span>
                    <span>{showCapital ? t('portfolio.hide') : t('portfolio.show')}</span>
                  </button>
                  <p className="text-3xl font-bold text-gray-900 dark:text-gray-100 tabular-nums leading-none">
                    {showCapital ? fmtCurrency(total) : MASKED_VALUE}
                  </p>
                  <p className={`text-sm font-medium mt-1.5 ${totalPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {showCapital && <>{totalPnl >= 0 ? '+' : ''}{fmtCurrency(totalPnl)}&nbsp;&nbsp;</>}
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

          {holdings.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-400">{t('dashboard.chartIncludesDividends')}</p>
                <div className="flex gap-1">
                  {PERIOD_OPTIONS.map((p) => (
                    <button
                      key={p.label}
                      onClick={() => handlePeriod(p, portfolio?.holdings)}
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

        {/* RIGHT — allocation sidebar */}
        {holdings.length > 0 && (
          <div className="w-[500px] shrink-0">
            <div className={`${boxClass} p-5 h-full flex flex-col`}>
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

              <div className="flex-1 flex items-center justify-center">
                <div className="relative" style={{ width: 300, height: 300 }}>
                  <PieChart width={300} height={300}>
                    <Pie
                      data={allocationData}
                      cx={150}
                      cy={150}
                      innerRadius={95}
                      outerRadius={140}
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
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                    <div style={{ maxWidth: 150 }}>
                      {selectedSlice ? (
                        <>
                          <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug mb-2">
                            {selectedSlice.displayName ?? selectedSlice.name}
                          </p>
                          <p className="text-xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">{showCapital ? fmtCurrency(selectedSlice.value) : MASKED_VALUE}</p>
                          <p className="text-sm text-gray-400 mt-1">{total > 0 ? ((selectedSlice.value / total) * 100).toFixed(1) : 0}%</p>
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-gray-400 mb-2">Total</p>
                          <p className="text-xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">{showCapital ? fmtCurrency(total) : MASKED_VALUE}</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Box 2: Holdings table */}
      <div className={`${boxClass} p-5`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('portfolio.holdings')}</h2>
          <div className="flex items-center gap-2">
            {holdings.length > 0 && (
              <button
                onClick={() => {
                  handleOptimize()
                  setTimeout(() => optimizeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
                }}
                disabled={optLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {optLoading ? 'Ottimizzando...' : 'Optimize'}
              </button>
            )}
            <div className="relative">
              <button
                disabled={holdings.length === 0}
                onClick={() => setShowExportPanel(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40"
              >
                Export <span className="text-[10px] opacity-60">▾</span>
              </button>

              {showExportPanel && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowExportPanel(false)} />
                  <div className="absolute right-0 top-full mt-2 z-20 w-60 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-xl p-4">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Portafoglio</p>
                    <div className="space-y-1.5 mb-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="exportTarget" value="aggregated"
                          checked={exportTargetId === 'aggregated'}
                          onChange={() => setExportTargetId('aggregated')}
                          className="accent-gray-900 dark:accent-white"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">Tutti i portafogli</span>
                      </label>
                      {portfolioList.map(p => (
                        <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="exportTarget" value={p.id}
                            checked={exportTargetId === p.id}
                            onChange={() => setExportTargetId(p.id)}
                            className="accent-gray-900 dark:accent-white"
                          />
                          <span className="text-sm text-gray-700 dark:text-gray-300">{p.name}</span>
                        </label>
                      ))}
                    </div>

                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Formato</p>
                    <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 mb-4">
                      {['excel', 'pdf'].map(f => (
                        <button key={f} onClick={() => setExportFormat(f)}
                          className={`flex-1 py-1 text-xs font-medium rounded-md transition-colors ${
                            exportFormat === f
                              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                              : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                          }`}
                        >{f === 'excel' ? 'Excel' : 'PDF'}</button>
                      ))}
                    </div>

                    {exportError && <p className="text-xs text-red-500 mb-3">{exportError}</p>}

                    <button
                      onClick={() => { handleExport(exportFormat, exportTargetId); setShowExportPanel(false) }}
                      disabled={exportLoading !== null}
                      className="w-full py-1.5 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {exportLoading ? 'Esportando...' : 'Esporta'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {holdings.length > 0 ? (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell className="w-1/2">Asset</TableHeaderCell>
                <TableHeaderCell>{t('portfolio.purchaseValue')}</TableHeaderCell>
                <TableHeaderCell>
                  <button onClick={() => handleSort('value')} className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-100">
                    {t('portfolio.currentValue')}
                    <span className="text-gray-300 dark:text-gray-600">{sortKey === 'value' ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
                  </button>
                </TableHeaderCell>
                <TableHeaderCell>
                  <button onClick={() => handleSort('pnl_pct')} className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-100">
                    P&amp;L
                    <span className="text-gray-300 dark:text-gray-600">{sortKey === 'pnl_pct' ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
                  </button>
                </TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {holdings.map((h) => {
                const buyTotal = h.avg_buy_price * h.shares
                const pnlAbs = h.value - buyTotal
                return (
                  <TableRow key={h.id}>
                    <TableCell>
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-gray-100">
                          {h.asset_name || h.ticker}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {h.ticker}
                          {h.asset_name && <span className="ml-2">×{h.shares}</span>}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="tabular-nums text-gray-900 dark:text-gray-100">{showCapital ? fmtCurrency(buyTotal, h.currency) : MASKED_VALUE}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{fmtCurrency(h.avg_buy_price, h.currency)} avg</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="tabular-nums text-gray-900 dark:text-gray-100">
                          {showCapital ? fmtCurrency(h.value) : MASKED_VALUE}
                          {h.price_stale && <span title="Prezzo non aggiornato" className="ml-1 text-xs text-amber-400">⚠</span>}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{fmtCurrency(h.current_price, h.currency)}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className={`tabular-nums font-medium ${pnlAbs >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {showCapital ? <>{pnlAbs >= 0 ? '+' : ''}{fmtCurrency(pnlAbs)}</> : MASKED_VALUE}
                      </p>
                      <p className={`text-xs mt-0.5 ${h.pnl_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {h.pnl_pct >= 0 ? '↗' : '↘'}{Math.abs(h.pnl_pct).toFixed(2)}%
                      </p>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={(e) => {
                            if (actionMenu?.id === h.id) { setActionMenu(null); return }
                            const rect = e.currentTarget.getBoundingClientRect()
                            setActionMenu({ id: h.id, top: rect.bottom + 4, left: rect.left })
                          }}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-blue-200 dark:border-blue-800 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
                        >
                          {t('portfolio.edit')} <span className="text-[10px] opacity-60">▾</span>
                        </button>
                        <button onClick={() => handleDelete(h.id)} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors">{t('portfolio.remove')}</button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="text-gray-400 text-sm text-center py-10">{t('portfolio.noHoldings')}</p>
        )}
      </div>

      {/* Box 3: Optimization */}
      {holdings.length >= 2 && (
        <div ref={optimizeRef} className={`${boxClass} p-5`}>
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
                      <span className="w-20 shrink-0 truncate text-sm font-semibold text-gray-800 dark:text-gray-200">{ticker}</span>
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

      {showImport && (
        <ImportModal portfolioList={portfolioList} defaultPortfolioId={firstPortfolioId} onClose={() => setShowImport(false)} onImported={refresh} />
      )}
      {actionMenu && actionMenuHolding && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setActionMenu(null)} />
          <div
            className="fixed z-40 w-28 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-xl overflow-hidden"
            style={{ top: actionMenu.top, left: actionMenu.left }}
          >
            <button onClick={() => { setEditingHolding(actionMenuHolding); setActionMenu(null) }} className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">{t('portfolio.edit')}</button>
            <button onClick={() => { setBuyingHolding(actionMenuHolding); setActionMenu(null) }} className="w-full text-left px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">{t('modal.buy')}</button>
            {actionMenuHolding.asset_type !== 'cash' && (
              <button onClick={() => { setSellingHolding(actionMenuHolding); setActionMenu(null) }} className="w-full text-left px-3 py-2 text-xs text-orange-600 dark:text-orange-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">{t('modal.sell')}</button>
            )}
          </div>
        </>
      )}
      {editingHolding && (
        <EditHoldingModal holding={editingHolding} onClose={() => setEditingHolding(null)} onSaved={refresh} />
      )}
      {showModal && (
        <AddTransactionModal portfolioList={portfolioList} defaultPortfolioId={firstPortfolioId} onClose={() => setShowModal(false)} onAdded={refresh} />
      )}
      {buyingHolding && (
        <AddTransactionModal
          portfolioList={portfolioList}
          defaultPortfolioId={firstPortfolioId}
          presetAsset={{
            ticker: buyingHolding.ticker,
            name: buyingHolding.asset_name,
            type: buyingHolding.asset_type,
            portfolioId: buyingHolding.portfolio_id,
          }}
          onClose={() => setBuyingHolding(null)}
          onAdded={refresh}
        />
      )}
      {sellingHolding && (
        <SellHoldingModal holding={sellingHolding} onClose={() => setSellingHolding(null)} onSold={refresh} />
      )}
    </div>
  )
}
