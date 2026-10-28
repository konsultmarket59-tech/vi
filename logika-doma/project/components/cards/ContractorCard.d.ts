export interface ContractorCardProps {
  name: string;
  /** e.g. "Строительство домов под ключ", "Архитектор" */
  role?: string;
  avatar?: string;
  rating?: number;
  reviews?: number;
  location?: string;
  /** e.g. "12 лет" */
  experience?: string;
  verified?: boolean;
  contract?: boolean;
  primaryLabel?: string | null;
  secondaryLabel?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
  style?: React.CSSProperties;
}
export declare function ContractorCard(props: ContractorCardProps): JSX.Element;