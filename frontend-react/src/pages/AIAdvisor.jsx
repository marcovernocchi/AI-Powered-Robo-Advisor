import { useEffect, useState } from 'react'
import { Card, Title, Text, Button, Badge } from '@tremor/react'
import { generateAdvice, getAdviceHistory, setRiskProfile, getMe } from '../api/client'
import { useAuth } from '../context/AuthContext'

function riskLabel(score) {
  if (score <= 26) return 'Low (Defensive)'
  if (score <= 42) return 'Medium (Conservative)'
  if (score <= 56) return 'Medium-High (Balanced)'
  return 'High (Aggressive)'
}

const SECTION_A = [
  { key: 'a1', label: 'A1. Annual net income', options: ['Up to €30,000', '€30,001 – €70,000', '€70,001 – €150,000', 'Over €150,000'] },
  { key: 'a2', label: 'A2. Total net wealth', options: ['Up to €100,000', '€100,001 – €500,000', '€500,001 – €2,000,000', 'Over €2,000,000'] },
  { key: 'a3', label: 'A3. Amount you intend to invest', options: ['Up to €10,000', '€10,001 – €50,000', '€50,001 – €200,000', 'Over €200,000'] },
  { key: 'a4', label: 'A4. This investment as % of total financial wealth', options: ['More than 75%', '50% – 75%', '25% – 49%', 'Less than 25%'] },
  { key: 'a5', label: 'A5. Current level of debt', options: ['Significant (>50% of income)', 'Moderate (20% – 50%)', 'Limited (<20%)', 'None'] },
  { key: 'a6', label: 'A6. How often will you withdraw funds?', options: ['Frequently (monthly/quarterly)', 'Occasionally (1-2x/year)', 'Rarely (every few years)', 'Not until end of investment'] },
  { key: 'a7', label: 'A7. If this lost 30%, impact on standard of living?', options: ['Severely', 'Moderately', 'Slightly', 'Not at all'] },
  { key: 'a8', label: 'A8. Emergency savings outside this investment?', options: ['None', 'Less than 3 months expenses', '3 – 6 months', 'More than 6 months'] },
]

const SECTION_B = [
  { key: 'b1', label: 'B1. Primary investment objective', options: ['Preserve capital against inflation', 'Generate stable income', 'Achieve moderate capital growth', 'Maximise long-term capital growth'] },
  { key: 'b2', label: 'B2. Expected time horizon', options: ['Less than 2 years', '2 – 5 years', '5 – 10 years', 'More than 10 years'] },
  { key: 'b3', label: 'B3. Annual return expectation', options: ['1% – 3%', '3% – 5%', '5% – 8%', 'Over 8%'] },
]

const SECTION_B4_OPTIONS = ['Retirement supplement', 'Specific future expense', 'Supplementary current income', 'Long-term growth / inheritance planning', 'Other']

const SECTION_C = [
  { key: 'c1', label: 'C1. Portfolio drops 20% in a few weeks. You would:', options: ['Sell everything', 'Sell part to reduce risk', 'Hold and wait for recovery', 'Buy more at lower prices'] },
  { key: 'c2', label: 'C2. Which scenario over one year?', options: ['Guaranteed +2%, no losses', 'Expected +5%, max loss –5%', 'Expected +10%, max loss –15%', 'Expected +20%, max loss –30%'] },
  { key: 'c3', label: 'C3. Which portfolio would you most regret NOT holding?', options: ['+3%, drawdown –2%', '+6%, drawdown –8%', '+12%, drawdown –18%', '+25%, drawdown –35%'] },
  { key: 'c4', label: 'C4. Your attitude toward uncertainty', options: ['Avoid it whenever possible', 'Tolerate it cautiously', 'Comfortable with it', 'Find it stimulating'] },
  { key: 'c5', label: 'C5. Style of important decisions', options: ['Long, careful analysis', 'Methodical, weighing pros/cons', 'Quick, based on overall judgement', 'Impulsive when opportunity appears'] },
  { key: 'c6', label: 'C6. Portfolio underperforms for 2 consecutive years. You feel:', options: ['Anxious — change strategy immediately', 'Worried — reconsider strategy', 'Patient — stick to long-term plan', 'Unaffected — short-term doesn\'t matter'] },
]

