import { useState } from 'react'
import {
  Card, Title, Text, Button, Badge, TextInput, AreaChart,
  Grid,
} from '@tremor/react'
import { getMarketHistory, getStockInfo, getStockPrice } from '../api/client'
import { useLang } from '../context/LangContext'

const PERIODS = ['1mo', '3mo', '6mo', '1y', '2y', '5y']

function formatDate(dateStr, period) {
  const d = new Date(dateStr)
  if (period === '1mo' || period === '3mo') {
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
}

export default function Market() {
  const { t } = useLang()
  const [input, setInput] = useState('')
  const [ticker, setTicker] = useState('')
  const [info, setInfo] = useState(null)
  const [price, setPrice] = useState(null)
  const [chartData, setChartData] = useState([])
  const [period, setPeriod] = useState('1y')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSearch(e) {
    e.preventDefault()
    const sym = input.trim().toUpperCase()
    if (!sym) return
    setError('')
    setLoading(true)
    setInfo(null)
    setPrice(null)
    setChartData([])
    setTicker(sym)
    try {
      const [infoData, priceData, histData] = await Promise.all([
        getStockInfo(sym),
        getStockPrice(sym),
        getMarketHistory(sym, period),
      ])
      setInfo(infoData)
      setPrice(priceData.price)
      setChartData(
        histData.data
          .map((row) => ({
            date: formatDate((row.Date ?? row.Datetime ?? '').split('T')[0], period),
            Price: parseFloat((row.Close ?? 0).toFixed(2)),
          }))
          .filter((r) => r.date)
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handlePeriodChange(p) {
    if (!ticker) return
    setPeriod(p)
    try {
      const histData = await getMarketHistory(ticker, p)
      setChartData(
        histData.data
          .map((row) => ({
            date: formatDate((row.Date ?? row.Datetime ?? '').split('T')[0], period),
            Price: parseFloat((row.Close ?? 0).toFixed(2)),
          }))
          .filter((r) => r.date)
      )
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('market.title')}</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          {t('market.subtitle')}
        </p>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-3">
        <TextInput
          placeholder={t('market.placeholder')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" loading={loading}>
          {t('market.search')}
        </Button>
      </form>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Stock info */}
      {info && (
        <Grid numItemsMd={2} className="gap-4">
          <Card className="ring-0 border-0 dark:bg-gray-900">
            <div className="flex items-start justify-between">
              <div>
                <Title>{info.longName ?? ticker}</Title>
                <Text className="text-gray-400">{ticker}</Text>
              </div>
              {price != null && (
                <div className="text-right">
                  <p className="text-2xl font-bold">${price.toFixed(2)}</p>
                </div>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {info.sector && <Badge color="blue">{info.sector}</Badge>}
              {info.industry && <Badge color="gray">{info.industry}</Badge>}
              {info.country && <Badge color="gray">{info.country}</Badge>}
            </div>
            {info.description && (
              <p className="mt-3 text-xs text-gray-400 leading-relaxed">
                {info.description.length > 300
                  ? `${info.description.slice(0, 300)}…`
                  : info.description}
              </p>
            )}
          </Card>

          <Card className="ring-0 border-0 dark:bg-gray-900">
            <Title>{t('market.keyMetrics')}</Title>
            <div className="mt-3 space-y-2 text-sm">
              {[
                [t('market.marketCap'), info.market_cap ? `$${(info.market_cap / 1e9).toFixed(2)}B` : null],
                [t('market.peRatio'), info.pe_ratio?.toFixed(2) ?? null],
                [t('market.weekHigh'), info['52w_high'] ? `$${info['52w_high'].toFixed(2)}` : null],
                [t('market.weekLow'), info['52w_low'] ? `$${info['52w_low'].toFixed(2)}` : null],
                [t('market.dividendYield'), info.dividend_yield != null ? `${(info.dividend_yield * 100).toFixed(2)}%` : null],
                [t('market.beta'), info.beta?.toFixed(2) ?? null],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-gray-400">{label}</span>
                  <span className={`font-medium ${!value ? 'text-gray-300 dark:text-gray-400' : ''}`}>
                    {value ?? 'N/A'}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </Grid>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
        <Card className="ring-0 border-0 dark:bg-gray-900">
          <div className="flex items-center justify-between mb-4">
            <Title>{ticker} {t('market.priceHistory')}</Title>
            <div className="flex gap-1">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => handlePeriodChange(p)}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    period === p
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <AreaChart
            className="h-64 [&_.recharts-cartesian-axis-tick_text]:dark:fill-white [&_.recharts-cartesian-axis-tick_text]:text-xs"
            data={chartData}
            index="date"
            categories={['Price']}
            colors={['blue']}
            valueFormatter={(v) => `$${v.toFixed(2)}`}
            showLegend={false}
            curveType="monotone"
            yAxisWidth={80}
            customTooltip={({ payload, active, label }) => {
              if (!active || !payload?.length) return null
              return (
                <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg px-4 py-3">
                  <p className="text-xs text-gray-400 mb-1">{label}</p>
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100">${payload[0].value.toFixed(2)}</p>
                </div>
              )
            }}
          />
        </Card>
      )}
    </div>
  )
}
