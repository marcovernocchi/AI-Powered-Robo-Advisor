import { useState, useEffect, useRef } from 'react'
import { addHolding, searchAssets } from '../api/client'

const ASSET_TYPES = [
  { value: 'security', label: 'Security' },
  { value: 'crypto',   label: 'Crypto' },
  { value: 'bond',     label: 'Bond' },
  { value: 'cash',     label: 'Cash' },
  { value: 'commodity',label: 'Commodities' },
]

const SEARCH_PLACEHOLDER = {
  security:  'Ticker, ISIN, Stock, ETF, …',
  crypto:    'e.g. BTC-USD, ETH-USD, …',
  bond:      'Ticker, ISIN, Bond ETF, …',
  cash:      'Currency or label (e.g. EUR)',
  commodity: 'Ticker, ISIN, e.g. GLD, USO, …',
}

function today() {
  return new Date().toISOString().split('T')[0]
}

export default function AddTransactionModal({ portfolioList, defaultPortfolioId, onClose, onAdded }) {
  const [assetType, setAssetType]     = useState('security')
  const [portfolioId, setPortfolioId] = useState(defaultPortfolioId ?? portfolioList[0]?.id ?? '')
  const [txType, setTxType]           = useState('buy')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [selectedAsset, setSelectedAsset] = useState(null) // {ticker, name, exchange, type}
  const [searchOpen, setSearchOpen]   = useState(false)
  const [quantity, setQuantity]       = useState('')
  const [txDate, setTxDate]           = useState(today())
  const [price, setPrice]             = useState('')
  const [fees, setFees]               = useState('')
  const [notes, setNotes]             = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')

  const searchRef  = useRef(null)
  const debounceRef = useRef(null)

  // Close search dropdown on outside click
  useEffect(() => {
    function handle(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (searchQuery.length < 2) { setSearchResults([]); return }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchAssets(searchQuery)
        setSearchResults(results)
        setSearchOpen(true)
      } catch { setSearchResults([]) }
    }, 300)
  }, [searchQuery])

  const total = quantity && price ? (parseFloat(quantity) * parseFloat(price)).toFixed(2) : '0.00'
  const displayCurrency = portfolioList[0]?.display_currency ?? 'EUR'

  async function submit(e, addAnother = false) {
    e.preventDefault()
    if (!selectedAsset && assetType !== 'cash') {
      setError('Select an asset from the search results.')
      return
    }
    setError('')
    setLoading(true)
    try {
      await addHolding({
        ticker: selectedAsset?.ticker ?? searchQuery.toUpperCase(),
        asset_name: selectedAsset?.name ?? searchQuery,
        asset_type: assetType,
        shares: parseFloat(quantity),
        avg_buy_price: parseFloat(price),
        purchase_date: txDate || null,
        fees: fees ? parseFloat(fees) : 0,
        notes: notes || null,
        portfolio_id: portfolioId ? parseInt(portfolioId) : null,
      })
      onAdded()
      if (addAnother) {
        setSelectedAsset(null)
        setSearchQuery('')
        setQuantity('')
        setPrice('')
        setFees('')
        setNotes('')
        setTxDate(today())
      } else {
        onClose()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const fieldClass = "w-full px-4 py-3 bg-gray-100 dark:bg-gray-800 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600"
  const labelClass = "block text-sm text-gray-500 dark:text-gray-400 mb-1.5"

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md max-h-[92vh] overflow-y-auto shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4">
          <h2 className="text-2xl font-bold">Add transaction</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none mt-0.5">×</button>
        </div>

        {/* Asset type tabs */}
        <div className="flex gap-0 border-b border-gray-100 dark:border-gray-800 overflow-x-auto px-6 scrollbar-none">
          {ASSET_TYPES.map((a) => (
            <button
              key={a.value}
              onClick={() => { setAssetType(a.value); setSelectedAsset(null); setSearchQuery('') }}
              className={`px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                assetType === a.value
                  ? 'border-gray-900 dark:border-gray-100 text-gray-900 dark:text-gray-100'
                  : 'border-transparent text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>

        {/* Form */}
        <div className="px-6 py-5 space-y-4">

          {/* Portfolio */}
          <div>
            <label className={labelClass}>Portfolio</label>
            <select
              value={portfolioId}
              onChange={(e) => setPortfolioId(e.target.value)}
              className={fieldClass}
            >
              {portfolioList.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Transaction type */}
          <div>
            <label className={labelClass}>Transaction Type</label>
            <select value={txType} onChange={(e) => setTxType(e.target.value)} className={fieldClass}>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </div>

          {/* Search */}
          <div>
            <label className={labelClass}>Add Security</label>
            <div className="relative" ref={searchRef}>
              {selectedAsset ? (
                <div className="flex items-center justify-between px-4 py-3 bg-gray-100 dark:bg-gray-800 rounded-xl">
                  <div>
                    <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{selectedAsset.ticker}</span>
                    <span className="text-xs text-gray-400 ml-2">{selectedAsset.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedAsset(null); setSearchQuery('') }}
                    className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg leading-none"
                  >×</button>
                </div>
              ) : (
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
                  <input
                    type="text"
                    placeholder={SEARCH_PLACEHOLDER[assetType]}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
                    className={`${fieldClass} pl-9`}
                  />
                </div>
              )}
              {searchOpen && searchResults.length > 0 && !selectedAsset && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 max-h-52 overflow-y-auto z-10">
                  {searchResults.map((r) => (
                    <button
                      key={r.ticker}
                      type="button"
                      onClick={() => { setSelectedAsset(r); setSearchQuery(r.ticker); setSearchOpen(false) }}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 text-left transition-colors"
                    >
                      <div>
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{r.ticker}</span>
                        <span className="text-xs text-gray-400 ml-2 truncate max-w-48 inline-block align-bottom">{r.name}</span>
                      </div>
                      <span className="text-xs text-gray-400 shrink-0 ml-2">{r.exchange}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Quantity */}
          <div>
            <label className={labelClass}>Quantity</label>
            <input
              type="number"
              placeholder="e.g. 10"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              min="0"
              step="any"
              className={fieldClass}
              required
            />
          </div>

          {/* Transaction date */}
          <div>
            <label className={labelClass}>Transaction Date</label>
            <input
              type="date"
              value={txDate}
              max={today()}
              onChange={(e) => setTxDate(e.target.value)}
              className={fieldClass}
            />
          </div>

          {/* Purchase price */}
          <div>
            <label className={labelClass}>Purchase Price</label>
            <input
              type="number"
              placeholder="e.g. 150.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              min="0"
              step="any"
              className={fieldClass}
              required
            />
          </div>

          {/* Fees (optional) */}
          <div>
            <label className={labelClass}>Transaction Fees <span className="text-gray-300 dark:text-gray-600">(optional)</span></label>
            <input
              type="number"
              placeholder="e.g. 4.95"
              value={fees}
              onChange={(e) => setFees(e.target.value)}
              min="0"
              step="any"
              className={fieldClass}
            />
          </div>

          {/* Notes (optional) */}
          <div>
            <label className={labelClass}>Description <span className="text-gray-300 dark:text-gray-600">(optional)</span></label>
            <textarea
              placeholder="Add a personal note…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={`${fieldClass} resize-none`}
            />
          </div>

          {/* Total */}
          <div className="flex items-center justify-between pt-1 pb-2 border-t border-gray-100 dark:border-gray-800">
            <span className="text-sm font-semibold">Total Amount</span>
            <span className="text-lg font-bold">
              {parseFloat(total).toLocaleString('en-US', { style: 'currency', currency: displayCurrency, maximumFractionDigits: 2 })}
            </span>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {/* Buttons */}
          <button
            type="button"
            onClick={(e) => submit(e, false)}
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {loading ? 'Adding…' : 'Add transaction'}
          </button>
          <button
            type="button"
            onClick={(e) => submit(e, true)}
            disabled={loading}
            className="w-full py-3.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 font-semibold text-sm hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            Save and Add Another
          </button>
        </div>
      </div>
    </div>
  )
}
