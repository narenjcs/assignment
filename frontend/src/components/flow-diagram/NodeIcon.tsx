import type { ReactElement } from 'react';

import type { IconKey } from './layout';

export interface NodeIconProps {
  icon: IconKey;
  className?: string;
}

function BrowserIcon(): ReactElement {
  return (
    <>
      <rect x="1" y="2.5" width="14" height="11" rx="1.5" />
      <line x1="1" y1="5.5" x2="15" y2="5.5" />
      <circle cx="3.2" cy="4" r="0.4" fill="currentColor" stroke="none" />
    </>
  );
}

function CylinderIcon(): ReactElement {
  return (
    <>
      <ellipse cx="8" cy="3.5" rx="6" ry="2" />
      <path d="M2 3.5 V12.5 C2 13.6 4.7 14.5 8 14.5 C11.3 14.5 14 13.6 14 12.5 V3.5" />
      <path d="M2 8 C2 9.1 4.7 10 8 10 C11.3 10 14 9.1 14 8" />
    </>
  );
}

function BoltIcon(): ReactElement {
  return <path d="M9 1 L3 9 H7.5 L6.5 15 L13.5 6.5 H9 Z" />;
}

function HubIcon(): ReactElement {
  return (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <circle cx="8" cy="1.8" r="1.2" />
      <circle cx="2.3" cy="11.5" r="1.2" />
      <circle cx="13.7" cy="11.5" r="1.2" />
      <line x1="8" y1="3.6" x2="8" y2="5.8" />
      <line x1="6.4" y1="9.3" x2="3.4" y2="10.7" />
      <line x1="9.6" y1="9.3" x2="12.6" y2="10.7" />
    </>
  );
}

function DocumentIcon(): ReactElement {
  return (
    <>
      <path d="M4 1.5 H10 L13 4.5 V14.5 H4 Z" />
      <path d="M10 1.5 V4.5 H13" />
      <line x1="6" y1="8" x2="11" y2="8" />
      <line x1="6" y1="10.5" x2="11" y2="10.5" />
    </>
  );
}

function GridIcon(): ReactElement {
  return (
    <>
      <rect x="1.5" y="1.5" width="13" height="13" rx="1" />
      <line x1="1.5" y1="6.2" x2="14.5" y2="6.2" />
      <line x1="1.5" y1="10.8" x2="14.5" y2="10.8" />
      <line x1="8" y1="1.5" x2="8" y2="14.5" />
    </>
  );
}

function GatewayIcon(): ReactElement {
  return (
    <>
      <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
      <line x1="4" y1="7" x2="9" y2="7" />
      <line x1="4" y1="9.3" x2="7" y2="9.3" />
      <circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none" />
    </>
  );
}

const ICON_COMPONENT: Record<IconKey, () => ReactElement> = {
  browser: BrowserIcon,
  cylinder: CylinderIcon,
  bolt: BoltIcon,
  hub: HubIcon,
  document: DocumentIcon,
  grid: GridIcon,
  gateway: GatewayIcon,
};

/** Small (16x16) line icons for each node kind, one component per shape so none of them trips
 * the function-length budget. Deliberately generic/geometric rather than a new icon-font
 * dependency — the icon is the fastest way to tell node kinds apart at a glance. */
export function NodeIcon({ icon, className }: NodeIconProps): ReactElement {
  const Shape = ICON_COMPONENT[icon];
  return (
    <svg
      viewBox="0 0 16 16"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <Shape />
    </svg>
  );
}
