import { useState, useRef } from 'react'
import { importPreview, importConfirm } from '../api/client'
import { useLang } from '../context/LangContext'

const CURRENCIES = ['USD', 'EUR', 'CHF', 'GBP', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN']

export default function ImportModal({ portfolioList, defaultPortfolioId, onClose, onImported }) {
  const { t } = useLang()
  const [portfolioId, setPortfolioId] = useState(defaultPortfolioId ?? portfolioList[0]?.id ?? '')
  const [rows, setRows]               = useState(null)
  const [currency, setCurrency]       = useState('EUR')
  const [selected, setSelected]       = useState([])
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')
  const [success, setSuccess]         = useState('')
  const [dragging, setDragging]       = useState(false)
  const inputRef = useRef(null)

  const fieldClass  = "w-full px-4 py-3 bg-gray-100 dark:bg-gray-800 rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600"
  const labelClass  = "block text-sm text-gray-500 dark:text-gray-400 mb-1.5"

  async function handleFile(file) {
    if (!file) return
    setError('')
    setRows(null)
    setLoading(true)
    try {
      const result = await importPreview(file)
      setRows(result.rows)
      setSelected(result.rows.map((_, i) => i))
      if (result.detected_currency) setCurrency(result.detected_currency)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function toggleRow(i) {
    setSelected(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])
  }

  function toggleAll() {
    setSelected(prev => prev.length === rows.length ? [] : rows.map((_, i) => i))
  }

  async function confirm() {
    setError('')
    setLoading(true)
    try {
      const toImport = rows.filter((_, i) => selected.includes(i))
      const result = await importConfirm(toImport, parseInt(portfolioId), currency)
      setSuccess(t('importModal.successMsg', { n: result.created }))
      onImported()
      setTimeout(onClose, 1500)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function fmt(val) {
    if (val == null) return '—'
    return typeof val === 'number' ? val.toLocaleString('en-US', { maximumFractionDigits: 4 }) : val
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4">
          <div>
            <h2 className="text-2xl font-bold">{t('importModal.title')}</h2>
            <p className="text-sm text-gray-400 mt-0.5">{t('importModal.subtitle')}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none mt-0.5">×</button>
        </div>

        <div className="px-6 pb-6 space-y-4">

          {/* Portfolio selector */}
          <div>
            <label className={labelClass}>{t('modal.portfolio')}</label>
            <div className="relative">
              <select value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)} className={`${fieldClass} appearance-none pr-10`}>
                {portfolioList.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </span>
            </div>
          </div>

          {/* Drop zone */}
          {!rows && !loading && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]) }}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors ${
                dragging ? 'border-blue-400 bg-blue-50 dark:bg-blue-950' : 'border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
              }`}
            >
              <p className="text-3xl mb-2">📂</p>
              <p className="font-medium text-gray-700 dark:text-gray-300">{t('importModal.dropzone')}</p>
              <p className="text-xs text-gray-400 mt-1">{t('importModal.formats')}</p>
              <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
            </div>
          )}

          {loading && (
            <div className="text-center py-10 text-gray-400 text-sm">{t('importModal.analyzing')}</div>
          )}

          {/* Preview table */}
          {rows && !loading && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">{t('importModal.found', { n: rows.length })}</p>
                <button onClick={() => { setRows(null); setSelected([]); setError('') }} className="text-xs text-gray-400 hover:text-gray-600">
                  {t('importModal.changeFile')}
                </button>
              </div>

              <div>
                <label className={labelClass}>{t('importModal.fileCurrency')}</label>
                <div className="relative">
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={`${fieldClass} appearance-none pr-10`}>
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">{t('importModal.fileCurrencyHint')}</p>
              </div>

              <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800 text-gray-400 text-xs">
                      <th className="px-3 py-2 text-left">
                        <input type="checkbox" checked={selected.length === rows.length} onChange={toggleAll} className="rounded" />
                      </th>
                      <th className="px-3 py-2 text-left">Ticker</th>
                      <th className="px-3 py-2 text-left">{t('portfolio.asset')}</th>
                      <th className="px-3 py-2 text-right">{t('portfolio.shares')}</th>
                      <th className="px-3 py-2 text-right">{t('modal.purchasePrice')}</th>
                      <th className="px-3 py-2 text-left">{t('modal.transactionDate')}</th>
                      <th className="px-3 py-2 text-right">{t('modal.fees')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr
                        key={i}
                        onClick={() => toggleRow(i)}
                        className={`border-b border-gray-50 dark:border-gray-800 cursor-pointer transition-colors ${
                          selected.includes(i) ? '' : 'opacity-40'
                        } hover:bg-gray-50 dark:hover:bg-gray-800`}
                      >
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={selected.includes(i)} onChange={() => toggleRow(i)} onClick={(e) => e.stopPropagation()} className="rounded" />
                        </td>
                        <td className="px-3 py-2 font-semibold">{r.ticker}</td>
                        <td className="px-3 py-2 text-gray-400 max-w-40 truncate">{r.asset_name ?? '—'}</td>
                        <td className="px-3 py-2 text-right">{fmt(r.shares)}</td>
                        <td className="px-3 py-2 text-right">{fmt(r.avg_buy_price)}</td>
                        <td className="px-3 py-2 text-gray-400">{r.purchase_date ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-gray-400">{fmt(r.fees)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {success ? (
                <p className="text-sm text-emerald-500 text-center py-2">{success}</p>
              ) : (
                <button
                  onClick={confirm}
                  disabled={loading || selected.length === 0}
                  className="w-full py-3.5 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {t('importModal.confirm', { n: selected.length })}
                </button>
              )}
            </>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  )
}
