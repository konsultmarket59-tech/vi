export interface RoomTagProps {
  n: number;
  name: string;
  area: number;
  /** Clear dimensions in mm, e.g. "4750 × 2290" */
  dims?: string;
  /** Wet zone (санузел, котельная, сауна) — blue node */
  wet?: boolean;
  scale?: number;
  style?: React.CSSProperties;
}
export declare function RoomTag(props: RoomTagProps): JSX.Element;