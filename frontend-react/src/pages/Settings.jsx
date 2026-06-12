import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateProfile, getMe } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { useTheme } from '../context/ThemeContext'

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
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
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

function Card({ children, className = '' }) {
  return (
    <div className={`bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-sm ${className}`}>
      {children}
    </div>
  )
}

function SettingRow({ label, children }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
      <div className="w-52">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
        checked ? 'bg-gray-900 dark:bg-gray-100' : 'bg-gray-200 dark:bg-gray-700'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-gray-900 transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function riskColor(score) {
  if (!score) return 'gray'
  if (score <= 26) return 'blue'
  if (score <= 52) return 'emerald'
  if (score <= 76) return 'amber'
  return 'rose'
}

function riskBg(score) {
  if (!score) return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
  if (score <= 26) return 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
  if (score <= 52) return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
  if (score <= 76) return 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
  return 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
}

export default function Settings() {
  const { user, setUser } = useAuth()
  const { t, lang, setLang } = useLang()
  const { dark, setDark } = useTheme()
  const navigate = useNavigate()
  const [country, setCountry] = useState(user?.country ?? 'IT')
  const [currency, setCurrency] = useState(user?.display_currency ?? 'EUR')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  function riskLabel(score) {
    if (!score) return t('settings.riskNotSet')
    if (score <= 26) return t('advisor.riskLow')
    if (score <= 52) return t('advisor.riskMedLow')
    if (score <= 76) return t('advisor.riskMed')
    return t('advisor.riskHigh')
  }

  async function save(patch) {
    setSaving(true)
    try {
      await updateProfile(patch)
      const updated = await getMe()
      setUser(updated)
      setSavedMsg(t('settings.saved'))
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
    setLang(val)
    setSavedMsg(t('settings.saved'))
    setTimeout(() => setSavedMsg(''), 2000)
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('settings.subtitle')}</p>
        </div>
        <div className="text-xs h-6">
          {saving && <span className="text-gray-400">{t('settings.saving')}</span>}
          {savedMsg && !saving && <span className="text-emerald-500">{savedMsg} ✓</span>}
        </div>
      </div>

      {/* Profile card */}
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-gray-900 dark:bg-gray-100 flex items-center justify-center shrink-0">
            <span className="text-lg font-bold text-white dark:text-gray-900">{initials}</span>
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{user?.name}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{user?.email}</p>
          </div>
        </div>
      </Card>

      {/* Preferences */}
      <Card className="px-5 py-1 divide-y divide-gray-100 dark:divide-gray-800">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-4 pb-2">{t('settings.preferences')}</p>
        <SettingRow label={t('settings.location')}>
          <FlagSelect options={COUNTRIES} value={country} onChange={handleCountry} />
        </SettingRow>
        <SettingRow label={t('settings.currency')}>
          <FlagSelect options={CURRENCIES} value={currency} onChange={handleCurrency} />
        </SettingRow>
        <SettingRow label={t('settings.language')}>
          <FlagSelect options={LANGUAGES} value={lang} onChange={handleLanguage} />
        </SettingRow>
        <SettingRow label={t('settings.darkMode')}>
          <div className="flex justify-end">
            <Toggle checked={dark} onChange={setDark} />
          </div>
        </SettingRow>
      </Card>

      {/* Risk Profile */}
      <Card className="p-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{t('settings.riskProfile')}</p>
        {user?.risk_score ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${riskBg(user.risk_score)}`}>
                {riskLabel(user.risk_score)}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {t('settings.score')}: {user.risk_score}/100
              </span>
            </div>
            <button
              onClick={() => navigate('/advisor')}
              className="text-xs text-blue-500 hover:text-blue-600 font-medium transition-colors"
            >
              {t('settings.retakeQuiz')} →
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">{t('settings.riskNotSet')}</span>
            <button
              onClick={() => navigate('/advisor')}
              className="text-xs text-blue-500 hover:text-blue-600 font-medium transition-colors"
            >
              {t('settings.retakeQuiz')} →
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}
