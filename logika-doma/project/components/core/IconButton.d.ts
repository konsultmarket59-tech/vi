export interface IconButtonProps {
  /** Lucide icon name */
  icon: string;
  size?: number;
  variant?: 'outline' | 'ghost';
  /** Accessible label (also tooltip) */
  label?: string;
  onClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}
export declare function IconButton(props: IconButtonProps): JSX.Element;