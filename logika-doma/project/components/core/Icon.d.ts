export interface IconProps {
  /** Lucide icon name in kebab-case, e.g. "house", "map-pin", "chevron-right" */
  name: string;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}
export declare function Icon(props: IconProps): JSX.Element;