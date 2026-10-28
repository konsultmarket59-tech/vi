export interface RatingProps {
  /** 0–5 */
  value?: number;
  /** Review count, renders "N отзывов" */
  reviews?: number;
  size?: number;
  showValue?: boolean;
  style?: React.CSSProperties;
}
export declare function Rating(props: RatingProps): JSX.Element;