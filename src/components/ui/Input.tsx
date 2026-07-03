import { forwardRef, type InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, id, className = '', ...props },
  ref,
) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-')

  return (
    <label htmlFor={inputId} className="block">
      {label ? (
        <span className="mb-1.5 block text-sm font-medium text-gray-700">{label}</span>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        className={`w-full rounded-xl border border-[#ECECEC] bg-white px-3.5 py-2.5 text-[#1A1A1A] placeholder:text-gray-400 transition focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 ${className}`}
        {...props}
      />
      {error ? <span className="mt-1 block text-sm text-red-600">{error}</span> : null}
    </label>
  )
})
