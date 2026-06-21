import React from 'react'

// Lucide-style 20×20 icons, stroke-width 1.5. Minimal, consistent.
const Icon = ({ children, size = 20, stroke = 1.5, className = "", style = {} }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size} height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={style}
  >{children}</svg>
);

const I = {
  Home: (p) => (<Icon {...p}><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></Icon>),
  Layout: (p) => (<Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></Icon>),
  Users: (p) => (<Icon {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></Icon>),
  Clock: (p) => (<Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></Icon>),
  Settings: (p) => (<Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></Icon>),
  Gift: (p) => (<Icon {...p}><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M5 12v9h14v-9"/><path d="M12 8a3 3 0 1 0-3-3 3 3 0 0 0 3 3z"/><path d="M12 8a3 3 0 1 1 3-3 3 3 0 0 1-3 3z"/></Icon>),
  TrendUp: (p) => (<Icon {...p}><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></Icon>),
  Users2: (p) => (<Icon {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></Icon>),
  DollarSign: (p) => (<Icon {...p}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></Icon>),
  Eye: (p) => (<Icon {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></Icon>),
  EyeOff: (p) => (<Icon {...p}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></Icon>),
  Plus: (p) => (<Icon {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></Icon>),
  MoreH: (p) => (<Icon {...p}><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></Icon>),
  ChevronLeft: (p) => (<Icon {...p}><polyline points="15 18 9 12 15 6"/></Icon>),
  ChevronRight: (p) => (<Icon {...p}><polyline points="9 18 15 12 9 6"/></Icon>),
  ChevronDown: (p) => (<Icon {...p}><polyline points="6 9 12 15 18 9"/></Icon>),
  X: (p) => (<Icon {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></Icon>),
  AlertTriangle: (p) => (<Icon {...p}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></Icon>),
  Phone: (p) => (<Icon {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></Icon>),
  Tablet: (p) => (<Icon {...p}><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></Icon>),
  WhatsApp: (p) => (<Icon {...p}><path d="M21 12a9 9 0 1 1-3.55-7.16L21 4l-1.16 3.54A9 9 0 0 1 21 12z"/><path d="M8 11a3 3 0 0 0 1 2 4 4 0 0 0 3 2l2-2-2-1-1 1a3 3 0 0 1-2-2l1-1-1-2-2 1z"/></Icon>),
  Sparkles: (p) => (<Icon {...p}><path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></Icon>),
  Bell: (p) => (<Icon {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></Icon>),
  Search: (p) => (<Icon {...p}><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></Icon>),
  Edit: (p) => (<Icon {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></Icon>),
  Refresh: (p) => (<Icon {...p}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15A9 9 0 0 1 5.64 18.36L1 14"/></Icon>),
  Pause: (p) => (<Icon {...p}><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></Icon>),
  Play: (p) => (<Icon {...p}><polygon points="5 3 19 12 5 21 5 3"/></Icon>),
  Check: (p) => (<Icon {...p}><polyline points="20 6 9 17 4 12"/></Icon>),
  Cake: (p) => (<Icon {...p}><path d="M20 21V10a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11"/><path d="M2 21h20"/><path d="M7 8V3M12 8V3M17 8V3"/></Icon>),
  Megaphone: (p) => (<Icon {...p}><path d="M3 11l18-8v18l-18-8z"/><path d="M11.6 19.6a3 3 0 1 1-5.2-3"/></Icon>),
  Palette: (p) => (<Icon {...p}><circle cx="13.5" cy="6.5" r="0.5"/><circle cx="17.5" cy="10.5" r="0.5"/><circle cx="8.5" cy="7.5" r="0.5"/><circle cx="6.5" cy="12.5" r="0.5"/><path d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2v-1a2 2 0 0 1 2-2h3a4 4 0 0 0 4-4 10 10 0 0 0-10-11z"/></Icon>),
  Store: (p) => (<Icon {...p}><path d="M3 9l1.5-5h15L21 9"/><path d="M3 9v11h18V9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/></Icon>),
  Calendar: (p) => (<Icon {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></Icon>),
  Activity: (p) => (<Icon {...p}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></Icon>),
  Trash: (p) => (<Icon {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></Icon>),
  Power: (p) => (<Icon {...p}><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></Icon>),
  Wifi: (p) => (<Icon {...p}><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></Icon>),
  WifiOff: (p) => (<Icon {...p}><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></Icon>),
  Stamp: (p) => (<Icon {...p}><path d="M5 22h14"/><path d="M19.27 17H4.73L3 22h18l-1.73-5z"/><path d="M14 14V8.5a2.5 2.5 0 0 0-5 0V14"/><path d="M9 14h6"/></Icon>),
  ArrowRight: (p) => (<Icon {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></Icon>),
  Lock: (p) => (<Icon {...p}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></Icon>),
  Receipt: (p) => (<Icon {...p}><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/></Icon>),
  CreditCard: (p) => (<Icon {...p}><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></Icon>),
  Package: (p) => (<Icon {...p}><path d="M12 22l-7-4V9l7-4 7 4v9l-7 4z"/><polyline points="12 22 12 12"/><path d="M3.27 6.96L12 12.01l8.73-5.05"/><line x1="19" y1="15" x2="19" y2="21"/><line x1="16" y1="18" x2="22" y2="18"/></Icon>),
  Filter: (p) => (<Icon {...p}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></Icon>),
  SortDesc: (p) => (<Icon {...p}><line x1="11" y1="5" x2="3" y2="5"/><line x1="11" y1="9" x2="5" y2="9"/><line x1="11" y1="13" x2="7" y2="13"/><polyline points="15 9 18 12 21 9"/><line x1="18" y1="4" x2="18" y2="12"/></Icon>),
  Wallet: (p) => (<Icon {...p}><path d="M20 12V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6z"/><circle cx="16" cy="12" r="1"/></Icon>),
  Info: (p) => (<Icon {...p}><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></Icon>),
};

// Umi "X" mark — derived from the brand glyph (two crossing diagonals forming "X")
const UmiX = ({ size = 28, color = "currentColor", className = "", style = {}, strokeWidth = 14 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 100 100" className={className} style={style}>
    <g stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none">
      <line x1="14" y1="14" x2="86" y2="86"/>
      <line x1="86" y1="14" x2="14" y2="86"/>
    </g>
  </svg>
);

export { I, UmiX }
