export interface RangeSliderProps {
  min?: number;
  max?: number;
  step?: number;
  /** [from, to] */
  value?: [number, number];
  defaultValue?: [number, number];
  onChange?: (v: [number, number]) => void;
  label?: string;
  /** Unit shown in value boxes, e.g. "м²", "₽" */
  unit?: string;
  format?: (n: number) => string;
  style?: React.CSSProperties;
}
export declare function RangeSlider(props: RangeSliderProps): JSX.Element;