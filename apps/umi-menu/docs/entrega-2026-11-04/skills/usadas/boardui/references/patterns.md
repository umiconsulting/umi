# BoardUI page patterns

Anatomy recipes for the pages BoardUI is built for. These are structural skeletons: install the named components first (`npx boardui@latest add <names>`), then open their installed source under `components/` for the exact props. Component APIs are self-documenting; every file carries a doc comment with its variant and size matrix. The catalog in [components.md](components.md) has a working usage example per component.

Shared rules for every page:

- Page ground is `bg-background-full`; cards sit on it as `rounded-3xl border border-border-button-default bg-background-primary-default`.
- Group cards with grid `gap`, never per-card margins.
- Section headings are `text-title-2-medium text-text-primary`; supporting copy is `text-body-regular text-text-secondary`.
- Anything using React Aria tables (`table`, `data-table`) or handlers/state lives in a `"use client"` module.

## Dashboard page

Components: `sidebar`, `stat-cards`, plus chart cards to taste (`area-chart-card`, `earnings-chart-card`, `bar-list-card`, `contributions-card`, ...) and `data-table`. The Pro template `template-home-dashboard` ships this whole page finished.

```tsx
// app/dashboard/page.tsx
import { DashboardSidebar } from "@/components/application/dashboard/dashboard-sidebar";
import { StatCards } from "@/components/application/dashboard/stat-cards";

export default function DashboardPage() {
  return (
    <div className="flex min-h-screen bg-background-full">
      <DashboardSidebar />
      <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">
        <h1 className="text-title-1-medium text-text-primary">Overview</h1>
        <StatCards />               {/* KPI row: 3-4 headline numbers with deltas */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* chart cards here; each is a finished card, no wrapper needed */}
        </div>
        {/* orders/customers table: a "use client" section with the data-table */}
      </main>
    </div>
  );
}
```

Chart cards are self-contained (header, chart, legend, hover states). Compose the grid; do not unwrap them or rebuild their internals with raw recharts.

## Table page

Components: `data-table` (free, TanStack sorting/selection/pagination) or `table` for simple listings; `badge` and `avatar` for cells; `input` + `select` in the toolbar.

```tsx
// components/orders/orders-table.tsx
"use client";                       // React Aria tables render zero columns server-side

import { DataTable } from "@/components/application/data-table/data-table";

export function OrdersTable() {
  return <DataTable /* columns + data per the installed file's doc comment */ />;
}
```

Toolbar row above the table: search `input` on the left, filter `select`/`dropdown` and the primary action `button` on the right, in one `flex items-center justify-between gap-3` row.

## Auth page

Components: `auth-card`, `social-button`, `input`, `button`.

```tsx
// app/sign-in/page.tsx
import { AuthCard } from "@/components/application/auth/auth-card";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background-full p-6">
      <AuthCard />                  {/* logo, fields, primary CTA, social buttons, footer links */}
    </main>
  );
}
```

`auth-card` already composes the inputs, social buttons, and links. Restyle by editing the installed source, not by wrapping it.

## AI chat page

Components: `composer` (Pro; the chat input with model/effort controls), `agent-thinking` (free reasoning disclosure), `agent-progress` and `task-list` (Pro) for long-running work, `composer-loader` (free) for the streaming state. The Pro template `template-ai-chat` ships the complete app (sidebar, resizable code panel, composer).

```tsx
// app/chat/page.tsx (client component: chat state lives here)
"use client";

import { Composer } from "@/components/application/ai-chat/ai-chat-composer";
import { AgentThinking } from "@/components/application/agent-thinking/agent-thinking";

export default function ChatPage() {
  return (
    <div className="mx-auto flex h-screen max-w-3xl flex-col bg-background-full">
      <div className="flex-1 overflow-y-auto py-6">
        {/* message list; assistant turns can open with <AgentThinking /> */}
      </div>
      <div className="pb-6">
        <Composer /* onSubmit etc. per the installed file */ />
      </div>
    </div>
  );
}
```

## Settings

Components: `settings-modal` (free, sectioned modal shell) for in-app settings; `tabs` + form components (`input`, `select`, `switch`, `checkbox`) for a full settings page. Forms extend BoardUI's react-aria form components; never raw `<input>`/`<select>`.

## When a template fits, use it

The Pro templates install a complete route plus every component it uses, wired and styled: `template-home-dashboard`, `template-marketing`, `template-finance`, `template-hr`, `template-medical-profile`, `template-ai-chat`, `template-ai-profile`, `template-ai-image-generation`. If the user describes a page that matches one, installing the template and editing it beats composing from scratch.
