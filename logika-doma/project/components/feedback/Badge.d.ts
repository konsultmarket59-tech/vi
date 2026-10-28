export interface BadgeProps {
  /** navy=Популярный, cyan=Новинка, coral=Акция, orange=Премиум; soft/outline for spec chips (120 м², 1 этаж) */
  tone?: 'navy' | 'orange' | 'cyan' | 'coral' | 'blue' | 'soft' | 'outline';
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Badge(props: BadgeProps): JSX.Element;