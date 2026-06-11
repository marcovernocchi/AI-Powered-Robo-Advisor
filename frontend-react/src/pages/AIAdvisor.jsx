import { useEffect, useState, Component } from 'react'
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Radar, Legend, ResponsiveContainer,
} from 'recharts'
import { Card, Title, Text, Button, Badge } from '@tremor/react'
import {
  generateAdvice, getAdviceHistory, setRiskProfile, getMe,
  getPortfolio, getPortfolioMetrics, optimizePortfolio, explainRiskProfile,
} from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'

// ---------------------------------------------------------------------------
// Structured advice renderer
// ---------------------------------------------------------------------------

function StructuredAdvice({ advice }) {
  const sections = [
    { key: 'assessment', label: 'Assessment', icon: '📊' },
    { key: 'outlook',    label: 'Outlook',    icon: '🔭' },
  ]
  return (
    <div className="mt-4 space-y-3">
      {advice.weights_verified === false && advice.weights_note && (
        <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded px-3 py-2">
          {advice.weights_note}
        </p>
      )}
      {sections.map(({ key, label, icon }) => advice[key] && (
        <div key={key} className="rounded-lg bg-gray-50 dark:bg-gray-800 p-4">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
            {icon} {label}
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300">{advice[key]}</p>
        </div>
      ))}
      {advice.suggestions?.length > 0 && (
        <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-4">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            💡 Suggestions
          </p>
          <ul className="space-y-1">
            {advice.suggestions.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-700 dark:text-gray-300">
                <span className="text-blue-500 font-bold shrink-0">{i + 1}.</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      {advice.disclaimer && (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic px-1">{advice.disclaimer}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// RADAR 1 — MiFID II profile
// Axes: A (Financial Situation, max 32), B (Investment Experience, max 12),
//        C (Risk Attitude, max 24), D (Financial Knowledge, max 5 correct).
// Normalisation: each axis = raw_score / axis_max * 100  →  0–100.
// Benchmark line = band midpoint as % of full scale (same across all axes because
// each axis is normalised proportionally, so a "balanced" scorer lands at the same %).
//   Band 1 midpoint: (0+26)/2 / 68 * 100 ≈ 19.1
//   Band 2 midpoint: (27+42)/2 / 68 * 100 ≈ 50.7
//   Band 3 midpoint: (43+56)/2 / 68 * 100 ≈ 72.8
//   Band 4 midpoint: (57+68)/2 / 68 * 100 ≈ 91.9
// ---------------------------------------------------------------------------
const BAND_BENCHMARKS = { 1: 19.1, 2: 50.7, 3: 72.8, 4: 91.9 }

function bandFromScore(score) {
  if (score <= 26) return 1
  if (score <= 42) return 2
  if (score <= 56) return 3
  return 4
}

function MiFIDRadar({ sectionScores, riskScore }) {
  const band = bandFromScore(riskScore)
  const benchmark = BAND_BENCHMARKS[band]

  const data = [
    { axis: 'Financial Situation (A)', value: Math.round((sectionScores.A / 32) * 100), benchmark },
    { axis: 'Investment Experience (B)', value: Math.round((sectionScores.B / 12) * 100), benchmark },
    { axis: 'Risk Attitude (C)', value: Math.round((sectionScores.C / 24) * 100), benchmark },
    { axis: 'Financial Knowledge (D)', value: Math.round((sectionScores.D / 5) * 100), benchmark },
  ]

  return (
    <ResponsiveContainer width="100%" height={320}>
      <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
        <PolarGrid />
        <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: '#6b7280' }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Radar
          name="Your Profile"
          dataKey="value"
          stroke="#3b82f6"
          fill="#3b82f6"
          fillOpacity={0.4}
        />
        <Radar
          name={`Band ${band} Benchmark`}
          dataKey="benchmark"
          stroke="#10b981"
          fill="#10b981"
          fillOpacity={0.15}
          strokeDasharray="5 5"
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </RadarChart>
    </ResponsiveContainer>
  )
}

// ---------------------------------------------------------------------------
// RADAR 2 — Recommended vs Current portfolio
// Axes (all normalised 0–100):
//   Expected Return   : clamp [−5%, +25%]  →  (val + 5) / 30 * 100
//   Safety (Low Risk) : inverted volatility, clamp [0%, 40%]  →  (1 − vol/40) * 100
//   Diversification   : effective N (1/HHI), clamp [1, 20]   →  (n − 1) / 19 * 100
//   Equity Share      : direct % 0–100 (equity + ETF)
//   Balance           : (1 − HHI) × 100; higher = more balanced; current uses HHI = 1/N_eff
//   Defensive Share   : direct % 0–100 (bond + cash)
// For the RECOMMENDED portfolio: return/vol from /portfolio/optimize;
//   equity share, defensive share, HHI computed from optimize weights + holdings asset_type.
// For the CURRENT portfolio: all metrics from /portfolio/metrics.
// ---------------------------------------------------------------------------
function normReturn(v)    { return Math.max(0, Math.min(100, (v + 5) / 30 * 100)) }
function normSafety(v)    { return Math.max(0, Math.min(100, (1 - v / 40) * 100)) }
function normDivers(v)    { return Math.max(0, Math.min(100, (v - 1) / 19 * 100)) }
function normEquity(v)    { return Math.max(0, Math.min(100, v)) }
// Concentration/Balance: normBalance(HHI) = (1 − HHI) × 100
// HHI = Σwi² ∈ [1/N, 1]. Higher score = more balanced (less concentrated).
// For current portfolio use HHI = 1/N_eff (exact inverse).
function normBalance(hhi) { return Math.max(0, Math.min(100, (1 - hhi) * 100)) }
// Defensive Share: direct % of portfolio value in bond/cash assets. 0–100.
function normDefensive(v) { return Math.max(0, Math.min(100, v)) }

function PortfolioRadar({ currentMetrics, optimizeData, holdings }) {
  // Derive equity share for the recommended portfolio using optimize weights
  // and the asset_type of each holding (same tickers, populated in DB).
  const assetTypeByTicker = {}
  holdings.forEach((h) => { assetTypeByTicker[h.ticker] = h.asset_type })

  const recEquityShare = Object.entries(optimizeData.weights).reduce(
    (sum, [ticker, w]) =>
      ['equity', 'etf'].includes(assetTypeByTicker[ticker] || '') ? sum + w * 100 : sum,
    0,
  )
  const recDefensiveShare = Object.entries(optimizeData.weights).reduce(
    (sum, [ticker, w]) =>
      ['bond', 'cash'].includes(assetTypeByTicker[ticker] || '') ? sum + w * 100 : sum,
    0,
  )

  // HHI = Σwi² for recommended. For current: 1/N_eff (exact inverse).
  const recHHI = Object.values(optimizeData.weights).reduce((s, w) => s + w * w, 0)
  const recNEff = recHHI > 0 ? 1 / recHHI : 1
  const curHHI = currentMetrics.n_effective_assets > 0 ? 1 / currentMetrics.n_effective_assets : 1

  const data = [
    {
      axis: 'Expected Return',
      recommended: Math.round(normReturn(optimizeData.expected_annual_return_pct)),
      current: Math.round(normReturn(currentMetrics.expected_annual_return_pct)),
    },
    {
      axis: 'Safety (Low Risk)',
      recommended: Math.round(normSafety(optimizeData.annual_volatility_pct)),
      current: Math.round(normSafety(currentMetrics.annual_volatility_pct)),
    },
    {
      axis: 'Diversification',
      recommended: Math.round(normDivers(recNEff)),
      current: Math.round(normDivers(currentMetrics.n_effective_assets)),
    },
    {
      axis: 'Equity Share',
      recommended: Math.round(normEquity(recEquityShare)),
      current: Math.round(normEquity(currentMetrics.equity_share_pct)),
    },
    {
      axis: 'Balance',
      recommended: Math.round(normBalance(recHHI)),
      current: Math.round(normBalance(curHHI)),
    },
    {
      axis: 'Defensive Share',
      recommended: Math.round(normDefensive(recDefensiveShare)),
      current: Math.round(normDefensive(currentMetrics.defensive_share_pct)),
    },
  ]

  return (
    <ResponsiveContainer width="100%" height={320}>
      <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
        <PolarGrid />
        <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: '#6b7280' }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Radar
          name="Recommended"
          dataKey="recommended"
          stroke="#10b981"
          fill="#10b981"
          fillOpacity={0.35}
        />
        <Radar
          name="Current"
          dataKey="current"
          stroke="#3b82f6"
          fill="#3b82f6"
          fillOpacity={0.35}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </RadarChart>
    </ResponsiveContainer>
  )
}

// ---------------------------------------------------------------------------
// DETERMINISTIC risk score explanation (no LLM — facts from the algorithm)
// ---------------------------------------------------------------------------
const BAND_LABELS = {
  1: 'Band 1 – Low (Defensive)',
  2: 'Band 2 – Medium (Conservative)',
  3: 'Band 3 – Medium-High (Balanced)',
  4: 'Band 4 – High (Aggressive)',
}
const BAND_RANGES = { 1: '≤ 26', 2: '27–42', 3: '43–56', 4: '57–68' }

function DeterministicExplanation({ riskScore, riskDetails }) {
  const { section_scores, bands, prudence_applied, knowledge_level } = riskDetails
  const band = bandFromScore(riskScore)

  return (
    <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
      {/* Score breakdown */}
      <div>
        <p className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Score breakdown</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
          <span>A – Financial Situation (max 32)</span>
          <span className="font-medium">{section_scores.A} pts</span>
          <span>B – Investment Experience (max 12)</span>
          <span className="font-medium">{section_scores.B} pts</span>
          <span>C – Risk Attitude (max 24)</span>
          <span className="font-medium">{section_scores.C} pts</span>
          <span>D – Financial Knowledge (max 5 correct)</span>
          <span className="font-medium">{section_scores.D} correct → {knowledge_level}</span>
        </div>
        <p className="mt-2">
          Total (A+B+C): <strong>{riskScore}/68</strong> → <strong>{BAND_LABELS[band]}</strong> (threshold: {BAND_RANGES[band]})
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Section D (Financial Knowledge) does not contribute to the total score; it determines the knowledge level separately.
        </p>
      </div>

      {/* Prudence rule */}
      <div>
        <p className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Prudence rule (ESMA MiFID II)</p>
        {prudence_applied ? (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 px-3 py-2">
            <p>
              <span className="font-medium text-amber-700 dark:text-amber-400">Applied.</span>{' '}
              Financial Situation (Section A → band {bands.A}) and Risk Attitude (Section C → band {bands.C})
              diverged by more than one band. Your total score was capped to the upper bound of
              band {Math.min(bands.A, bands.C)} ({BAND_RANGES[Math.min(bands.A, bands.C)]}).
            </p>
          </div>
        ) : (
          <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 px-3 py-2">
            <p>
              <span className="font-medium text-green-700 dark:text-green-400">Not triggered.</span>{' '}
              Financial Situation (band {bands.A}) and Risk Attitude (band {bands.C}) are within one
              band of each other — no cap applied.
            </p>
          </div>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          If Financial Situation and Risk Attitude diverge by more than one band, your total score is
          capped to the more conservative band (ESMA MiFID II guidelines).
        </p>
      </div>

      {/* Band legend */}
      <div>
        <p className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Risk band legend</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
          {Object.entries(BAND_LABELS).map(([b, label]) => (
            <span key={b} className={Number(b) === band ? 'font-semibold text-blue-600 dark:text-blue-400' : ''}>
              {label} (score {BAND_RANGES[b]})
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// How to read the portfolio radar — axis legend for Radar 2
// ---------------------------------------------------------------------------
function PortfolioRadarLegend({ currentMetrics, optimizeData, holdings }) {
  const assetTypeByTicker = {}
  holdings.forEach((h) => { assetTypeByTicker[h.ticker] = h.asset_type })
  const recEquityShare = Object.entries(optimizeData.weights).reduce(
    (sum, [ticker, w]) =>
      ['equity', 'etf'].includes(assetTypeByTicker[ticker] || '') ? sum + w * 100 : sum,
    0,
  )
  const recDefensiveShare = Object.entries(optimizeData.weights).reduce(
    (sum, [ticker, w]) =>
      ['bond', 'cash'].includes(assetTypeByTicker[ticker] || '') ? sum + w * 100 : sum,
    0,
  )
  const recHHI = Object.values(optimizeData.weights).reduce((s, w) => s + w * w, 0)
  const recNEff = recHHI > 0 ? 1 / recHHI : 1
  const curHHI = currentMetrics.n_effective_assets > 0 ? 1 / currentMetrics.n_effective_assets : 1

  const rows = [
    {
      axis: 'Expected Return',
      rec: `${optimizeData.expected_annual_return_pct?.toFixed(1) ?? '–'}%`,
      cur: `${currentMetrics.expected_annual_return_pct?.toFixed(1) ?? '–'}%`,
      note: 'Annualised historical return. Scale: −5% → 0, +25% → 100.',
    },
    {
      axis: 'Safety (Low Risk)',
      rec: `vol ${optimizeData.annual_volatility_pct?.toFixed(1) ?? '–'}%`,
      cur: `vol ${currentMetrics.annual_volatility_pct?.toFixed(1) ?? '–'}%`,
      note: 'Inverted volatility. Higher = safer (lower price swings). Scale: 40% vol → 0, 0% vol → 100.',
    },
    {
      axis: 'Diversification',
      rec: `N_eff ${recNEff.toFixed(1)}`,
      cur: `N_eff ${currentMetrics.n_effective_assets?.toFixed(1) ?? '–'}`,
      note: 'Effective number of positions (1/Herfindahl). Scale: 1 position → 0, 20 positions → 100.',
    },
    {
      axis: 'Equity Share',
      rec: `${recEquityShare.toFixed(1)}%`,
      cur: `${currentMetrics.equity_share_pct?.toFixed(1) ?? '–'}%`,
      note: '% of portfolio in equity/ETF assets. Direct 0–100 scale.',
    },
    {
      axis: 'Balance',
      rec: `HHI ${recHHI.toFixed(3)}`,
      cur: `HHI ${curHHI.toFixed(3)}`,
      note: 'Balance = (1 − HHI) × 100. Higher = less concentrated. HHI = Σwi² (1 = mono-asset, ~0 = equally spread).',
    },
    {
      axis: 'Defensive Share',
      rec: `${recDefensiveShare.toFixed(1)}%`,
      cur: `${currentMetrics.defensive_share_pct?.toFixed(1) ?? '–'}%`,
      note: '% of portfolio in bond/cash assets. Direct 0–100 scale.',
    },
  ]

  return (
    <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
      <p className="font-semibold text-sm text-gray-900 dark:text-gray-100">How to read the chart</p>
      {rows.map((r) => (
        <div key={r.axis} className="grid grid-cols-[140px_90px_90px_1fr] gap-2 items-start">
          <span className="font-medium text-gray-700 dark:text-gray-300">{r.axis}</span>
          <span className="text-green-600 dark:text-green-400">Rec: {r.rec}</span>
          <span className="text-blue-500 dark:text-blue-400">Cur: {r.cur}</span>
          <span>{r.note}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Error Boundary — catches render errors in this page without a white screen
// ---------------------------------------------------------------------------
class AIAdvisorErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 p-6 text-sm text-red-700 dark:text-red-300">
          <p className="font-semibold mb-1">Something went wrong loading the AI Advisor.</p>
          <p className="text-xs text-red-500">{this.state.error?.message}</p>
          <button
            className="mt-3 text-xs underline"
            onClick={() => this.setState({ error: null })}
          >Try again</button>
        </div>
      )
    }
    return this.props.children
  }
}

// ===========================================================================
// Main component
// ===========================================================================
function AIAdvisorInner() {
  const { user, setUser } = useAuth()
  const { t } = useLang()

  const SECTION_A = t('advisor.sectionA')
  const SECTION_B = t('advisor.sectionB')
  const SECTION_B4_OPTIONS = t('advisor.sectionB4Options')
  const SECTION_C = t('advisor.sectionC')
  const SECTION_D = t('advisor.sectionD')

  function buildInitialAnswers() {
    const a = {}
    SECTION_A.forEach((q) => (a[q.key] = null))
    SECTION_B.forEach((q) => (a[q.key] = null))
    a.b4 = ''
    SECTION_C.forEach((q) => (a[q.key] = null))
    SECTION_D.forEach((q) => (a[q.key] = null))
    return a
  }

  function riskLabel(score) {
    if (score <= 26) return t('advisor.riskLow')
    if (score <= 42) return t('advisor.riskMedLow')
    if (score <= 56) return t('advisor.riskMed')
    return t('advisor.riskHigh')
  }

  // --- existing state ---
  const [showQuestionnaire, setShowQuestionnaire] = useState(false)
  const [answers, setAnswers] = useState(() => buildInitialAnswers())
  const [step, setStep] = useState(0)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const [advice, setAdvice] = useState(null)
  const [adviceLoading, setAdviceLoading] = useState(false)
  const [adviceError, setAdviceError] = useState('')
  const [history, setHistory] = useState([])

  // --- new state for radars & explanations ---
  // riskDetails is populated only after questionnaire submission in this session.
  const [riskDetails, setRiskDetails] = useState(null)
  // LLM explanation (separate call after questionnaire submit)
  const [riskExplanation, setRiskExplanation] = useState('')
  const [explanationLoading, setExplanationLoading] = useState(false)

  // Portfolio data for Radar 2
  const [portfolioHoldings, setPortfolioHoldings] = useState(null)
  const [portfolioMetrics, setPortfolioMetrics] = useState(null)
  const [optimizeData, setOptimizeData] = useState(null)
  const [portfolioLoading, setPortfolioLoading] = useState(false)
  const [portfolioError, setPortfolioError] = useState('')

  // Load advice history on mount
  useEffect(() => {
    if (user?.risk_score) {
      getAdviceHistory().then(setHistory).catch(console.error)
    }
  }, [user?.risk_score])

  // Load portfolio data for Radar 2 on mount (when user already has a risk score)
  useEffect(() => {
    if (!user?.risk_score) return
    setPortfolioLoading(true)
    setPortfolioError('')
    Promise.all([
      getPortfolio(),
      getPortfolioMetrics(),
      optimizePortfolio(),
    ])
      .then(([port, metrics, opt]) => {
        setPortfolioHoldings(port.holdings)
        setPortfolioMetrics(metrics)
        setOptimizeData(opt)
      })
      .catch((err) => setPortfolioError(err.message))
      .finally(() => setPortfolioLoading(false))
  }, [user?.risk_score])

  function setAnswer(key, val) {
    setAnswers((prev) => ({ ...prev, [key]: val }))
  }

  async function handleSubmitQuestionnaire() {
    setSubmitError('')

    const allQuestions = [...SECTION_A, ...SECTION_B, ...SECTION_C, ...SECTION_D]
    const hasUnanswered = allQuestions.some((q) => answers[q.key] == null) || !answers.b4
    if (hasUnanswered) {
      setSubmitError(t('advisor.answerAllRequired'))
      return
    }

    setSubmitLoading(true)
    try {
      const payload = {
        section_a: Object.fromEntries(SECTION_A.map((q) => [q.key, answers[q.key]])),
        section_b: { b1: answers.b1, b2: answers.b2, b3: answers.b3, b4: answers.b4 },
        section_c: Object.fromEntries(SECTION_C.map((q) => [q.key, answers[q.key]])),
        section_d: Object.fromEntries(
          SECTION_D.map((q) => [q.key, answers[q.key] === q.correct + 1])
        ),
      }
      const result = await setRiskProfile(payload)
      const updatedUser = await getMe()
      setUser(updatedUser)
      setShowQuestionnaire(false)

      // Store sub-scores for Radar 1 and deterministic explanation
      setRiskDetails({
        section_scores: result.section_scores,
        bands: result.bands,
        prudence_applied: result.prudence_applied,
        knowledge_level: result.knowledge_level,
      })

      // Kick off LLM explanation asynchronously (does not block the questionnaire close)
      setRiskExplanation('')
      setExplanationLoading(true)
      explainRiskProfile({
        risk_score: result.risk_score,
        section_scores: result.section_scores,
        bands: result.bands,
        prudence_applied: result.prudence_applied,
        knowledge_level: result.knowledge_level,
      })
        .then((r) => setRiskExplanation(r.explanation))
        .catch(() => setRiskExplanation(''))
        .finally(() => setExplanationLoading(false))
    } catch (err) {
      setSubmitError(err.message)
    } finally {
      setSubmitLoading(false)
    }
  }

  async function handleGenerateAdvice() {
    setAdviceError('')
    setAdviceLoading(true)
    setAdvice(null)
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

      {/* ------------------------------------------------------------------ */}
      {/* Risk profile status                                                 */}
      {/* ------------------------------------------------------------------ */}
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

      {/* ------------------------------------------------------------------ */}
      {/* Questionnaire                                                       */}
      {/* ------------------------------------------------------------------ */}
      {showQuestionnaire && (
        <Card className="ring-0 border-0 dark:bg-gray-900">
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
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('advisor.sectionADesc')}</p>
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
                  <option value="" disabled>{t('advisor.b4Placeholder')}</option>
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

      {/* ------------------------------------------------------------------ */}
      {/* RISK PROFILE ANALYSIS (Radar 1 + explanations)                     */}
      {/* Shown only after questionnaire submission in the current session.  */}
      {/* ------------------------------------------------------------------ */}
      {user?.risk_score && riskDetails && (
        <>
          {/* Radar 1 — MiFID profile */}
          <Card className="ring-0 border-0 dark:bg-gray-900">
            <Title>MiFID II Risk Profile — Radar</Title>
            <Text className="text-gray-400 text-sm mt-1">
              Each axis shows your normalised score (0–100) for that section. The dashed grey area
              is the midpoint benchmark for your risk band.
            </Text>
            <div className="mt-4">
              <MiFIDRadar sectionScores={riskDetails.section_scores} riskScore={user.risk_score} />
            </div>
          </Card>

          {/* Deterministic explanation — section: score breakdown + prudence rule */}
          <Card className="ring-0 border-0 dark:bg-gray-900">
            <Title>Score Breakdown &amp; Prudence Rule</Title>
            <Text className="text-gray-400 text-sm mt-1 mb-4">
              These facts come directly from the scoring algorithm — not from the AI.
            </Text>
            <DeterministicExplanation riskScore={user.risk_score} riskDetails={riskDetails} />
          </Card>

          {/* LLM explanation — personalised, plain-language */}
          <Card className="ring-0 border-0 dark:bg-gray-900">
            <Title>What Your Profile Means</Title>
            <Text className="text-gray-400 text-sm mt-1">
              A personalised explanation generated by the AI from your actual scores. The model is
              instructed not to invent numbers.
            </Text>
            {explanationLoading && (
              <p className="mt-4 text-sm text-gray-400 animate-pulse">Generating explanation…</p>
            )}
            {!explanationLoading && riskExplanation && (
              <div className="mt-4 rounded-lg bg-gray-50 dark:bg-gray-800 p-4 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {riskExplanation}
              </div>
            )}
            {!explanationLoading && !riskExplanation && (
              <p className="mt-4 text-sm text-gray-400">No explanation available.</p>
            )}
          </Card>
        </>
      )}

      {/* Hint when score exists but radar not yet visible (page reload) */}
      {user?.risk_score && !riskDetails && (
        <Card className="ring-0 border-0 dark:bg-gray-900">
          <Text className="text-gray-400 text-sm">
            Retake the questionnaire to see your detailed MiFID II radar chart and score breakdown.
          </Text>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* AI Advice                                                           */}
      {/* ------------------------------------------------------------------ */}
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
              advice.is_structured
                ? <StructuredAdvice advice={advice} />
                : (
                  <div className="mt-4">
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-4 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                      {advice.raw_text ?? String(advice)}
                    </div>
                  </div>
                )
            )}
          </Card>

          {/* -------------------------------------------------------------- */}
          {/* RADAR 2 — Recommended vs Current portfolio                      */}
          {/* -------------------------------------------------------------- */}
          <Card className="ring-0 border-0 dark:bg-gray-900">
            <Title>Portfolio Comparison — Recommended vs Current</Title>
            <Text className="text-gray-400 text-sm mt-1">
              Green = recommended (Black-Litterman optimizer). Blue = your current holdings.
              All axes are normalised 0–100.
            </Text>

            {portfolioLoading && (
              <p className="mt-4 text-sm text-gray-400 animate-pulse">Loading portfolio data…</p>
            )}
            {!portfolioLoading && portfolioError && (
              <p className="mt-4 text-sm text-amber-600 dark:text-amber-400">
                Could not load portfolio data: {portfolioError}
              </p>
            )}
            {!portfolioLoading && !portfolioError && portfolioMetrics && optimizeData && portfolioHoldings && portfolioHoldings.length > 0 && (
              <div className="mt-4 space-y-6">
                <PortfolioRadar
                  currentMetrics={portfolioMetrics}
                  optimizeData={optimizeData}
                  holdings={portfolioHoldings}
                />
                <PortfolioRadarLegend
                  currentMetrics={portfolioMetrics}
                  optimizeData={optimizeData}
                  holdings={portfolioHoldings}
                />
              </div>
            )}
            {!portfolioLoading && !portfolioError && (!portfolioHoldings || portfolioHoldings.length === 0) && (
              <p className="mt-4 text-sm text-gray-400">
                No holdings found. Add assets to your portfolio to see the comparison.
              </p>
            )}
            {!portfolioLoading && !portfolioError && portfolioHoldings && portfolioHoldings.length > 0 && !optimizeData && (
              <p className="mt-4 text-sm text-gray-400">
                Recommended portfolio not yet available. Make sure you have at least 2 holdings with
                sufficient price history to run the optimiser.
              </p>
            )}
          </Card>

          {/* -------------------------------------------------------------- */}
          {/* Advice history                                                  */}
          {/* -------------------------------------------------------------- */}
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
                    <div className="px-4 pb-4">
                      {typeof item.content === 'object' && item.content?.is_structured
                        ? <StructuredAdvice advice={item.content} />
                        : (
                          <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                            {item.content?.raw_text ?? (typeof item.content === 'string' ? item.content : JSON.stringify(item.content))}
                          </p>
                        )
                      }
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

export default function AIAdvisor() {
  return (
    <AIAdvisorErrorBoundary>
      <AIAdvisorInner />
    </AIAdvisorErrorBoundary>
  )
}
