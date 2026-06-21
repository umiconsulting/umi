'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Activity,
  Zap,
  MessageSquare,
  Users,
  Cpu,
  Database,
  ShieldAlert,
  Phone,
  Layers,
  Slack,
  LogOut,
  ChevronDown,
  Workflow,
  ListTodo,
  Send,
} from 'lucide-react'
import { createBrowserSupabase } from '@/lib/supabase-browser'
import { useState } from 'react'

const sections = [
  {
    name: 'SYSTEM',
    links: [
      { href: '/', label: 'Activity', icon: Activity },
    ],
  },
  {
    name: 'OPERATIONS',
    links: [
      { href: '/functions',      label: 'Invocations',   icon: Zap },
      { href: '/conversations',  label: 'Conversations', icon: MessageSquare },
      { href: '/customers',      label: 'Customers',     icon: Users },
      { href: '/slack',          label: 'Slack Ops',     icon: Slack },
    ],
  },
  {
    name: 'AI',
    links: [
      { href: '/ai',     label: 'AI Costs', icon: Cpu },
      { href: '/memory', label: 'Memory',   icon: Database },
    ],
  },
  {
    name: 'WORKFLOW',
    links: [
      { href: '/workflow', label: 'Events',  icon: Workflow },
      { href: '/jobs',     label: 'Jobs',    icon: ListTodo },
      { href: '/outbox',   label: 'Outbox',  icon: Send },
    ],
  },
  {
    name: 'RELIABILITY',
    links: [
      { href: '/security',     label: 'Security',     icon: ShieldAlert },
      { href: '/twilio',       label: 'Twilio',       icon: Phone },
      { href: '/integrations', label: 'Integrations', icon: Layers },
    ],
  },
]

interface Business {
  businessId: string
  label: string
}

export function Sidebar({ businesses }: { businesses?: Business[] }) {
  const pathname = usePathname()
  const router = useRouter()
  const [selectorOpen, setSelectorOpen] = useState(false)

  async function handleSignOut() {
    const supabase = createBrowserSupabase()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  function handleSwitchBusiness(businessId: string) {
    document.cookie = `cf_active_business=${businessId};path=/;max-age=${60 * 60 * 24 * 365}`
    setSelectorOpen(false)
    router.refresh()
  }

  const showSelector = businesses && businesses.length > 1

  return (
    <nav
      className="sidebar-nav fixed left-0 top-0 bottom-0 z-50 flex flex-col"
      style={{ background: 'var(--surface-0)' }}
      aria-label="Main navigation"
    >
      {/* Logo mark */}
      <div
        className="h-12 flex items-center px-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span
          className="sidebar-logo shrink-0 text-xs font-bold tracking-widest transition-all duration-300"
          style={{ color: 'var(--status-active)' }}
        >
          CF
        </span>
        <span
          className="sidebar-label ml-2 text-xs font-bold tracking-widest"
          style={{ color: 'var(--status-active)' }}
        >
          ConversaFlow
        </span>
      </div>

      {/* Business selector (only when 2+ businesses) */}
      {showSelector && (
        <div className="px-2 py-2 relative" style={{ borderBottom: '1px solid var(--border)' }}>
          <button
            onClick={() => setSelectorOpen(!selectorOpen)}
            className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-wider rounded"
            style={{
              color: 'var(--text-dim)',
              background: selectorOpen ? 'var(--surface-1)' : 'transparent',
            }}
          >
            <span className="sidebar-label truncate">
              {businesses.find((b) => {
                const active = document.cookie.match(/cf_active_business=([^;]+)/)?.[1]
                return b.businessId === active
              })?.label ?? businesses[0].label}
            </span>
            <ChevronDown size={12} className="sidebar-label shrink-0" />
          </button>
          {selectorOpen && (
            <div
              className="absolute left-2 right-2 mt-1 py-1 rounded z-50"
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
              }}
            >
              {businesses.map((b) => (
                <button
                  key={b.businessId}
                  onClick={() => handleSwitchBusiness(b.businessId)}
                  className="w-full text-left px-3 py-1.5 text-[10px] uppercase tracking-wider hover:opacity-80"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {b.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-2">
        {sections.map((section) => (
          <div key={section.name} className="mb-1">
            <div className="sidebar-section px-3 py-1.5">
              {section.name}
            </div>
            {section.links.map(({ href, label, icon: Icon }) => {
              const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
              return (
                <Link
                  key={href}
                  href={href}
                  className={`nav-link ${isActive ? 'nav-link-active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {/* Active indicator morphs via View Transitions */}
                  <span
                    className="sidebar-indicator shrink-0 flex items-center justify-center"
                    style={isActive ? { viewTransitionName: 'nav-indicator' } as React.CSSProperties : {}}
                  >
                    <Icon
                      size={16}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="sidebar-label text-xs">{label}</span>
                </Link>
              )
            })}
          </div>
        ))}
      </div>

      {/* Bottom — logout */}
      <div
        className="shrink-0"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <button
          onClick={handleSignOut}
          className="nav-link w-full"
          title="Sign out"
        >
          <span className="sidebar-indicator shrink-0 flex items-center justify-center">
            <LogOut size={16} aria-hidden="true" />
          </span>
          <span className="sidebar-label text-xs">Sign out</span>
        </button>
      </div>
    </nav>
  )
}
