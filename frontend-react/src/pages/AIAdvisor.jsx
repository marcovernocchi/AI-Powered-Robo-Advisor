import { useEffect, useState } from 'react'
import { Card, Title, Text, Button, Badge } from '@tremor/react'
import { generateAdvice, getAdviceHistory, setRiskProfile, getMe } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'

function RadioGroup({ label, options, value, onChange }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</p>
      <div className="space-y-1">
        {options.map((opt, i) => (
          <label key={i} className="flex items-center gap-2 cursor-pointer text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100">
            <input
              type="radio"
              name={label}
              checked={value === i + 1}
              onChange={() => onChange(i + 1)}
              className="accent-blue-500"
            />
            {opt}
          </label>
        ))}
      </div>
    </div>
  )
}

export default function AIAdvisor() {
  const { user, setUser } = useAuth()
  const { t } = useLang()

  const SECTION_A = t('advisor.sectionA')
  const SECTION_B = t('advisor.sectionB')
  const SECTION_B4_OPTIONS = t('advisor.sectionB4Options')
  const SECTION_C = t('advisor.sectionC')
  const SECTION_D = t('advisor.sectionD')

  function buildInitialAnswers() {
    const a = {}
    SECTION_A.forEach((q) => (a[q.key] = 1))
    SECTION_B.forEach((q) => (a[q.key] = 1))
    a.b4 = SECTION_B4_OPTIONS[0]
    SECTION_C.forEach((q) => (a[q.key] = 1))
    SECTION_D.forEach((q) => (a[q.key] = 1))
    return a
  }

  function riskLabel(score) {
    if (score <= 26) return t('advisor.riskLow')
    if (score <= 42) return t('advisor.riskMedLow')
    if (score <= 56) return t('advisor.riskMed')
    return t('advisor.riskHigh')
  }

  const [showQuestionnaire, setShowQuestionnaire] = useState(false)
  const [answers, setAnswers] = useState(() => buildInitialAnswers())
  const [step, setStep] = useState(0)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const [advice, setAdvice] = useState('')
  const [adviceLoading, setAdviceLoading] = useState(false)
  const [adviceError, setAdviceError] = useState('')
  const [history, setHistory] = useState([])

  useEffect(() => {
    if (user?.risk_score) {
      getAdviceHistory().then(setHistory).catch(console.error)
    }
  }, [user?.risk_score])

  function setAnswer(key, val) {
    setAnswers((prev) => ({ ...prev, [key]: val }))
  }

  async function handleSubmitQuestionnaire() {
    setSubmitError('')
    setSubmitLoading(true)
    try {
      const payload = {
        section_a: Object.fromEntries(SECTION_A.map((q) => [q.key, answers[q.key]])),
        section_b: {
          b1: answers.b1,
          b2: answers.b2,
          b3: answers.b3,
          b4: answers.b4,
        },
        section_c: Object.fromEntries(SECTION_C.map((q) => [q.key, answers[q.key]])),
        section_d: Object.fromEntries(
          SECTION_D.map((q) => [q.key, answers[q.key] === q.correct + 1])
        ),
      }
      const result = await setRiskProfile(payload)
      const updatedUser = await getMe()
      setUser(updatedUser)
      setShowQuestionnaire(false)
    } catch (err) {
      setSubmitError(err.message)
    } finally {
      setSubmitLoading(false)
    }
  }

  async function handleGenerateAdvice() {
    setAdviceError('')
    setAdviceLoading(true)
    setAdvice('')
    try {
      const result = await generateAdvice()
      setAdvice(result.advice)
      const updated = await getAdviceHistory()
      setHistory(updated)
    } catch (err) {
      setAdviceError(err.message)
    } finally {
      setAdviceLoading(false)
    }
  }

  const steps = t('advisor.sectionLabels')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('advisor.title')}</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          {t('advisor.subtitle')}
        </p>
      </div>

      {/* Risk profile status */}
      <Card className="ring-0 border-0 dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <div>
            <Title>{t('advisor.riskProfile')}</Title>
            {user?.risk_score ? (
              <div className="mt-2 flex items-center gap-3">
                <Badge color="blue">{riskLabel(user.risk_score)}</Badge>
                <Text className="text-gray-400">{t('advisor.score')}: {user.risk_score}/68</Text>
              </div>
            ) : (
              <Text className="mt-2 text-gray-400">{t('advisor.notCompleted')}</Text>
            )}
          </div>
          <Button
            variant="secondary"
            onClick={() => { setShowQuestionnaire(true); setStep(0) }}
          >
            {user?.risk_score ? t('advisor.retake') : t('advisor.start')}
          </Button>
        </div>
      </Card>

      {/* Questionnaire */}
      {showQuestionnaire && (
        <Card className="ring-0 border-0 dark:bg-gray-900">
          {/* Step indicator */}
          <div className="flex gap-2 mb-6">
            {steps.map((s, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  i === step
                    ? 'bg-blue-600 text-white'
                    : i < step
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {step === 0 && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('advisor.sectionADesc')}
              </p>
              {SECTION_A.map((q) => (
                <RadioGroup key={q.key} label={q.label} options={q.options} value={answers[q.key]} onChange={(v) => setAnswer(q.key, v)} />
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('advisor.sectionBDesc')}</p>
              {SECTION_B.map((q) => (
                <RadioGroup key={q.key} label={q.label} options={q.options} value={answers[q.key]} onChange={(v) => setAnswer(q.key, v)} />
              ))}
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('advisor.b4Label')}</p>
                <select
                  value={answers.b4}
                  onChange={(e) => setAnswer('b4', e.target.value)}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                >
                  {SECTION_B4_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('advisor.sectionCDesc')}</p>
              {SECTION_C.map((q) => (
                <RadioGroup key={q.key} label={q.label} options={q.options} value={answers[q.key]} onChange={(v) => setAnswer(q.key, v)} />
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('advisor.sectionDDesc')}</p>
              {SECTION_D.map((q) => (
                <RadioGroup key={q.key} label={q.label} options={q.options} value={answers[q.key]} onChange={(v) => setAnswer(q.key, v)} />
              ))}
            </div>
          )}

          {submitError && <p className="mt-3 text-sm text-red-500">{submitError}</p>}

          <div className="flex justify-between mt-6">
            <Button variant="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              {t('advisor.back')}
            </Button>
            {step < 3 ? (
              <Button onClick={() => setStep((s) => s + 1)}>{t('advisor.next')}</Button>
            ) : (
              <Button onClick={handleSubmitQuestionnaire} loading={submitLoading}>
                {t('advisor.calculate')}
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* AI Advice */}
      {user?.risk_score && (
        <>
          <Card className="ring-0 border-0 dark:bg-gray-900">
            <div className="flex items-center justify-between">
              <div>
                <Title>{t('advisor.aiAdvice')}</Title>
                <Text className="text-gray-400">{t('advisor.aiAdviceDesc')}</Text>
              </div>
              <Button onClick={handleGenerateAdvice} loading={adviceLoading}>
                {t('advisor.generate')}
              </Button>
            </div>

            {adviceError && <p className="mt-3 text-sm text-red-500">{adviceError}</p>}

            {advice && (
              <div className="mt-4 prose prose-sm dark:prose-invert max-w-none">
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-4 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {advice}
                </div>
              </div>
            )}
          </Card>

          {history.length > 0 && (
            <Card className="ring-0 border-0 dark:bg-gray-900">
              <Title>{t('advisor.previousAdvice')}</Title>
              <div className="mt-4 space-y-3">
                {history.map((item) => (
                  <details key={item.id} className="group rounded-lg border border-gray-100 dark:border-gray-800">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 list-none flex justify-between">
                      <span>Generated on {item.created_at.slice(0, 10)}</span>
                      <span className="text-gray-400 group-open:rotate-180 transition-transform">▾</span>
                    </summary>
                    <div className="px-4 pb-4 text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                      {item.content}
                    </div>
                  </details>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
