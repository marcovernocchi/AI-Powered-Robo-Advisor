import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

const navItems = [
  { to: '/', label: 'Dashboard', icon: '▦' },
  { to: '/portfolio', label: 'Portfolio', icon: '◈' },
  { to: '/advisor', label: 'AI Advisor', icon: '✦' },
  { to: '/market', label: 'Market', icon: '↗' },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const { dark, setDark } = useTheme()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Sidebar */}
      <aside className="w-56 flex flex-col border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 shrink-0">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-gray-200 dark:border-gray-800">
          <span className="font-bold text-lg tracking-tight">Robo-Advisor</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`
              }
            >
              <span className="text-base">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom: user + theme + logout */}
        <div className="px-4 py-4 border-t border-gray-200 dark:border-gray-800 space-y-3">
          <div className="text-sm font-medium truncate">{user?.name}</div>
          {user?.risk_score && (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Risk score: {user.risk_score}/68
            </div>
          )}
          <button
            onClick={() => setDark(!dark)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <span>{dark ? 'Dark mode' : 'Light mode'}</span>
            <span>{dark ? '☀' : '☾'}</span>
          </button>
          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 rounded-lg text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors text-left"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  )
}
