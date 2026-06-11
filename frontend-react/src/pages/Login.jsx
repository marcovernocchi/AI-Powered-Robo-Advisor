import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '@tremor/react'
import { login, register, getMe } from '../api/client'
import { useAuth } from '../context/AuthContext'

const COUNTRIES = [
  { code: 'IT', name: 'Italy' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'AT', name: 'Austria' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' },
  { code: 'PT', name: 'Portugal' },
  { code: 'FI', name: 'Finland' },
  { code: 'IE', name: 'Ireland' },
  { code: 'GR', name: 'Greece' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'PL', name: 'Poland' },
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'JP', name: 'Japan' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'SG', name: 'Singapore' },
]

export default function Login() {
  const { saveToken, setUser } = useAuth()
  const navigate = useNavigate()

  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regCountry, setRegCountry] = useState('IT')
  const [regError, setRegError] = useState('')
  const [regLoading, setRegLoading] = useState(false)
  const [tab, setTab] = useState('login')

  async function handleLogin(e) {
    e.preventDefault()
    setLoginError('')
    setLoginLoading(true)
    try {
      const { access_token } = await login(loginEmail, loginPassword)
      saveToken(access_token)
      const user = await getMe()
      setUser(user)
      navigate('/')
    } catch (err) {
      setLoginError(err.message)
    } finally {
      setLoginLoading(false)
    }
  }

  async function handleRegister(e) {
    e.preventDefault()
    setRegError('')
    setRegLoading(true)
    try {
      const { access_token } = await register(regName, regEmail, regPassword, regCountry)
      saveToken(access_token)
      const user = await getMe()
      setUser(user)
      navigate('/')
    } catch (err) {
      setRegError(err.message)
    } finally {
      setRegLoading(false)
    }
  }

  const features = [
    {
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 1.5a1 1 0 011 1v1.086A5.5 5.5 0 0113.414 8H14.5a1 1 0 010 2h-1.086A5.5 5.5 0 018 14.414V15.5a1 1 0 01-2 0v-1.086A5.5 5.5 0 011.586 10H.5a1 1 0 010-2h1.086A5.5 5.5 0 016 1.586V.5a1 1 0 011-1z" fill="currentColor" fillOpacity="0" stroke="currentColor" strokeWidth="1.2"/>
          <circle cx="8" cy="8" r="2.5" fill="currentColor"/>
        </svg>
      ),
      title: 'AI-powered advice',
      desc: 'Personalized recommendations from Llama 3.3',
    },
    {
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 12l4-4 3 3 5-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
      title: 'Portfolio optimization',
      desc: 'Black-Litterman & mean-variance models',
    },
    {
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="10" width="3" height="5" rx="1" fill="currentColor" fillOpacity="0.5"/>
          <rect x="6" y="6" width="3" height="9" rx="1" fill="currentColor" fillOpacity="0.75"/>
          <rect x="11" y="2" width="3" height="13" rx="1" fill="currentColor"/>
        </svg>
      ),
      title: 'Real-time market data',
      desc: 'Live prices, P&L tracking and backtesting',
    },
  ]

  const inputClass = "w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 transition-all duration-150 focus:outline-none focus:border-blue-500 focus:ring-3 focus:ring-blue-100"
  const labelClass = "block text-xs font-medium text-gray-500 mb-1.5 tracking-wide"

  return (
    <div className="min-h-screen flex">
      {/* Left panel — branding */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-center p-16"
        style={{background: 'linear-gradient(135deg, #1e3a5f 0%, #0f172a 60%, #000000 100%)'}}
      >
        <div className="mb-10">
          <h1 className="text-5xl font-bold text-white leading-tight tracking-tight mb-3">Fortuna</h1>
          <p className="text-lg text-blue-200 leading-relaxed font-light">
            Your wealth,<br />guided by intelligence.
          </p>
        </div>

        <div className="w-12 h-px bg-blue-500 opacity-40 mb-10" />

        <div className="space-y-7">
          {features.map((f) => (
            <div key={f.title} className="flex items-start gap-4">
              <div className="mt-0.5 text-blue-400 flex-shrink-0">{f.icon}</div>
              <div>
                <p className="text-white font-medium text-sm mb-0.5">{f.title}</p>
                <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-gray-600 text-xs tracking-wide mt-16">Programming in Finance II · 2026</p>
      </div>

      {/* Right panel — form */}
      <div
        className="flex flex-col w-full lg:w-1/2 items-center justify-center px-8 py-12"
        style={{background: 'linear-gradient(160deg, #f8fafc 0%, #f1f5f9 60%, #e9eef5 100%)'}}
      >
        <div className="w-full max-w-[26rem]">

          {/* Mobile header */}
          <div className="mb-8 lg:hidden text-center">
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Fortuna</h1>
            <p className="mt-1 text-gray-500 text-sm">Your wealth, guided by intelligence.</p>
          </div>

          {/* Heading */}
          <div className="mb-7">
            <h2 className="text-2xl font-semibold text-gray-900 tracking-tight mb-1">
              {tab === 'login' ? 'Welcome back' : 'Create your account'}
            </h2>
            <p className="text-sm text-gray-500">
              {tab === 'login'
                ? 'Sign in to access your portfolio.'
                : 'Start managing your wealth intelligently.'}
            </p>
          </div>

          <Card
            className="ring-0 border border-gray-200 bg-white p-8"
            style={{
              borderRadius: '20px',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 20px 60px -10px rgba(0,0,0,0.12)',
            }}
          >
            {/* Toggle pill */}
            <div className="flex bg-gray-100 rounded-xl p-1 mb-7">
              {['login', 'register'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                    tab === t
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {t === 'login' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>

            {tab === 'login' ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className={labelClass}>Email address</label>
                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Password</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    className={inputClass}
                  />
                </div>
                {loginError && (
                  <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
                      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M7 4v3M7 10h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    {loginError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full py-3 px-4 mt-1 rounded-xl text-white text-sm font-semibold tracking-wide transition-all duration-150 active:scale-[0.98] disabled:opacity-50"
                  style={{background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', boxShadow: '0 1px 3px rgba(37,99,235,0.4)'}}
                >
                  {loginLoading ? 'Signing in…' : 'Sign in'}
                </button>
                <div className="flex items-center justify-center gap-1.5 pt-1">
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="text-gray-400">
                    <path d="M3.5 5V3.5a2 2 0 014 0V5M2 5h7a.5.5 0 01.5.5v4a.5.5 0 01-.5.5H2a.5.5 0 01-.5-.5v-4A.5.5 0 012 5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                  <p className="text-[11px] text-gray-400">Secured with 256-bit encryption</p>
                </div>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className={labelClass}>Full name</label>
                  <input
                    placeholder="Marco Rossi"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    required
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Email address</label>
                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    required
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Password</label>
                  <input
                    type="password"
                    placeholder="Min. 8 characters"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    required
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Country of residence</label>
                  <div className="relative">
                    <select
                      value={regCountry}
                      onChange={(e) => setRegCountry(e.target.value)}
                      required
                      className={`${inputClass} appearance-none pr-10 cursor-pointer`}
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>{c.name}</option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                  </div>
                </div>
                {regError && (
                  <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
                      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M7 4v3M7 10h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    {regError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={regLoading}
                  className="w-full py-3 px-4 mt-1 rounded-xl text-white text-sm font-semibold tracking-wide transition-all duration-150 active:scale-[0.98] disabled:opacity-50"
                  style={{background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', boxShadow: '0 1px 3px rgba(37,99,235,0.4)'}}
                >
                  {regLoading ? 'Creating account…' : 'Get started'}
                </button>
                <div className="flex items-center justify-center gap-1.5 pt-1">
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="text-gray-400">
                    <path d="M3.5 5V3.5a2 2 0 014 0V5M2 5h7a.5.5 0 01.5.5v4a.5.5 0 01-.5.5H2a.5.5 0 01-.5-.5v-4A.5.5 0 012 5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                  <p className="text-[11px] text-gray-400">Secured with 256-bit encryption</p>
                </div>
              </form>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
