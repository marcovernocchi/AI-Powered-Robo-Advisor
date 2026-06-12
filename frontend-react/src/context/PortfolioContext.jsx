import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { getPortfolio, getPortfolioById, getPortfolioList, getMarketHistory, getDividends } from '../api/client'

const PortfolioContext = createContext(null)

export const PERIOD_OPTIONS = [
  { label: '1W',  api: '5d',  months: null, days: 7 },
  { label: '1M',  api: '1mo', months: 1,    days: null },
  { label: 'YTD', api: 'ytd', months: null, days: null },
  { label: '1Y',  api: '1y',  months: 12,   days: null },
  { label: '5Y',  api: '5y',  months: 60,   days: null },
  { label: 'MAX', api: 'max', months: null, days: null },
]

// Per-combination cache: processed chart series ready to render
const _chartCache = new Map()
const _CHART_TTL_MS = { '5d': 30, '1mo': 30, '3mo': 120, '6mo': 120, 'ytd': 120, '1y': 240, '2y': 240, '5y': 480, 'max': 480 }

// Per-ticker raw data cache: populated by the aggregated fetch, reused by individual portfolios
const _rawPriceCache = new Map()  // key: "TICKER-period"  → { rows, expiresAt }
const _rawDivCache   = new Map()  // key: "TICKER"         → { dividends, expiresAt }

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

async function fetchRawPrice(ticker, periodApi, ttlMin) {
  const key = `${ticker}-${periodApi}`
  const hit = _rawPriceCache.get(key)
  if (hit && Date.now() < hit.expiresAt) return hit.rows
  const rows = await getMarketHistory(ticker, periodApi)
    .then((r) => r.data)
    .catch(() => [])
  _rawPriceCache.set(key, { rows, expiresAt: Date.now() + ttlMin * 60 * 1000 })
  return rows
}

async function fetchRawDiv(ticker, ttlMin) {
  const hit = _rawDivCache.get(ticker)
  if (hit && Date.now() < hit.expiresAt) return hit.dividends
  const dividends = await getDividends(ticker)
    .then((r) => r.dividends)
    .catch(() => [])
  _rawDivCache.set(ticker, { dividends, expiresAt: Date.now() + ttlMin * 60 * 1000 })
  return dividends
}

async function buildChartData(holdings, period) {
  if (!holdings?.length) return []

  const cacheKey = `${holdings.map(h => h.ticker).sort().join(',')}-${period.api}`
  const cached = _chartCache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) return cached.data

  const ttlMin = _CHART_TTL_MS[period.api] ?? 120

  const [histories, dividendData] = await Promise.all([
    Promise.all(holdings.map(async (h) => ({
      shares: h.shares, value: h.value, purchaseDate: h.purchase_date ?? null,
      data: await fetchRawPrice(h.ticker, period.api, ttlMin),
    }))),
    Promise.all(holdings.map(async (h) => ({
      shares: h.shares, purchaseDate: h.purchase_date,
      dividends: await fetchRawDiv(h.ticker, ttlMin),
    }))),
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

  const result = thinData(sorted, period).map((d) => ({ date: formatDate(d.rawDate, period), rawDate: d.rawDate, Value: d.Value }))
  _chartCache.set(cacheKey, { data: result, expiresAt: Date.now() + ttlMin * 60 * 1000 })
  return result
}

export function PortfolioProvider({ children }) {
  const [portfolio, setPortfolio]           = useState(null)
  const [portfolioList, setPortfolioList]   = useState([])
  const [chartData, setChartData]           = useState([])
  const [activeTab, setActiveTab]           = useState('aggregated')
  const [selectedPeriod, setSelectedPeriod] = useState(PERIOD_OPTIONS[3])
  const [loading, setLoading]               = useState(true)
  const [chartLoading, setChartLoading]     = useState(false)

  const fetchAll = useCallback(async (tab, period) => {
    const t = tab ?? 'aggregated'
    const p = period ?? PERIOD_OPTIONS[3]
    try {
      const [data, list] = await Promise.all([
        t === 'aggregated' ? getPortfolio() : getPortfolioById(t),
        getPortfolioList(),
      ])
      setPortfolio(data)
      setPortfolioList(list)
      if (data.holdings?.length) {
        setChartLoading(true)
        setChartData([])
        try {
          const chart = await buildChartData(data.holdings, p)
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
  }, [])

  // Fetches once on mount — data stays alive for the whole session
  useEffect(() => { fetchAll('aggregated', PERIOD_OPTIONS[3]) }, [])

  const handleTabChange = useCallback(async (tab) => {
    if (tab === activeTab) return
    setActiveTab(tab)
    await fetchAll(tab, selectedPeriod)
  }, [activeTab, selectedPeriod, fetchAll])

  const handlePeriod = useCallback(async (period, holdings) => {
    if (period.label === selectedPeriod.label) return
    setSelectedPeriod(period)
    if (!holdings?.length) return
    setChartLoading(true)
    try {
      const chart = await buildChartData(holdings, period)
      setChartData(chart)
    } finally {
      setChartLoading(false)
    }
  }, [selectedPeriod])

  // Call after any mutation (add/edit/delete holding) to refresh with fresh data
  const refresh = useCallback(() => fetchAll(activeTab, selectedPeriod), [activeTab, selectedPeriod, fetchAll])

  return (
    <PortfolioContext.Provider value={{
      portfolio, portfolioList, chartData, activeTab, selectedPeriod,
      loading, chartLoading,
      handleTabChange, handlePeriod, refresh, fetchAll,
    }}>
      {children}
    </PortfolioContext.Provider>
  )
}

export function usePortfolio() {
  const ctx = useContext(PortfolioContext)
  if (!ctx) throw new Error('usePortfolio must be used inside PortfolioProvider')
  return ctx
}
