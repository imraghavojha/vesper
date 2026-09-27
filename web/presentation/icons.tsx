import { useId, type SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 24, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ChatIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4.5c4.7 0 8 2.9 8 6.6s-3.3 6.6-8 6.6c-.9 0-1.8-.1-2.6-.3L5.6 19l.9-3.1C4.9 14.7 4 13 4 11.1 4 7.4 7.3 4.5 12 4.5Z" />
  </Icon>
);
export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
);
export const FeedIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6" y="4" width="13" height="16" rx="2.5" />
    <path d="M6 7H4.5v11A2 2 0 0 0 6.5 20M9.5 8.5h6M9.5 12h6M9.5 15.5h3.5" />
  </Icon>
);
export const IdeaIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 17.5h6M10 20.5h4M12 3.5a6 6 0 0 0-3.4 10.9c.6.5.9 1.1.9 1.8v1.3h5v-1.3c0-.7.3-1.3.9-1.8A6 6 0 0 0 12 3.5Z" />
  </Icon>
);
export const GoalIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4.5" y="4.5" width="15" height="15" rx="3.5" />
    <path d="m8.8 12.2 2.3 2.3 4.3-4.8" />
  </Icon>
);
export const LibraryIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7.5" cy="16.5" r="3" />
    <rect x="13.5" y="13.5" width="6" height="6" rx="1.5" />
    <path d="M7.5 4.5 11 10H4Z" />
    <circle cx="16.5" cy="7.5" r="3" />
  </Icon>
);
export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 9h14M5 15h14" />
  </Icon>
);
export const MoreIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="6" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="18" cy="12" r="1" fill="currentColor" stroke="none" />
  </Icon>
);
export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);
export const ArrowUpIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={2}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);
export const StopIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
  </Icon>
);
export const MicIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
  </Icon>
);
export const BoltIcon = (p: IconProps) => (
  <Icon {...p} stroke="none" fill="currentColor">
    <path d="M13.2 2.8 5.6 13.1c-.3.4 0 .9.5.9h4.8l-1.1 7.1c-.1.5.6.8.9.4l7.6-10.3c.3-.4 0-.9-.5-.9h-4.8l1.1-7.1c.1-.5-.6-.8-.9-.4Z" />
  </Icon>
);
export const ModelIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7-5.6-1.9L10.1 9Z" />
  </Icon>
);
export const KeyboardIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="6.5" width="18" height="11" rx="2.5" />
    <path d="M7 10.5h.01M10.3 10.5h.01M13.7 10.5h.01M17 10.5h.01M8 14h8" />
  </Icon>
);
export const SunMoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="7.5" />
    <path d="M12 4.5v15a7.5 7.5 0 0 0 0-15Z" fill="currentColor" />
  </Icon>
);
export const DeviceIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="11" rx="2" />
    <path d="M9 19.5h6M12 16v3.5" />
  </Icon>
);
export const ExpandIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5 13.5 10.5M4.5 19.5l6-6" />
  </Icon>
);
export const PanelIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <path d="M14.5 4.5v15" />
  </Icon>
);
export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m7 10 5 5 5-5" />
  </Icon>
);
export const ActivityIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.5 7h10M9.5 12h10M9.5 17h10" />
    <circle cx="5" cy="7" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="5" cy="12" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="5" cy="17" r="0.9" fill="currentColor" stroke="none" />
  </Icon>
);
export const ApprovalIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5 5.5 6v5.2c0 4 2.7 7.5 6.5 9.3 3.8-1.8 6.5-5.3 6.5-9.3V6Z" />
    <path d="m9 12 2.2 2.2L15.2 10" />
  </Icon>
);
export const UpcomingIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" strokeDasharray="2.2 2.6" />
    <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);
export const IdentityIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.2 6.5A8 8 0 0 1 19.5 11v1.5" />
    <path d="M4.5 10.5A8 8 0 0 0 4 13M8 18.5c.9-1.6 1.3-3.5 1.3-5.5a2.7 2.7 0 0 1 5.4 0c0 1.2-.1 2.4-.4 3.5" />
    <path d="M12 13c0 3-.8 5.7-2.2 7.5M17.2 15.5a18 18 0 0 1-1.2 4" />
  </Icon>
);
export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" />
  </Icon>
);
export const GridIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4.5" y="4.5" width="6" height="6" rx="1.5" />
    <rect x="13.5" y="4.5" width="6" height="6" rx="1.5" />
    <rect x="4.5" y="13.5" width="6" height="6" rx="1.5" />
    <rect x="13.5" y="13.5" width="6" height="6" rx="1.5" />
  </Icon>
);
export const FileIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.5 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-10Z" />
    <path d="M13.5 3.5v5h5" />
  </Icon>
);
export const WalletIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="6" width="17" height="13" rx="3" />
    <path d="M3.5 10h17M15.5 14.5h1.5" />
  </Icon>
);
export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Icon>
);
export const HandIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11M11 10V5a1.5 1.5 0 0 1 3 0v5M14 10V6.5a1.5 1.5 0 0 1 3 0V14a6.5 6.5 0 0 1-12.2 3.1L3.6 14.5a1.5 1.5 0 0 1 2.4-1.8L8 15" />
  </Icon>
);
export const HelpIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.8 9.5a2.3 2.3 0 0 1 4.4.9c0 1.6-2.2 2-2.2 3.4M12 16.8h.01" />
  </Icon>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m10 7 5 5-5 5" />
  </Icon>
);
export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6" />
  </Icon>
);
export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z" />
  </Icon>
);
export const PencilIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15.5 5.5 18.5 8.5 9 18l-4 1 1-4Z" />
  </Icon>
);

/**
 * Original Vesper avatar: an evening sky with a single bright star over a
 * low horizon. Drawn in SVG so it scales from sidebar to panel sizes.
 */
export function VesperAvatar({ size = 100 }: { size?: number }) {
  const id = "vesper-avatar" + useId().replace(/:/g, "");
  return (
    <svg
      className="vesper-avatar"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d2340" />
          <stop offset="0.55" stopColor="#4a3f6b" />
          <stop offset="0.82" stopColor="#c9798a" />
          <stop offset="1" stopColor="#f0b48a" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.64" cy="0.34" r="0.3">
          <stop offset="0" stopColor="#fff6dc" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff6dc" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="50" cy="50" r="50" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-clip)`}>
        <rect width="100" height="100" fill={`url(#${id}-sky)`} />
        <rect width="100" height="100" fill={`url(#${id}-glow)`} />
        <path
          d="M64 22.5c.8 5.6 2.9 7.7 8.5 8.5-5.6.8-7.7 2.9-8.5 8.5-.8-5.6-2.9-7.7-8.5-8.5 5.6-.8 7.7-2.9 8.5-8.5Z"
          fill="#fff8e6"
        />
        <circle cx="30" cy="30" r="0.9" fill="#fff" opacity="0.7" />
        <circle cx="42" cy="18" r="0.7" fill="#fff" opacity="0.55" />
        <circle cx="22" cy="46" r="0.6" fill="#fff" opacity="0.45" />
        <path
          d="M0 80c16-6 30-8 48-5s34 2 52-4v29H0Z"
          fill="#231d33"
          opacity="0.92"
        />
        <path
          d="M0 88c20-5 38-5 56-2s30 1 44-3v17H0Z"
          fill="#15121f"
        />
      </g>
    </svg>
  );
}
