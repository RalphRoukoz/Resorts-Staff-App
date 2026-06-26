import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  fullWidth?: boolean
}

const variants: Record<Variant, string> = {
  primary:
    'bg-[var(--accent)] text-white shadow-sm hover:opacity-90 disabled:opacity-50',
  secondary:
    'border border-[#ECECEC] bg-white text-[#1A1A1A] hover:bg-gray-50 disabled:opacity-50',
  danger:
    'border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:opacity-50',
  ghost: 'bg-transparent text-gray-600 hover:bg-gray-100',
}

export function Button({
  variant = 'primary',
  fullWidth,
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium tracking-tight transition duration-200 active:scale-[0.98] disabled:cursor-not-allowed ${variants[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
