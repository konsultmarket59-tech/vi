/**
 * Site header — desktop (logo, nav, search, favourites, CTA) or mobile (menu, logo, search, profile).
 * @startingPoint section="Navigation" subtitle="Desktop + mobile header, breadcrumbs, step path" viewport="700x320"
 */
export interface HeaderProps {
  /** Path to assets/logo-horizontal.svg relative to the page. Without it, the type-only wordmark renders. */
  logoSrc?: string;
  nav?: string[];
  active?: string;
  onNavigate?: (item: string) => void;
  onLogo?: () => void;
  ctaLabel?: string;
  onCta?: () => void;
  variant?: 'desktop' | 'mobile';
  style?: React.CSSProperties;
}
export declare function Header(props: HeaderProps): JSX.Element;
export interface WordmarkProps { src?: string; height?: number; inverse?: boolean; onClick?: () => void; }
export declare function Wordmark(props: WordmarkProps): JSX.Element;