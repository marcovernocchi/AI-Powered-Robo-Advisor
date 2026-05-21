import { useEffect, useState } from 'react'
import {
  Card, Title, Metric, Text, AreaChart, Badge,
  Grid, Col, Flex, ProgressBar,
} from '@tremor/react'
import { getPortfolio, getMarketHistory } from '../api/client'
import { useAuth } from '../context/AuthContext'

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

export default function Dashboard() {
  const { user } = useAuth()
  const [portfolio, setPortfolio] = useState(null)
  const [chartData, setChartData] = useState([])
  const [showCapital, setShowCapital] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getPortfolio()
      .then((data) => {
        setPortfolio(data)
        return data
      })
      .then(async (data) => {
        if (!data.holdings?.length) return
        const histories = await Promise.all(
          data.holdings.map((h) =>
            getMarketHistory(h.ticker, '1y').then((r) => ({
              ticker: h.ticker,
              shares: h.shares,
              data: r.data,
            }))
          )
        )
        const byDate = {}
        histories.forEach(({ ticker, shares, data: rows }) => {
          rows.forEach((row) => {
            const date = row.Date?.split('T')[0] ?? row.Datetime?.split('T')[0]
            const price = row.Close
            if (!date || price == null) return
            byDate[date] = (byDate[date] ?? 0) + shares * price
          })
        })
        const sorted = Object.entries(byDate)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, value]) => ({ date, Value: parseFloat(value.toFixed(2)) }))
        setChartData(sorted)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <p className="text-gray-500 dark:text-gray-400">Loading...</p>
  }

  const total = portfolio?.total_value ?? 0
  const holdings = portfolio?.holdings ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Welcome back, {user?.name}
        </p>
      </div>

      <Grid numItemsMd={3} className="gap-4">
        {/* Portfolio value */}
        <Card className="dark:bg-gray-900 dark:border-gray-800">
          <Text>Total Portfolio Value</Text>
          <Flex className="items-end gap-3 mt-1">
            <Metric>
              {showCapital ? `$${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '● ● ● ● ●'}
            </Metric>
            <button
              onClick={() => setShowCapital((v) => !v)}
              className="mb-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 underline"
            >
              {showCapital ? 'hide' : 'show'}
            </button>
          </Flex>
        </Card>

        {/* Holdings count */}
        <Card className="dark:bg-gray-900 dark:border-gray-800">
          <Text>Holdings</Text>
          <Metric>{holdings.length}</Metric>
        </Card>

        {/* Risk profile */}
        <Card className="dark:bg-gray-900 dark:border-gray-800">
          <Text>Risk Profile</Text>
          {user?.risk_score ? (
            <>
              <Metric>{user.risk_score}/68</Metric>
              <Badge color={riskColor(user.risk_score)} className="mt-2">
                {riskLabel(user.risk_score)}
              </Badge>
              <ProgressBar value={(user.risk_score / 68) * 100} color={riskColor(user.risk_score)} className="mt-3" />
            </>
          ) : (
            <Text className="mt-2 text-gray-400">Not set — go to AI Advisor</Text>
          )}
        </Card>
      </Grid>

      {/* Portfolio chart */}
      {chartData.length > 0 && (
        <Card className="dark:bg-gray-900 dark:border-gray-800">
          <Title>Portfolio Value (1Y)</Title>
          <AreaChart
            className="mt-4 h-64"
            data={chartData}
            index="date"
            categories={['Value']}
            colors={['blue']}
            valueFormatter={(v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
            showLegend={false}
            showXAxis
            showYAxis
            curveType="monotone"
          />
        </Card>
      )}

      {/* Holdings list */}
      {holdings.length > 0 && (
        <Card className="dark:bg-gray-900 dark:border-gray-800">
          <Title>Holdings</Title>
          <div className="mt-4 space-y-2">
            {holdings.map((h) => (
              <Flex key={h.id} className="py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                <div>
                  <Text className="font-semibold">{h.ticker}</Text>
                  <Text className="text-xs text-gray-400">{h.shares} shares</Text>
                </div>
                <div className="text-right">
                  <Text className="font-medium">${h.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                  <Badge color={h.pnl_pct >= 0 ? 'emerald' : 'red'} size="xs">
                    {h.pnl_pct >= 0 ? '+' : ''}{h.pnl_pct.toFixed(2)}%
                  </Badge>
                </div>
              </Flex>
            ))}
          </div>
        </Card>
      )}

      {holdings.length === 0 && (
        <Card className="dark:bg-gray-900 dark:border-gray-800">
          <Text className="text-center text-gray-400 py-8">
            No holdings yet — add some in the Portfolio section.
          </Text>
        </Card>
      )}
    </div>
  )
}
