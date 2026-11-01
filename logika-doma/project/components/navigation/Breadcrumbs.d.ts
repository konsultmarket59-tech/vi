export interface BreadcrumbsProps {
  items?: string[];
  onNavigate?: (item: string, index: number) => void;
  style?: React.CSSProperties;
}
export declare function Breadcrumbs(props: BreadcrumbsProps): JSX.Element;