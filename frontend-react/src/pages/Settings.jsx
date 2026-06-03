import { useState, useEffect, useRef } from 'react'
import { updateProfile, getMe } from '../api/client'
import { useAuth } from '../context/AuthContext'

const COUNTRIES = [
  { value: 'IT', label: 'Italy',          flag: '🇮🇹', currency: 'EUR' },
  { value: 'CH', label: 'Switzerland',    flag: '🇨🇭', currency: 'CHF' },
  { value: 'DE', label: 'Germany',        flag: '🇩🇪', currency: 'EUR' },
  { value: 'FR', label: 'France',         flag: '🇫🇷', currency: 'EUR' },
  { value: 'ES', label: 'Spain',          flag: '🇪🇸', currency: 'EUR' },
  { value: 'AT', label: 'Austria',        flag: '🇦🇹', currency: 'EUR' },
  { value: 'NL', label: 'Netherlands',    flag: '🇳🇱', currency: 'EUR' },
  { value: 'BE', label: 'Belgium',        flag: '🇧🇪', currency: 'EUR' },
  { value: 'PT', label: 'Portugal',       flag: '🇵🇹', currency: 'EUR' },
  { value: 'FI', label: 'Finland',        flag: '🇫🇮', currency: 'EUR' },
  { value: 'IE', label: 'Ireland',        flag: '🇮🇪', currency: 'EUR' },
  { value: 'GR', label: 'Greece',         flag: '🇬🇷', currency: 'EUR' },
  { value: 'GB', label: 'United Kingdom', flag: '🇬🇧', currency: 'GBP' },
  { value: 'SE', label: 'Sweden',         flag: '🇸🇪', currency: 'SEK' },
  { value: 'NO', label: 'Norway',         flag: '🇳🇴', currency: 'NOK' },
  { value: 'DK', label: 'Denmark',        flag: '🇩🇰', currency: 'DKK' },
  { value: 'PL', label: 'Poland',         flag: '🇵🇱', currency: 'PLN' },
  { value: 'CZ', label: 'Czech Republic', flag: '🇨🇿', currency: 'CZK' },
  { value: 'US', label: 'United States',  flag: '🇺🇸', currency: 'USD' },
  { value: 'CA', label: 'Canada',         flag: '🇨🇦', currency: 'CAD' },
  { value: 'AU', label: 'Australia',      flag: '🇦🇺', currency: 'AUD' },
  { value: 'JP', label: 'Japan',          flag: '🇯🇵', currency: 'JPY' },
  { value: 'HK', label: 'Hong Kong',      flag: '🇭🇰', currency: 'HKD' },
  { value: 'SG', label: 'Singapore',      flag: '🇸🇬', currency: 'SGD' },
]

const CURRENCIES = [
  { value: 'USD', label: 'US Dollar',         flag: '🇺🇸' },
  { value: 'EUR', label: 'Euro',              flag: '🇪🇺' },
  { value: 'CHF', label: 'Swiss Franc',       flag: '🇨🇭' },
  { value: 'GBP', label: 'British Pound',     flag: '🇬🇧' },
  { value: 'JPY', label: 'Japanese Yen',      flag: '🇯🇵' },
  { value: 'CAD', label: 'Canadian Dollar',   flag: '🇨🇦' },
  { value: 'AUD', label: 'Australian Dollar', flag: '🇦🇺' },
  { value: 'SEK', label: 'Swedish Krona',     flag: '🇸🇪' },
  { value: 'NOK', label: 'Norwegian Krone',   flag: '🇳🇴' },
  { value: 'DKK', label: 'Danish Krone',      flag: '🇩🇰' },
  { value: 'PLN', label: 'Polish Zloty',      flag: '🇵🇱' },
]

const LANGUAGES = [
  { value: 'en', label: 'English', flag: '🇬🇧' },
  { value: 'it', label: 'Italian', flag: '🇮🇹' },
]

function FlagSelect({ options, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const selected = options.find((o) => o.value === value) ?? options[0]

  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-100 dark:bg-gray-800 rounded-xl text-sm hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl leading-none">{selected.flag}</span>
          <span className="text-gray-900 dark:text-gray-100">{selected.label}</span>
        </div>
        <span className="text-gray-400 text-xs">{open ? '∧' : '∨'}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 max-h-56 overflow-y-auto z-20">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                o.value === value
                  ? 'bg-gray-100 dark:bg-gray-700 font-medium'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <span className="text-xl leading-none">{o.flag}</span>
              <span className="text-gray-800 dark:text-gray-200">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
      {children}
      <hr className="border-gray-100 dark:border-gray-800 mt-4" />
    </div>
  )
}

export default function Settings() {
  const { user, setUser } = useAuth()
  const [country, setCountry] = useState(user?.country ?? 'IT')
  const [currency, setCurrency] = useState(user?.display_currency ?? 'EUR')
  const [language, setLanguage] = useState(localStorage.getItem('lang') ?? 'en')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  async function save(patch) {
    setSaving(true)
    try {
      await updateProfile(patch)
      const updated = await getMe()
      setUser(updated)
      setSavedMsg('Saved')
      setTimeout(() => setSavedMsg(''), 2000)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  async function handleCountry(val) {
    setCountry(val)
    const newCurrency = COUNTRIES.find((c) => c.value === val)?.currency ?? currency
    setCurrency(newCurrency)
    await save({ country: val, display_currency: newCurrency })
  }

  async function handleCurrency(val) {
    setCurrency(val)
    await save({ display_currency: val })
  }

  function handleLanguage(val) {
    setLanguage(val)
    localStorage.setItem('lang', val)
    setSavedMsg('Saved')
    setTimeout(() => setSavedMsg(''), 2000)
  }

  return (
    <div className="max-w-lg space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage your account preferences</p>
        </div>
        {saving && <span className="text-xs text-gray-400">Saving…</span>}
        {savedMsg && !saving && <span className="text-xs text-emerald-500">{savedMsg} ✓</span>}
      </div>

      <div className="space-y-6">
        <Section title="Location">
          <FlagSelect options={COUNTRIES} value={country} onChange={handleCountry} />
        </Section>

        <Section title="Currency">
          <FlagSelect options={CURRENCIES} value={currency} onChange={handleCurrency} />
        </Section>

        <Section title="App language">
          <FlagSelect options={LANGUAGES} value={language} onChange={handleLanguage} />
        </Section>

        <div className="pt-2 space-y-2 text-sm text-gray-500 dark:text-gray-400">
          <p className="text-gray-700 dark:text-gray-300 font-medium text-sm">Account</p>
          <div className="flex justify-between py-1">
            <span>Name</span>
            <span className="text-gray-900 dark:text-gray-100 font-medium">{user?.name}</span>
          </div>
          <div className="flex justify-between py-1">
            <span>Email</span>
            <span className="text-gray-900 dark:text-gray-100 font-medium">{user?.email}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
