/**
 * Primary action button. Navy filled primary, outlined secondary, text-link tertiary.
 * @startingPoint section="Core" subtitle="Buttons — primary, secondary, tertiary, states" viewport="700x260"
 */
export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'tertiary';
  size?: 'sm' | 'md' | 'lg';
  /** Lucide icon name before label */
  icon?: string;
  /** Lucide icon name after label (e.g. "chevron-right", "arrow-right") */
  iconRight?: string;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  children?: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}
export declare function Button(props: ButtonProps): JSX.Element;