function getToken() {
  return localStorage.getItem('token')
}

async function request(path, options = {}) {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(path, { ...options, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(err.detail || 'Request failed')
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

export const register = (name, email, password) =>
  request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  })

export const getMe = () => request('/auth/me')

export const getPortfolio = () => request('/portfolio/')
export const addHolding = (data) =>
  request('/portfolio/holdings', { method: 'POST', body: JSON.stringify(data) })
export const deleteHolding = (id) =>
  request(`/portfolio/holdings/${id}`, { method: 'DELETE' })
export const optimizePortfolio = () => request('/portfolio/optimize')

export const getMarketHistory = (ticker, period = '1y') =>
  request(`/market/history/${ticker}?period=${period}`)
export const getStockInfo = (ticker) => request(`/market/info/${ticker}`)
export const getStockPrice = (ticker) => request(`/market/price/${ticker}`)

export const generateAdvice = () =>
  request('/advice/generate', { method: 'POST' })
export const getAdviceHistory = () => request('/advice/history')

export const setRiskProfile = (answers) =>
  request('/risk-profile', { method: 'POST', body: JSON.stringify(answers) })
