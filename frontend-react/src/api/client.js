function getToken() {
  return localStorage.getItem('token')
}

async function request(path, options = {}) {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(path, { ...options, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    if (!err) throw new Error(`HTTP ${res.status} – Request failed`)
    const detail = Array.isArray(err.detail)
      ? err.detail.map((d) => d.msg ?? JSON.stringify(d)).join('; ')
      : err.detail
    throw new Error(detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function login(email, password) {
  const form = new URLSearchParams()
  form.append('username', email)
  form.append('password', password)
  const res = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Login failed' }))
    throw new Error(err.detail || 'Login failed')
  }
  return res.json()
}

export const register = (name, email, password, country) =>
  request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password, country }),
  })

export const updateProfile = (data) =>
  request('/auth/me', { method: 'PATCH', body: JSON.stringify(data) })

export const getMe = () => request('/auth/me')

export const getPortfolio = () => request('/portfolio/')
export const getPortfolioList = () => request('/portfolio/list')
export const getPortfolioById = (id) => request(`/portfolio/${id}`)
export const createPortfolio = (name) =>
  request('/portfolio/create', { method: 'POST', body: JSON.stringify({ name }) })
export const updatePortfolio = (id, data) =>
  request(`/portfolio/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
export const deletePortfolio = (id) =>
  request(`/portfolio/${id}`, { method: 'DELETE' })
export const addHolding = (data) =>
  request('/portfolio/holdings', { method: 'POST', body: JSON.stringify(data) })
export const updateHolding = (id, data) =>
  request(`/portfolio/holdings/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
export const deleteHolding = (id) =>
  request(`/portfolio/holdings/${id}`, { method: 'DELETE' })
export const optimizePortfolio = () => request('/portfolio/optimize')
export const getPortfolioMetrics = () => request('/portfolio/metrics')
export const getPortfolioSuggestions = () => request('/portfolio/suggestions')

export async function downloadPortfolioExport(format) {
  const token = localStorage.getItem('token')
  const res = await fetch(`/portfolio/export/${format}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.detail || `Export failed (HTTP ${res.status})`)
  }
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = disposition.match(/filename="?([^"]+)"?/)
  const filename = match ? match[1] : `portfolio.${format}`
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function importPreview(file) {
  const token = localStorage.getItem('token')
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/portfolio/import/preview', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Upload failed' }))
    throw new Error(err.detail || 'Upload failed')
  }
  return res.json()
}

export const importConfirm = (holdings, portfolioId, currency) =>
  request('/portfolio/import/confirm', {
    method: 'POST',
    body: JSON.stringify({ holdings, portfolio_id: portfolioId, currency }),
  })

export const getMarketHistory = (ticker, period = '1y', startDate = null) => {
  const params = new URLSearchParams({ period })
  if (startDate) params.set('start_date', startDate)
  return request(`/market/history/${ticker}?${params}`)
}
export const getDividends = (ticker, startDate = null) => {
  const params = startDate ? `?start_date=${startDate}` : ''
  return request(`/market/dividends/${ticker}${params}`)
}
export const getStockInfo = (ticker) => request(`/market/info/${ticker}`)
export const getStockPrice = (ticker) => request(`/market/price/${ticker}`)
export const searchAssets = (q) => request(`/market/search?q=${encodeURIComponent(q)}`)

export const generateAdvice = () =>
  request('/advice/generate', { method: 'POST' })
export const getAdviceHistory = () => request('/advice/history')

export const setRiskProfile = (answers) =>
  request('/risk-profile', { method: 'POST', body: JSON.stringify(answers) })

export const explainRiskProfile = (data) =>
  request('/risk-profile/explain', { method: 'POST', body: JSON.stringify(data) })

export const runBacktest = (params) =>
  request('/backtest', { method: 'POST', body: JSON.stringify(params) })
