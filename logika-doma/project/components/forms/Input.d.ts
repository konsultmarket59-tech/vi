export interface InputProps {
  label?: string;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Leading Lucide icon */
  icon?: string;
  /** Trailing unit text, e.g. "м²", "₽" */
  suffix?: string;
  error?: string;
  type?: string;
  style?: React.CSSProperties;
}
export declare function Input(props: InputProps): JSX.Element;