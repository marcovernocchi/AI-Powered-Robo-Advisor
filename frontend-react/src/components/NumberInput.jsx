/**
 * NumberInput — controlled numeric input that:
 * - lets the user type freely (stores raw string during editing)
 * - clamps/corrects the value on blur (silently, no browser popup)
 * - suppresses all native browser validation UI
 * - supports optional fields (optional=true): if the field is left empty it stays empty (value → '')
 */
export default function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  fallback,   // value to restore on blur if empty and NOT optional (defaults to min ?? 0)
  optional,   // if true: allow empty string (represents null / no value)
  className,
  placeholder,
  ...rest
}) {
  function handleBlur(e) {
    const raw = e.target.value.trim()
    if (raw === '') {
      if (optional) {
        onChange('')
        return
      }
      // required field: restore to fallback → min → 0
      onChange(String(fallback ?? min ?? 0))
      return
    }
    let n = parseFloat(raw)
    if (isNaN(n)) {
      onChange(String(fallback ?? min ?? 0))
      return
    }
    if (min !== undefined && n < min) n = min
    if (max !== undefined && n > max) n = max
    onChange(String(n))
  }

  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      className={className}
      onChange={(e) => onChange(e.target.value)}
      onBlur={handleBlur}
      onInvalid={(e) => e.preventDefault()}
      {...rest}
    />
  )
}
