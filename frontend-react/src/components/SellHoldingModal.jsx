import { useState } from 'react'
import { updateHolding, deleteHolding, addHolding } from '../api/client'
import { useLang } from '../context/LangContext'
import NumberInput from './NumberInput'

function today() {
  return new Date().toISOString().split('T')[0]
}

export default function SellHoldingModal({ holding, onClose, onSold }) {
  const { t } = useLang()
  const [quantity, setQuantity] = useState(String(holding.shares))
  const [price, setPrice]       = useState(String(holding.current_price ?? holding.avg_buy_price))
  const [date, setDate]         = useState(today())
  const [fees, setFees]         = useState('')
  const [notes, setNotes]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const fieldClass = "w-full px-4 py-3 bg-gray-100 dark:bg-gray-800 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600"
  const labelClass = "block text-sm text-gray-500 dark:text-gray-400 mb-1.5"

  async function submit(e) {
    e.preventDefault()
    const qty = parseFloat(quantity)
    if (qty > holding.shares) {
      setError(t('sellModal.maxError'))
      return
    }
    setError('')
    setLoading(true)
    try {
      const feesVal = fees ? parseFloat(fees) : 0
      const proceeds = qty * parseFloat(price) - feesVal
      const remaining = holding.shares - qty
      if (remaining <= 1e-9) {
        await deleteHolding(holding.id)
      } else {
        await updateHolding(holding.id, { shares: remaining })
      }
      await addHolding({
        ticker: holding.currency,
        asset_name: holding.currency,
        asset_type: 'cash',
        shares: proceeds,
        avg_buy_price: 1,
        currency: holding.currency,
        purchase_date: date || null,
        fees: feesVal,
        notes: notes || null,
        portfolio_id: holding.portfolio_id,
      })
      onSold()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-start justify-between px-6 pt-6 pb-4">
          <div>
            <h2 className="text-2xl font-bold">{t('sellModal.title')}</h2>
            <p className="text-sm text-gray-400 mt-0.5">{holding.ticker}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none mt-0.5">×</button>
        </div>

        <form onSubmit={submit} className="px-6 pb-6 space-y-4">
          <div>
            <label className={labelClass}>
              {t('modal.quantity')}
              <span className="text-gray-300 dark:text-gray-600 ml-1">({t('sellModal.available', { shares: holding.shares })})</span>
            </label>
            <NumberInput value={quantity} onChange={setQuantity} min={0.000001} max={holding.shares} step="any" fallback={holding.shares} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>{t('modal.purchasePrice')}</label>
            <NumberInput value={price} onChange={setPrice} min={0.0001} max={1000000} step="any" fallback={0} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>{t('modal.transactionDate')}</label>
            <input
              type="date" value={date}
              max={today()}
              onChange={(e) => setDate(e.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t('modal.fees')} <span className="text-gray-300 dark:text-gray-600">{t('modal.optional')}</span></label>
            <NumberInput value={fees} onChange={setFees} min={0} max={10000} step="any" fallback={0} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>{t('modal.description')} <span className="text-gray-300 dark:text-gray-600">{t('modal.optional')}</span></label>
            <textarea
              value={notes} onChange={(e) => setNotes(e.target.value)}
              rows={2} className={`${fieldClass} resize-none`}
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit" disabled={loading}
            className="w-full py-3.5 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {loading ? t('sellModal.selling') : t('sellModal.confirm')}
          </button>
        </form>
      </div>
    </div>
  )
}
