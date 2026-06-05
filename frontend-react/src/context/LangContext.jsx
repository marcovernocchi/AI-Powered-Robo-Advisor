import { createContext, useContext, useState } from 'react'
import { translations } from '../i18n/translations'

const LangContext = createContext(null)

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem('lang') ?? 'en')

  function setLang(val) {
    setLangState(val)
    localStorage.setItem('lang', val)
  }

  function t(key, params) {
    const keys = key.split('.')
    let val = translations[lang]
    for (const k of keys) val = val?.[k]
    if (typeof val === 'function') return val(params)
    return val ?? key
  }

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang() {
  return useContext(LangContext)
}
