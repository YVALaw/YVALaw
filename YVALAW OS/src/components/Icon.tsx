import type { ReactNode } from 'react'

type IconProps = {
  size?: number
  stroke?: number
  className?: string
  color?: string
}

function svg(w: number, h: number, children: ReactNode, { stroke = 1.5, className, color }: Omit<IconProps, 'size'> = {}) {
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    >
      {children}
    </svg>
  )
}

export const IconHome     = (p: IconProps) => svg(18, 18, <><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>, p)
export const IconUsers    = (p: IconProps) => svg(18, 18, <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>, p)
export const IconBriefcase= (p: IconProps) => svg(18, 18, <><rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/></>, p)
export const IconFileText = (p: IconProps) => svg(18, 18, <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></>, p)
export const IconMessage  = (p: IconProps) => svg(18, 18, <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>, p)
export const IconSettings = (p: IconProps) => svg(18, 18, <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></>, p)
export const IconCreditCard=(p: IconProps) => svg(18, 18, <><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></>, p)
export const IconDocument = (p: IconProps) => svg(18, 18, <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><polyline points="14 2 14 8 20 8"/></>, p)
export const IconFolder   = (p: IconProps) => svg(18, 18, <><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></>, p)
export const IconClock    = (p: IconProps) => svg(18, 18, <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>, p)
export const IconCalendar = (p: IconProps) => svg(18, 18, <><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></>, p)
export const IconSearch   = (p: IconProps) => svg(18, 18, <><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/></>, p)
export const IconPlus     = (p: IconProps) => svg(16, 16, <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>, p)
export const IconChevronDown=(p: IconProps) => svg(16, 16, <><polyline points="6 9 12 15 18 9"/></>, p)
export const IconChevronRight=(p: IconProps) => svg(16, 16, <><polyline points="9 18 15 12 9 6"/></>, p)
export const IconChevronLeft=(p: IconProps) => svg(16, 16, <><polyline points="15 18 9 12 15 6"/></>, p)
export const IconMoreHorizontal=(p: IconProps) => svg(16, 16, <><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>, p)
export const IconMoreVertical=(p: IconProps) => svg(16, 16, <><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></>, p)
export const IconEye      = (p: IconProps) => svg(16, 16, <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>, p)
export const IconEdit     = (p: IconProps) => svg(16, 16, <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>, p)
export const IconTrash    = (p: IconProps) => svg(16, 16, <><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>, p)
export const IconMail     = (p: IconProps) => svg(16, 16, <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>, p)
export const IconPhone    = (p: IconProps) => svg(16, 16, <><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></>, p)
export const IconSend     = (p: IconProps) => svg(16, 16, <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>, p)
export const IconDownload = (p: IconProps) => svg(16, 16, <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></>, p)
export const IconUpload   = (p: IconProps) => svg(16, 16, <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></>, p)
export const IconCheck    = (p: IconProps) => svg(16, 16, <><polyline points="20 6 9 17 4 12"/></>, p)
export const IconX        = (p: IconProps) => svg(16, 16, <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>, p)
export const IconAlert    = (p: IconProps) => svg(16, 16, <><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></>, p)
export const IconInfo     = (p: IconProps) => svg(16, 16, <><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="16" y2="12"/><line x1="12" x2="12.01" y1="8" y2="8"/></>, p)
export const IconBell     = (p: IconProps) => svg(18, 18, <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>, p)
export const IconLayout   = (p: IconProps) => svg(18, 18, <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></>, p)
export const IconGrid     = (p: IconProps) => svg(18, 18, <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></>, p)
export const IconList     = (p: IconProps) => svg(18, 18, <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>, p)
export const IconKanban   = (p: IconProps) => svg(18, 18, <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></>, p)
export const IconDollar   = (p: IconProps) => svg(16, 16, <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>, p)
export const IconTrendUp  = (p: IconProps) => svg(16, 16, <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>, p)
export const IconTrendDown= (p: IconProps) => svg(16, 16, <><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></>, p)
export const IconLock     = (p: IconProps) => svg(16, 16, <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>, p)
export const IconUnlock   = (p: IconProps) => svg(16, 16, <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></>, p)
export const IconUser     = (p: IconProps) => svg(16, 16, <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>, p)
export const IconUserPlus = (p: IconProps) => svg(16, 16, <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></>, p)
export const IconBuilding = (p: IconProps) => svg(16, 16, <><path d="M3 21h18"/><path d="M5 21V7l8-4 8 4v14"/><path d="M9 21v-6h6v6"/></>, p)
export const IconMapPin   = (p: IconProps) => svg(16, 16, <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></>, p)
export const IconGlobe    = (p: IconProps) => svg(16, 16, <><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></>, p)
export const IconAward    = (p: IconProps) => svg(16, 16, <><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></>, p)
export const IconShield   = (p: IconProps) => svg(16, 16, <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>, p)
export const IconBarChart = (p: IconProps) => svg(16, 16, <><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></>, p)
export const IconPieChart = (p: IconProps) => svg(16, 16, <><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></>, p)
export const IconPrinter  = (p: IconProps) => svg(16, 16, <><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></>, p)
export const IconLink     = (p: IconProps) => svg(16, 16, <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>, p)
export const IconCopy     = (p: IconProps) => svg(16, 16, <><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>, p)
export const IconRefresh  = (p: IconProps) => svg(16, 16, <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>, p)
export const IconFilter   = (p: IconProps) => svg(16, 16, <><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></>, p)
export const IconSort     = (p: IconProps) => svg(16, 16, <><line x1="12" y1="4" x2="12" y2="20"/><polyline points="6 14 12 20 18 14"/></>, p)
export const IconArrowUp  = (p: IconProps) => svg(16, 16, <><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></>, p)
export const IconArrowDown= (p: IconProps) => svg(16, 16, <><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></>, p)
export const IconLogOut   = (p: IconProps) => svg(16, 16, <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></>, p)
export const IconLogIn    = (p: IconProps) => svg(16, 16, <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></>, p)
export const IconMenu     = (p: IconProps) => svg(18, 18, <><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></>, p)
export const IconCamera   = (p: IconProps) => svg(16, 16, <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></>, p)
export const IconInbox    = (p: IconProps) => svg(16, 16, <><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>, p)
export const IconPackage  = (p: IconProps) => svg(16, 16, <><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></>, p)
export const IconLayers   = (p: IconProps) => svg(16, 16, <><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></>, p)
export const IconHash     = (p: IconProps) => svg(16, 16, <><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></>, p)
export const IconHelpCircle=(p: IconProps) => svg(16, 16, <><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></>, p)
export const IconHeart    = (p: IconProps) => svg(16, 16, <><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></>, p)
export const IconStar     = (p: IconProps) => svg(16, 16, <><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></>, p)
export const IconZap      = (p: IconProps) => svg(16, 16, <><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></>, p)
export const IconActivity = (p: IconProps) => svg(16, 16, <><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></>, p)
export const IconPaperclip= (p: IconProps) => svg(16, 16, <><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></>, p)
export const IconClipboard= (p: IconProps) => svg(16, 16, <><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></>, p)
export const IconPause    = (p: IconProps) => svg(16, 16, <><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></>, p)
export const IconPlay     = (p: IconProps) => svg(16, 16, <><polygon points="5 3 19 12 5 21 5 3"/></>, p)
export const IconStatus   = (p: IconProps) => svg(16, 16, <><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></>, p)
export const IconImage    = (p: IconProps) => svg(16, 16, <><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>, p)
export const IconMusic    = (p: IconProps) => svg(16, 16, <><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>, p)
export const IconFileCheck= (p: IconProps) => svg(16, 16, <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><polyline points="14 2 14 8 20 8"/><path d="m9 15 2 2 4-4"/></>, p)
export const IconSparkles = (p: IconProps) => svg(16, 16, <><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></>, p)
export const IconWave     = (p: IconProps) => svg(16, 16, <><path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></>, p)
export const IconRepeat   = (p: IconProps) => svg(16, 16, <><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>, p)
export const IconRotateCcw= (p: IconProps) => svg(16, 16, <><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></>, p)
export const IconExternalLink=(p: IconProps) => svg(16, 16, <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></>, p)
export const IconTarget   = (p: IconProps) => svg(16, 16, <><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>, p)
export const IconFlag     = (p: IconProps) => svg(16, 16, <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></>, p)
export const IconSliders  = (p: IconProps) => svg(16, 16, <><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></>, p)
export const IconFile     = (p: IconProps) => svg(16, 16, <><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></>, p)
export const IconHandshake= (p: IconProps) => svg(16, 16, <><path d="M11.5 14.5 9 17l-3-3 2.5-2.5"/><path d="m14.5 9.5 3-3 3 3-3 3"/><path d="m7.5 12.5 3-3 3 3-3 3"/><path d="M2 12h2"/><path d="M20 12h2"/></>, p)
export const IconWallet   = (p: IconProps) => svg(16, 16, <><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M21 12v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5"/><path d="M18 10h2"/></>, p)
export const IconReceipt  = (p: IconProps) => svg(16, 16, <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/></>, p)

// Portal-specific empty state / category icons
export const IconEmptyState = ({ emoji, ...p }: IconProps & { emoji: string }) => (
  <span style={{ fontSize: 42, lineHeight: 1 }}>{emoji}</span>
)
