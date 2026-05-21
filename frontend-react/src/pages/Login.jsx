import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Title, TextInput, Button, Tab, TabGroup, TabList, TabPanel, TabPanels } from '@tremor/react'
import { login, register, getMe } from '../api/client'
import { useAuth } from '../context/AuthContext'

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
  const [regError, setRegError] = useState('')
  const [regLoading, setRegLoading] = useState(false)

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
      const { access_token } = await register(regName, regEmail, regPassword)
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">AI Robo-Advisor</h1>
          <p className="mt-2 text-gray-500 dark:text-gray-400">Personalized AI-powered investment advice</p>
        </div>

        <Card className="dark:bg-gray-900 dark:border-gray-800">
          <TabGroup>
            <TabList className="mb-6">
              <Tab>Login</Tab>
              <Tab>Create Account</Tab>
            </TabList>

            <TabPanels>
              <TabPanel>
                <form onSubmit={handleLogin} className="space-y-4">
                  <TextInput
                    placeholder="Email"
                    type="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                  />
                  <TextInput
                    placeholder="Password"
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                  />
                  {loginError && (
                    <p className="text-sm text-red-500">{loginError}</p>
                  )}
                  <Button type="submit" className="w-full" loading={loginLoading}>
                    Login
                  </Button>
                </form>
              </TabPanel>

              <TabPanel>
                <form onSubmit={handleRegister} className="space-y-4">
                  <TextInput
                    placeholder="Full Name"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    required
                  />
                  <TextInput
                    placeholder="Email"
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    required
                  />
                  <TextInput
                    placeholder="Password"
                    type="password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    required
                  />
                  {regError && (
                    <p className="text-sm text-red-500">{regError}</p>
                  )}
                  <Button type="submit" className="w-full" loading={regLoading}>
                    Create Account
                  </Button>
                </form>
              </TabPanel>
            </TabPanels>
          </TabGroup>
        </Card>
      </div>
    </div>
  )
}
