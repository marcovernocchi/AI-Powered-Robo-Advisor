import { useEffect, useState } from 'react'
import {
  Card, Title, Text, Button, Badge,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  Flex,
} from '@tremor/react'
import { getPortfolio, getPortfolioList, deleteHolding, optimizePortfolio } from '../api/client'
import AddTransactionModal from '../components/AddTransactionModal'
import EditHoldingModal from '../components/EditHoldingModal'
import ImportModal from '../components/ImportModal'
import { useLang } from '../context/LangContext'

export default function Portfolio() {
  const { t } = useLang()
  const [portfolio, setPortfolio]       = useState(null)
  const [portfolioList, setPortfolioList] = useState([])
  const [loading, setLoading]           = useState(true)
  const [showModal, setShowModal]       = useState(false)
  const [showImport, setShowImport]     = useState(false)
  const [editingHolding, setEditingHolding] = useState(null)
  const [optimization, setOptimization] = useState(null)
  const [optLoading, setOptLoading]     = useState(false)
  const [optError, setOptError]         = useState('')
  const [sortKey, setSortKey]           = useState(null)
  const [sortDir, setSortDir]           = useState('desc')

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

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

  const firstPortfolioId = portfolioList[0]?.id

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('portfolio.title')}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{t('portfolio.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {t('portfolio.importFile')}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {t('portfolio.addTransaction')}
          </button>
        </div>
      </div>

      {/* Holdings table */}
      <Card className="ring-0 border-0 dark:bg-gray-900">
        <Flex>
          <Title>{t('portfolio.holdings')}</Title>
          <Text className="text-gray-400 text-sm">{fmtCurrency(total)}</Text>
        </Flex>

        {holdings.length > 0 ? (
          <Table className="mt-4">
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
                    <div className="flex gap-3">
                      <button
                        onClick={() => setEditingHolding(h)}
                        className="text-xs text-blue-400 hover:text-blue-600"
                      >
                        {t('portfolio.edit')}
                      </button>
                      <button
                        onClick={() => handleDelete(h.id)}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        {t('portfolio.remove')}
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Text className="mt-4 text-gray-400 text-center py-6">{t('portfolio.noHoldings')}</Text>
        )}
      </Card>

      {/* Optimize */}
      {holdings.length >= 2 && firstPortfolioId && (
        <Card className="ring-0 border-0 dark:bg-gray-900">
          <Flex>
            <div>
              <Title>{t('portfolio.optimization')}</Title>
              <Text className="text-gray-400">{t('portfolio.optimizationDesc')}</Text>
            </div>
            <Button variant="secondary" onClick={() => handleOptimize(firstPortfolioId)} loading={optLoading}>
              {t('portfolio.optimize')}
            </Button>
          </Flex>

          {optError && <p className="mt-3 text-sm text-red-500">{optError}</p>}

          {optimization && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
                  <Text className="text-xs text-gray-400">{t('portfolio.expectedReturn')}</Text>
                  <p className="font-bold text-emerald-500">{(optimization.expected_return * 100).toFixed(2)}%</p>
                </div>
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
                  <Text className="text-xs text-gray-400">{t('portfolio.volatility')}</Text>
                  <p className="font-bold text-orange-500">{(optimization.volatility * 100).toFixed(2)}%</p>
                </div>
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
                  <Text className="text-xs text-gray-400">{t('portfolio.sharpeRatio')}</Text>
                  <p className="font-bold">{optimization.sharpe_ratio?.toFixed(2) ?? '–'}</p>
                </div>
              </div>
              <div>
                <Text className="font-medium mb-2">{t('portfolio.suggestedWeights')}</Text>
                <div className="space-y-1">
                  {Object.entries(optimization.weights ?? {}).map(([ticker, w]) => (
                    <Flex key={ticker} className="gap-3">
                      <Text className="w-16 font-semibold">{ticker}</Text>
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

      {showImport && (
        <ImportModal
          portfolioList={portfolioList}
          defaultPortfolioId={firstPortfolioId}
          onClose={() => setShowImport(false)}
          onImported={fetchAll}
        />
      )}

      {editingHolding && (
        <EditHoldingModal
          holding={editingHolding}
          onClose={() => setEditingHolding(null)}
          onSaved={fetchAll}
        />
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
