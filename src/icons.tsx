// SVG icons extracted from the design prototype. All use currentColor and a
// 16x16 viewBox unless noted, so they inherit text color and scale via `size`.
import type { CSSProperties } from "react";

interface IconProps {
  size?: number;
  style?: CSSProperties;
}
const base = (size = 16, style?: CSSProperties) => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  fill: "none" as const,
  style,
});

export const SidebarIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
    <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

export const SearchIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
    <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const ListIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <line x1="2" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="1.4" />
    <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.4" />
    <line x1="2" y1="12" x2="14" y2="12" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const CardIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <rect x="2" y="2.5" width="12" height="4.5" rx="1.3" stroke="currentColor" strokeWidth="1.3" />
    <rect x="2" y="9" width="12" height="4.5" rx="1.3" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

export const AllPapersIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2.2" stroke="currentColor" strokeWidth="1.3" />
    <line x1="2.5" y1="6.3" x2="13.5" y2="6.3" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

export const ClockIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M8 5v3l2 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

export const StarIcon = ({ size, style, fill = "none" }: IconProps & { fill?: string }) => (
  <svg width={size ?? 16} height={size ?? 16} viewBox="0 0 16 16" fill={fill} style={style}>
    <path
      d="M8 1.7l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.7 4.3 13.7l.8-4.2L2 6.6l4.2-.5z"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
  </svg>
);

export const StarNavIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <path
      d="M8 1.7l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.7 4.3 13.7l.8-4.2L2 6.6l4.2-.5z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
);

export const DotIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <circle cx="8" cy="8" r="3" fill="currentColor" />
  </svg>
);

export const NotebookIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <rect x="3" y="2" width="10" height="12" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
    <line x1="5.5" y1="5" x2="10.5" y2="5" stroke="currentColor" strokeWidth="1.2" />
    <line x1="5.5" y1="7.5" x2="10.5" y2="7.5" stroke="currentColor" strokeWidth="1.2" />
    <line x1="5.5" y1="10" x2="8.5" y2="10" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

export const WatchFolderIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <path
      d="M2.5 12V6l5.5-3.3L13.5 6v6a1 1 0 01-1 1H9.5v-3.5h-3V13H3.5a1 1 0 01-1-1z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <circle cx="11.5" cy="4.5" r="2.3" fill="var(--green)" stroke="var(--bg-sidebar)" strokeWidth="1" />
  </svg>
);

export const SettingsIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <circle cx="8" cy="8" r="2.3" stroke="currentColor" strokeWidth="1.3" />
    <path
      d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);

export const PlusIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

export const SortIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <path d="M5 10l-2 2-2-2M3 12V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="7" y1="5" x2="14" y2="5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <line x1="7" y1="8" x2="12" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <line x1="7" y1="11" x2="10" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

export const MoreIcon = ({ size, style }: IconProps) => (
  <svg width={size ?? 16} height={size ?? 16} viewBox="0 0 16 16" fill="currentColor" style={style}>
    <circle cx="3.5" cy="8" r="1.4" />
    <circle cx="8" cy="8" r="1.4" />
    <circle cx="12.5" cy="8" r="1.4" />
  </svg>
);

export const ChevronLeftIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const StickyIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <path d="M2.5 3.5a1 1 0 011-1h9a1 1 0 011 1v6l-4 4h-6a1 1 0 01-1-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M13.5 9.5h-3a1 1 0 00-1 1v3" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

export const AnnPanelIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <rect x="2" y="2.5" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
    <line x1="10" y1="2.5" x2="10" y2="13.5" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

export const CheckIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <path d="M3 8.5L6.5 12 13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const FolderIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <path
      d="M1.5 5.5a1 1 0 011-1h3.4l1.2 1.4h6.4a1 1 0 011 1v5.6a1 1 0 01-1 1h-11a1 1 0 01-1-1z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
);

export const CopyIcon = ({ size, style }: IconProps) => (
  <svg {...base(size, style)}>
    <rect x="5" y="5" width="9" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
    <path d="M3 11V3.5A1.5 1.5 0 014.5 2H11" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const UploadIcon = ({ size = 24, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
    <path d="M12 16V4M12 4L7 9M12 4l5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

export const BookLogoIcon = ({ size = 32, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
    <path
      d="M5 4.5A1.5 1.5 0 016.5 3H17a2 2 0 012 2v14a2 2 0 01-2 2H6.5A1.5 1.5 0 015 19.5z"
      stroke="#fff"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <line x1="9" y1="8" x2="15" y2="8" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    <line x1="9" y1="11.5" x2="15" y2="11.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
