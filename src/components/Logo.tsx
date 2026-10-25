interface LogoMarkProps {
  size?: number
  className?: string
}

export function LogoMark({ size = 36, className = '' }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="12.5" fill="#5D4BE0" />
      <rect x="0.5" y="0.5" width="39" height="39" rx="12" stroke="rgba(255,255,255,.14)" />
      <path
        d="M20 8.6c1.48 5.98 5.42 9.92 11.4 11.4-5.98 1.48-9.92 5.42-11.4 11.4-1.48-5.98-5.42-9.92-11.4-11.4C14.58 18.52 18.52 14.58 20 8.6Z"
        fill="#F7F2E7"
      />
      <circle cx="30.6" cy="9.7" r="3.1" fill="#F2A07E" />
    </svg>
  )
}

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`logo ${small ? 'logo-small' : ''}`}>
      <LogoMark size={small ? 30 : 38} />
      <span className="logo-text">
        <span className="logo-wordmark">
          второй <em>мозг</em>
        </span>
        {!small && <span className="logo-caption">личный кабинет</span>}
      </span>
    </span>
  )
}
