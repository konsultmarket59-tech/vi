export interface StepPathProps {
  /** Defaults to Идея → Проект → Настройка → Подрядчик → Дом */
  steps?: string[];
  /** 0-based current step */
  current?: number;
  onSelect?: (index: number) => void;
  style?: React.CSSProperties;
}
export declare function StepPath(props: StepPathProps): JSX.Element;