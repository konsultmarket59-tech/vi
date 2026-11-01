export interface StatusDotProps {
  status?: 'draft' | 'review' | 'progress' | 'done';
  /** Override default Russian label */
  label?: string;
  style?: React.CSSProperties;
}
export declare function StatusDot(props: StatusDotProps): JSX.Element;