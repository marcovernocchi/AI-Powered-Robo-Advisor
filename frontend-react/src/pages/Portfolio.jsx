import { useEffect, useState } from 'react'
import {
  Card, Title, Text, Button, Badge,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  Flex,
} from '@tremor/react'
import { getPortfolio, getPortfolioList, deleteHolding, optimizePortfolio } from '../api/client'
import AddTransactionModal from '../components/AddTransactionModal'

export default function Portfolio() {
  const [portfolio, setPortfolio]       = useState(null)
  const [portfolioList, setPortfolioList] = useState([])
  const [loading, setLoading]           = useState(true)
  const [showModal, setShowModal]       = useState(false)
  const [optimization, setOptimization] = useState(null)
  const [optLoading, setOptLoading]     = useState(false)
  const [optError, setOptError]         = useState('')

  async function fetchAll() {
    try {
      const [data, list] = await Promise.all([getPortfolio(), getPortfolioList()])
      setPortfolio(data)
      setPortfolioList(list)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [])

  async function handleDelete(id) {
    try {
      await deleteHolding(id)
      await fetchAll()
    } catch (e) { console.error(e) }
  }

  async function handleOptimize(portfolioId) {
    setOptError('')
    setOptLoading(true)
    setOptimization(null)
    try {
      const result = await optimizePortfolio(portfolioId)
      setOptimization(result)
    } catch (err) {
      setOptError(err.message)
    } finally {
      setOptLoading(false)
    }
  }

  if (loading) return <p className="text-gray-400 text-sm">Loading...</p>

  const holdings = portfolio?.holdings ?? []
  const total    = portfolio?.total_value ?? 0
  const displayCurrency = portfolio?.display_currency ?? 'USD'

  function fmtCurrency(value, currency) {
    return value.toLocaleString('en-US', {
      style: 'currency', currency: currency ?? displayCurrency, maximumFractionDigits: 2,
    })
  }

  const firstPortfolioId = portfolioList[0]?.id

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Portfolio</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Manage your holdings</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          + Add transaction
        </button>
      </div>

      {/* Holdings table */}
      <Card className="ring-0 border-0 dark:bg-gray-900">
        <Flex>
          <Title>Holdings</Title>
          <Text className="text-gray-400 text-sm">{fmtCurrency(total)}</Text>
        </Flex>

        {holdings.length > 0 ? (
          <Table className="mt-4">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Asset</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
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
                  <TableCell>
                    <div>
                      <p className="font-semibold">{h.ticker}</p>
                      {h.asset_name && <p className="text-xs text-gray-400 truncate max-w-32">{h.asset_name}</p>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-gray-400 capitalize">{h.asset_type ?? 'security'}</span>
                  </TableCell>
                  <TableCell>{h.shares}</TableCell>
                  <TableCell>{fmtCurrency(h.avg_buy_price, h.native_currency)}</TableCell>
                  <TableCell>{fmtCurrency(h.current_price, h.native_currency)}</TableCell>
                  <TableCell>{fmtCurrency(h.value)}</TableCell>
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

      {/* Optimize */}
      {holdings.length >= 2 && firstPortfolioId && (
        <Card className="ring-0 border-0 dark:bg-gray-900">
          <Flex>
            <div>
              <Title>Portfolio Optimization</Title>
              <Text className="text-gray-400">Mean-variance optimization based on your risk profile</Text>
            </div>
            <Button variant="secondary" onClick={() => handleOptimize(firstPortfolioId)} loading={optLoading}>
              Optimize
            </Button>
          </Flex>

          {optError && <p className="mt-3 text-sm text-red-500">{optError}</p>}

          {optimization && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
                  <Text className="text-xs text-gray-400">Expected Return</Text>
                  <p className="font-bold text-emerald-500">{(optimization.expected_return * 100).toFixed(2)}%</p>
                </div>
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
                  <Text className="text-xs text-gray-400">Volatility</Text>
                  <p className="font-bold text-orange-500">{(optimization.volatility * 100).toFixed(2)}%</p>
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
                        <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${(w * 100).toFixed(1)}%` }} />
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

      {showModal && (
        <AddTransactionModal
          portfolioList={portfolioList}
          defaultPortfolioId={firstPortfolioId}
          onClose={() => setShowModal(false)}
          onAdded={fetchAll}
        />
      )}
    </div>
  )
}
