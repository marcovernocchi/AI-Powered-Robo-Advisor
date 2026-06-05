import { useState } from 'react'
import { updateHolding } from '../api/client'
import { useLang } from '../context/LangContext'

export default function EditHoldingModal({ holding, onClose, onSaved }) {
  const { t } = useLang()
  const [shares, setShares]       = useState(String(holding.shares))
  const [price, setPrice]         = useState(String(holding.avg_buy_price))
  const [date, setDate]           = useState(holding.purchase_date ?? '')
  const [fees, setFees]           = useState(String(holding.fees ?? ''))
  const [notes, setNotes]         = useState(holding.notes ?? '')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  const fieldClass = "w-full px-4 py-3 bg-gray-100 dark:bg-gray-800 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600"
  const labelClass = "block text-sm text-gray-500 dark:text-gray-400 mb-1.5"

  async function submit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await updateHolding(holding.id, {
        shares: parseFloat(shares),
        avg_buy_price: parseFloat(price),
        purchase_date: date || null,
        fees: fees ? parseFloat(fees) : 0,
        notes: notes || null,
      })
      onSaved()
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
            <h2 className="text-2xl font-bold">{t('editModal.title')}</h2>
            <p className="text-sm text-gray-400 mt-0.5">{holding.ticker}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none mt-0.5">×</button>
        </div>

        <form onSubmit={submit} className="px-6 pb-6 space-y-4">
          <div>
            <label className={labelClass}>{t('modal.quantity')}</label>
            <input
              type="number" value={shares} onChange={(e) => setShares(e.target.value)}
              min="0" step="any" required className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t('modal.purchasePrice')}</label>
            <input
              type="number" value={price} onChange={(e) => setPrice(e.target.value)}
              min="0" step="any" required className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t('modal.transactionDate')}</label>
            <input
              type="date" value={date}
              max={new Date().toISOString().split('T')[0]}
              onChange={(e) => setDate(e.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t('modal.fees')} <span className="text-gray-300 dark:text-gray-600">{t('modal.optional')}</span></label>
            <input
              type="number" value={fees} onChange={(e) => setFees(e.target.value)}
              min="0" step="any" className={fieldClass}
            />
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
            {loading ? t('editModal.saving') : t('editModal.save')}
          </button>
        </form>
      </div>
    </div>
  )
}