const SECTION_D = [
  { key: 'd11', label: 'D11. A bond with duration 7y vs 2y is:', options: ['More sensitive to interest rate changes', 'Less sensitive', 'Equally sensitive', "I don't know"], correct: 0 },
  { key: 'd12', label: 'D12. Diversification primarily reduces:', options: ['Systematic (market) risk', 'Specific (idiosyncratic) risk', 'Both equally', "I don't know"], correct: 1 },
  { key: 'd13', label: 'D13. An ETF differs from an active fund because:', options: ['It tracks an index and has lower fees', 'It guarantees higher returns', 'It cannot be traded intraday', "I don't know"], correct: 0 },
  { key: 'd14', label: "D14. 'Leverage' in investing means:", options: ['Using borrowed money to amplify exposure', 'A type of guaranteed return', 'A low-risk strategy', "I don't know"], correct: 0 },
  { key: 'd15', label: 'D15. Past performance of a financial product:', options: ['Guarantees future returns', 'Is a useful but not conclusive indicator', 'Is irrelevant to future returns', "I don't know"], correct: 1 },
]

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

function buildInitialAnswers() {
  const a = {}
  SECTION_A.forEach((q) => (a[q.key] = 1))
  SECTION_B.forEach((q) => (a[q.key] = 1))
  a.b4 = SECTION_B4_OPTIONS[0]
  SECTION_C.forEach((q) => (a[q.key] = 1))
  SECTION_D.forEach((q) => (a[q.key] = 1))
  return a
}

export default function AIAdvisor() {
  const { user, setUser } = useAuth()
  const [showQuestionnaire, setShowQuestionnaire] = useState(false)
  const [answers, setAnswers] = useState(buildInitialAnswers)
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

  const steps = ['Section A', 'Section B', 'Section C', 'Section D']

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">AI Financial Advisor</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Risk profiling and personalized AI advice
        </p>
      </div>

      {/* Risk profile status */}
      <Card className="dark:bg-gray-900 dark:border-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <Title>Risk Profile</Title>
            {user?.risk_score ? (
              <div className="mt-2 flex items-center gap-3">
                <Badge color="blue">{riskLabel(user.risk_score)}</Badge>
                <Text className="text-gray-400">Score: {user.risk_score}/68</Text>
              </div>
            ) : (
              <Text className="mt-2 text-gray-400">Not completed yet</Text>
            )}
          </div>
          <Button
            variant="secondary"
            onClick={() => { setShowQuestionnaire(true); setStep(0) }}
          >
            {user?.risk_score ? 'Retake' : 'Start questionnaire'}
          </Button>
        </div>
      </Card>

      {/* Questionnaire */}
      {showQuestionnaire && (
        <Card className="dark:bg-gray-900 dark:border-gray-800">
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
                Financial Situation — measures your objective ability to bear financial risk.
              </p>
              {SECTION_A.map((q) => (
                <RadioGroup key={q.key} label={q.label} options={q.options} value={answers[q.key]} onChange={(v) => setAnswer(q.key, v)} />
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500 dark:text-gray-400">Objectives and Time Horizon</p>
              {SECTION_B.map((q) => (
                <RadioGroup key={q.key} label={q.label} options={q.options} value={answers[q.key]} onChange={(v) => setAnswer(q.key, v)} />
              ))}
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">B4. Main purpose (informational only)</p>
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
              <p className="text-sm text-gray-500 dark:text-gray-400">Risk Tolerance — psychological and emotional dimension of risk.</p>
              {SECTION_C.map((q) => (
                <RadioGroup key={q.key} label={q.label} options={q.options} value={answers[q.key]} onChange={(v) => setAnswer(q.key, v)} />
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500 dark:text-gray-400">Knowledge and Experience — verifies your financial understanding.</p>
              {SECTION_D.map((q) => (
                <RadioGroup key={q.key} label={q.label} options={q.options} value={answers[q.key]} onChange={(v) => setAnswer(q.key, v)} />
              ))}
            </div>
          )}

          {submitError && <p className="mt-3 text-sm text-red-500">{submitError}</p>}

          <div className="flex justify-between mt-6">
            <Button variant="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              Back
            </Button>
            {step < 3 ? (
              <Button onClick={() => setStep((s) => s + 1)}>Next</Button>
            ) : (
              <Button onClick={handleSubmitQuestionnaire} loading={submitLoading}>
                Calculate my risk profile
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* AI Advice */}
      {user?.risk_score && (
        <>
          <Card className="dark:bg-gray-900 dark:border-gray-800">
            <div className="flex items-center justify-between">
              <div>
                <Title>AI Advice</Title>
                <Text className="text-gray-400">Tailored to your portfolio and risk profile</Text>
              </div>
              <Button onClick={handleGenerateAdvice} loading={adviceLoading}>
                Generate
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
            <Card className="dark:bg-gray-900 dark:border-gray-800">
              <Title>Previous Advice</Title>
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
