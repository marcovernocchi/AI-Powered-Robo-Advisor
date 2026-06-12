import { useEffect, useState, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { AreaChart, Badge, ProgressBar } from '@tremor/react'
import { createPortfolio, updatePortfolio, deletePortfolio } from '../api/client'
import AddTransactionModal from '../components/AddTransactionModal'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { usePortfolio, PERIOD_OPTIONS } from '../context/PortfolioContext'
import { aggregateHoldings } from '../utils/holdingsUtils'

const MASKED_VALUE = '* * * * *'

function riskColor(score) {
  if (score <= 26) return 'emerald'
  if (score <= 42) return 'yellow'
  if (score <= 56) return 'orange'
  return 'red'
}

export default function Dashboard() {
  const { user } = useAuth()
  const { t } = useLang()

  function riskLabel(score) {
    if (score <= 26) return t('advisor.riskLow')
    if (score <= 42) return t('advisor.riskMedLow')
    if (score <= 56) return t('advisor.riskMed')
    return t('advisor.riskHigh')
  }
  const navigate = useNavigate()
  const {
    portfolio: portfolioData, portfolioList, chartData,
    activeTab, selectedPeriod,
    loading, chartLoading,
    handleTabChange, handlePeriod, refresh, fetchAll,
  } = usePortfolio()

  const [showCapital, setShowCapital] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newPortfolioName, setNewPortfolioName] = useState('')
  const [addingPortfolio, setAddingPortfolio] = useState(false)
  const inputRef = useRef(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsDetail, setSettingsDetail] = useState(null)
  const [showTxModal, setShowTxModal] = useState(false)
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => {
    if (showAddModal) setTimeout(() => inputRef.current?.focus(), 50)
  }, [showAddModal])

  async function handleToggleAggregated(portfolio, value) {
    await updatePortfolio(portfolio.id, { include_in_aggregated: value })
    setSettingsDetail((prev) => prev ? { ...prev, include_in_aggregated: value } : prev)
    await refresh()
  }

  async function handleDeletePortfolio(portfolio) {
    if (!window.confirm(`Delete "${portfolio.name}"? This will remove all its holdings.`)) return
    await deletePortfolio(portfolio.id)
    setSettingsDetail(null)
    setShowSettings(false)
    const nextTab = activeTab === portfolio.id ? 'aggregated' : activeTab
    await fetchAll(nextTab, selectedPeriod)
  }

  async function handleCreatePortfolio(e) {
    e.preventDefault()
    if (!newPortfolioName.trim()) return
    setAddingPortfolio(true)
    try {
      await createPortfolio(newPortfolioName.trim())
      await refresh()
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
  const aggregatedHoldings = aggregateHoldings(holdings)
  const displayCurrency = portfolioData?.display_currency ?? 'USD'

  function fmtCurrency(value, currency, decimals = 0) {
    return value.toLocaleString('en-US', {
      style: 'currency', currency: currency ?? displayCurrency, maximumFractionDigits: decimals,
    })
  }

  function fmtDate(dateStr) {
    if (!dateStr) return '–'
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const SORT_FN = {
    value:         (a, b) => b.value - a.value,
    pnl_pct:       (a, b) => b.pnl_pct - a.pnl_pct,
    purchase_date: (a, b) => (a.purchase_date ?? '').localeCompare(b.purchase_date ?? ''),
  }

  const sortedHoldings = sortKey
    ? [...holdings].sort((a, b) => {
        const cmp = SORT_FN[sortKey]?.(a, b) ?? 0
        return sortDir === 'desc' ? cmp : -cmp
      })
    : holdings

  function SortIcon({ col }) {
    if (sortKey !== col) return <span className="text-gray-300 dark:text-gray-600 ml-1">↕</span>
    return <span className="ml-1">{sortDir === 'desc' ? '↓' : '↑'}</span>
  }

  const periodChangePct = chartData.length >= 2
    ? ((chartData.at(-1).Value - chartData[0].Value) / chartData[0].Value * 100)
    : null
  const isUp = periodChangePct === null || periodChangePct >= 0

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-400 dark:text-gray-500">
        {t('dashboard.breadcrumb')} <span className="mx-1">›</span>
        <span className="text-gray-700 dark:text-gray-300">{t('dashboard.investments')}</span>
      </p>

      <div className="flex gap-6 items-start">
        <div className="flex-1 min-w-0 bg-white dark:bg-gray-900 rounded-xl p-6 space-y-4">
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
                  {showCapital ? fmtCurrency(total) : MASKED_VALUE}
                </span>
                {periodChangePct !== null && (
                  <span className={`text-sm font-medium mb-1 ${isUp ? 'text-emerald-500' : 'text-red-500'}`}>
                    {isUp ? '↗' : '↘'} {isUp ? '+' : ''}{periodChangePct.toFixed(2)}%
                  </span>
                )}
              </div>
            )}
          </div>

          {holdings.length > 0 ? (
            <>
              <p className="text-xs text-gray-400 text-right">{t('dashboard.chartIncludesDividends')}</p>
              <div className="flex gap-1 justify-end">
                {PERIOD_OPTIONS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => handlePeriod(p, holdings)}
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
                const CustomTooltip = ({ payload, active }) => {
                  if (!active || !payload?.length) return null
                  const raw = payload[0]?.payload?.rawDate
                  const dateLabel = raw
                    ? new Date(raw).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                    : payload[0]?.payload?.date
                  return (
                    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg px-4 py-3">
                      <p className="text-xs text-gray-400 mb-1">{dateLabel}</p>
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
                <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className={`h-2 rounded-full ${{emerald:'bg-emerald-500',yellow:'bg-yellow-500',orange:'bg-orange-500',red:'bg-red-500'}[riskColor(user.risk_score)]}`}
                    style={{ width: `${(user.risk_score / 68) * 100}%` }}
                  />
                </div>
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
                <span className="font-medium">{aggregatedHoldings.length}</span>
              </div>
              {(() => {
                const best = [...aggregatedHoldings].sort((a, b) => b.pnl_pct - a.pnl_pct)[0]
                const worst = [...aggregatedHoldings].sort((a, b) => a.pnl_pct - b.pnl_pct)[0]
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 text-xs text-gray-400">
                  <th className="text-left pb-2 font-medium pr-4 whitespace-nowrap">{t('portfolio.asset')}</th>
                  <th className="text-right pb-2 font-medium pr-4 whitespace-nowrap">{t('portfolio.quantity')}</th>
                  <th className="text-right pb-2 font-medium pr-4 whitespace-nowrap">{t('portfolio.avgBuyPrice')}</th>
                  <th className="text-right pb-2 font-medium pr-4 whitespace-nowrap">{t('portfolio.currentPrice')}</th>
                  <th className="text-right pb-2 font-medium pr-4 whitespace-nowrap">
                    <button onClick={() => handleSort('value')} className="flex items-center gap-0.5 ml-auto hover:text-gray-700 dark:hover:text-gray-200">
                      {t('portfolio.currentValue')} <SortIcon col="value" />
                    </button>
                  </th>
                  <th className="text-right pb-2 font-medium pr-4 whitespace-nowrap">
                    <button onClick={() => handleSort('pnl_pct')} className="flex items-center gap-0.5 ml-auto hover:text-gray-700 dark:hover:text-gray-200">
                      {t('portfolio.pl')} <SortIcon col="pnl_pct" />
                    </button>
                  </th>
                  <th className="text-right pb-2 font-medium whitespace-nowrap">
                    <button onClick={() => handleSort('purchase_date')} className="flex items-center gap-0.5 ml-auto hover:text-gray-700 dark:hover:text-gray-200">
                      {t('portfolio.buyDate')} <SortIcon col="purchase_date" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedHoldings.map((h) => {
                  const pnlAbs = h.value - h.avg_buy_price * h.shares
                  return (
                    <tr key={h.id} className="border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs font-bold text-gray-600 dark:text-gray-400 shrink-0">
                            {h.ticker.slice(0, 2)}
                          </div>
                          <div>
                            <Link
                              to={`/market?ticker=${h.ticker}`}
                              className="font-semibold hover:text-blue-500 transition-colors"
                            >
                              {h.ticker}
                            </Link>
                            {h.asset_name && <p className="text-xs text-gray-400 truncate max-w-[160px]">{h.asset_name}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-gray-600 dark:text-gray-400">
                        {h.shares}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-gray-500 dark:text-gray-400">
                        {fmtCurrency(h.avg_buy_price, h.currency, 2)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-gray-500 dark:text-gray-400">
                        {h.current_price != null ? fmtCurrency(h.current_price, h.currency, 2) : '–'}
                        {h.price_stale && <span title="Prezzo non aggiornato" className="ml-1 text-amber-400">⚠</span>}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums font-medium">
                        {showCapital ? fmtCurrency(h.value) : MASKED_VALUE}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <p className={`tabular-nums font-medium ${pnlAbs >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          {showCapital ? <>{pnlAbs >= 0 ? '+' : ''}{fmtCurrency(pnlAbs)}</> : MASKED_VALUE}
                        </p>
                        <p className={`text-xs mt-0.5 ${h.pnl_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {h.pnl_pct >= 0 ? '↗' : '↘'} {h.pnl_pct >= 0 ? '+' : ''}{h.pnl_pct.toFixed(2)}%
                        </p>
                      </td>
                      <td className="py-3 text-right text-gray-400 tabular-nums text-xs">
                        {fmtDate(h.purchase_date)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showTxModal && portfolioList.length > 0 && (
        <AddTransactionModal
          portfolioList={portfolioList}
          defaultPortfolioId={activeTab !== 'aggregated' ? activeTab : portfolioList[0]?.id}
          onClose={() => setShowTxModal(false)}
          onAdded={refresh}
        />
      )}

      {showSettings && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowSettings(false); setSettingsDetail(null) } }}
        >
          <div className="bg-white dark:bg-gray-900 rounded-2xl w-[480px] shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                {settingsDetail && (
                  <button onClick={() => setSettingsDetail(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mr-1">←</button>
                )}
                <h3 className="font-bold text-lg">
                  {settingsDetail ? settingsDetail.name : t('dashboard.netWorthSettings')}
                </h3>
              </div>
              <button onClick={() => { setShowSettings(false); setSettingsDetail(null) }} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-4">
              {!settingsDetail ? (
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('dashboard.yourAccounts')}</p>
                  {portfolioList.length === 0 && (
                    <p className="text-sm text-gray-400 py-4 text-center">{t('dashboard.noPortfolios')}</p>
                  )}
                  {portfolioList.map((p) => (
                    <button key={p.id} onClick={() => setSettingsDetail(p)} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400 shrink-0">$</div>
                      <span className="flex-1 text-left font-medium text-sm">{p.name}</span>
                      {!p.include_in_aggregated && <span className="text-xs text-gray-400 mr-1">{t('dashboard.excluded')}</span>}
                      <span className="text-gray-300 dark:text-gray-600">›</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="space-y-4 py-2">
                  <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-800">
                    <div>
                      <p className="text-sm font-medium">{t('dashboard.includeInAggregated')}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{t('dashboard.includeDesc')}</p>
                    </div>
                    <button
                      onClick={() => handleToggleAggregated(settingsDetail, !settingsDetail.include_in_aggregated)}
                      className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${settingsDetail.include_in_aggregated ? 'bg-gray-900 dark:bg-gray-100' : 'bg-gray-200 dark:bg-gray-700'}`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full shadow transition-all duration-200 ${settingsDetail.include_in_aggregated ? 'left-6 bg-white dark:bg-gray-900' : 'left-0.5 bg-white dark:bg-gray-400'}`} />
                    </button>
                  </div>
                  <button onClick={() => handleDeletePortfolio(settingsDetail)} className="w-full flex items-center gap-2 py-3 text-sm text-red-500 hover:text-red-600 transition-colors">
                    <span>🗑</span>
                    <span>{t('dashboard.deletePortfolio')} "{settingsDetail.name}"</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={(e) => { if (e.target === e.currentTarget) setShowAddModal(false) }}>
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
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">{t('dashboard.cancel')}</button>
                <button type="submit" disabled={addingPortfolio} className="px-4 py-2 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:opacity-90 disabled:opacity-50">
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
