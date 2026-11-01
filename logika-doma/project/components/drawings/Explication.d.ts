export interface ExplicationRoom { n: number; name: string; /** m², shown with comma decimal */ area: number; wet?: boolean; }
export interface ExplicationGroup { /** e.g. "1 этаж" */ title?: string; rooms: ExplicationRoom[]; }
export interface ExplicationProps {
  title?: string;
  groups?: ExplicationGroup[];
  /** Overrides computed sum */
  total?: number;
  /** panel = card over screenshots/renders; sheet = flat table on drawing sheets */
  variant?: 'panel' | 'sheet';
  style?: React.CSSProperties;
}
export declare function Explication(props: ExplicationProps): JSX.Element;