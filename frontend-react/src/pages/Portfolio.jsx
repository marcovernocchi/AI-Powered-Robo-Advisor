import { useEffect, useState } from 'react'
import {
  Card, Title, Text, Button, Badge, TextInput, NumberInput,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  Flex,
} from '@tremor/react'
import { getPortfolio, addHolding, deleteHolding, optimizePortfolio } from '../api/client'

export default function Portfolio() {
  const [portfolio, setPortfolio] = useState(null)
  const [loading, setLoading] = useState(true)
  const [ticker, setTicker] = useState('')
  const [shares, setShares] = useState('')
  const [avgPrice, setAvgPrice] = useState('')
  const [addError, setAddError] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [optimization, setOptimization] = useState(null)
  const [optLoading, setOptLoading] = useState(false)
  const [optError, setOptError] = useState('')

  async function fetchPortfolio() {
    try {
      const data = await getPortfolio()
      setPortfolio(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPortfolio()
  }, [])

  async function handleAdd(e) {
    e.preventDefault()
    setAddError('')
    setAddLoading(true)
    try {
      await addHolding({
        ticker: ticker.toUpperCase(),
        shares: parseFloat(shares),
        avg_buy_price: parseFloat(avgPrice),
      })
      setTicker('')
      setShares('')
      setAvgPrice('')
      await fetchPortfolio()
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAddLoading(false)
    }
  }

  async function handleDelete(id) {
    try {
      await deleteHolding(id)
      await fetchPortfolio()
    } catch (e) {
      console.error(e)
    }
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

  if (loading) {
    return <p className="text-gray-500 dark:text-gray-400">Loading...</p>
  }

  const holdings = portfolio?.holdings ?? []
  const total = portfolio?.total_value ?? 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Portfolio</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Manage your holdings
        </p>
      </div>

      {/* Holdings table */}
      <Card className="dark:bg-gray-900 dark:border-gray-800">
        <Flex>
          <Title>Holdings</Title>
          <Text className="text-gray-400">
            Total: ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </Text>
        </Flex>

        {holdings.length > 0 ? (
          <Table className="mt-4">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Ticker</TableHeaderCell>
                <TableHeaderCell>Shares</TableHeaderCell>
                <TableHeaderCell>Avg Buy</TableHeaderCell>
                <TableHeaderCell>Current</TableHeaderCell>
                <TableHeaderCell>Value</TableHeaderCell>
                <TableHeaderCell>P&L</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {holdings.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="font-semibold">{h.ticker}</TableCell>
                  <TableCell>{h.shares}</TableCell>
                  <TableCell>${h.avg_buy_price.toFixed(2)}</TableCell>
                  <TableCell>${h.current_price.toFixed(2)}</TableCell>
                  <TableCell>${h.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell>
                    <Badge color={h.pnl_pct >= 0 ? 'emerald' : 'red'}>
                      {h.pnl_pct >= 0 ? '+' : ''}{h.pnl_pct.toFixed(2)}%
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => handleDelete(h.id)}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Text className="mt-4 text-gray-400 text-center py-6">No holdings yet.</Text>
        )}
      </Card>

      {/* Add holding */}
      <Card className="dark:bg-gray-900 dark:border-gray-800">
        <Title>Add Holding</Title>
        <form onSubmit={handleAdd} className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <TextInput
            placeholder="Ticker (e.g. AAPL)"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            required
          />
          <NumberInput
            placeholder="Shares"
            value={shares}
            onValueChange={(v) => setShares(v)}
            min={0}
            required
          />
          <NumberInput
            placeholder="Avg buy price ($)"
            value={avgPrice}
            onValueChange={(v) => setAvgPrice(v)}
            min={0}
            required
          />
          <Button type="submit" loading={addLoading}>
            Add
          </Button>
        </form>
        {addError && <p className="mt-2 text-sm text-red-500">{addError}</p>}
      </Card>

      {/* Optimize */}
      {holdings.length >= 2 && (
        <Card className="dark:bg-gray-900 dark:border-gray-800">
          <Flex>
            <div>
              <Title>Portfolio Optimization</Title>
              <Text className="text-gray-400">
                Mean-variance optimization based on your risk profile
              </Text>
            </div>
            <Button variant="secondary" onClick={handleOptimize} loading={optLoading}>
              Optimize
            </Button>
          </Flex>

          {optError && <p className="mt-3 text-sm text-red-500">{optError}</p>}

          {optimization && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
                  <Text className="text-xs text-gray-400">Expected Return</Text>
                  <p className="font-bold text-emerald-500">
                    {(optimization.expected_return * 100).toFixed(2)}%
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
                  <Text className="text-xs text-gray-400">Volatility</Text>
                  <p className="font-bold text-orange-500">
                    {(optimization.volatility * 100).toFixed(2)}%
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
                  <Text className="text-xs text-gray-400">Sharpe Ratio</Text>
                  <p className="font-bold">{optimization.sharpe_ratio?.toFixed(2) ?? '–'}</p>
                </div>
              </div>

              <div>
                <Text className="font-medium mb-2">Suggested Weights</Text>
                <div className="space-y-1">
                  {Object.entries(optimization.weights ?? {}).map(([t, w]) => (
                    <Flex key={t} className="gap-3">
                      <Text className="w-16 font-semibold">{t}</Text>
                      <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full"
                          style={{ width: `${(w * 100).toFixed(1)}%` }}
                        />
                      </div>
                      <Text className="w-12 text-right">{(w * 100).toFixed(1)}%</Text>
                    </Flex>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
