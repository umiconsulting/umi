'use client'

import Link from 'next/link'

interface BreadcrumbItem {
  label: string
  href?: string
}

interface BreadcrumbProps {
  items: BreadcrumbItem[]
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav className="flex items-center gap-1.5 mb-4 text-[11px] font-mono">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && (
            <span style={{ color: 'var(--text-dim)' }}>—</span>
          )}
          {item.href ? (
            <Link
              href={item.href}
              className="transition-colors"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--foreground)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
            >
              {item.label}
            </Link>
          ) : (
            <span style={{ color: 'var(--foreground)' }}>{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
