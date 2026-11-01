export interface TitleBlockProps {
  /** Path to assets/mark.png */
  logoSrc?: string;
  /** Project name, e.g. "Логика Дома" */
  project: string;
  stage?: string;
  /** Sheet name, e.g. "План 1 этажа" */
  sheet: string;
  page: number;
  pages: number;
  date?: string;
  style?: React.CSSProperties;
}
export declare function TitleBlock(props: TitleBlockProps): JSX.Element;