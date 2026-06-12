import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useLang } from '../context/LangContext'

export default function Layout() {
  const { user, logout } = useAuth()
  const { dark, setDark } = useTheme()
  const { t } = useLang()
  const navigate = useNavigate()

  const navItems = [
    { to: '/',          label: t('nav.netWorth') },
    { to: '/portfolio', label: t('nav.portfolio') },
    { to: '/advisor',   label: t('nav.aiAdvisor') },
    { to: '/market',       label: t('nav.market') },
    { to: '/backtesting',  label: t('nav.backtesting') },
  ]

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Top nav */}
      <header className="h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto h-full px-6 flex items-center justify-between gap-6">

          {/* Logo */}
          <span className="font-bold text-lg tracking-tight shrink-0">Fortuna</span>

          {/* Nav links */}
          <nav className="flex items-center gap-1">
            {navItems.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-gray-900 dark:text-gray-100 bg-gray-100 dark:bg-gray-800'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Right controls */}
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setDark(!dark)}
              className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm"
              title="Toggle theme"
            >
              {dark ? '☀' : '☾'}
            </button>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `p-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'text-gray-900 dark:text-gray-100 bg-gray-100 dark:bg-gray-800'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`
              }
              title="Settings"
            >
              ⚙
            </NavLink>
            <div className="h-5 w-px bg-gray-200 dark:bg-gray-700 mx-1" />
            <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">{user?.name}</span>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
            >
              {t('nav.logout')}
            </button>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
