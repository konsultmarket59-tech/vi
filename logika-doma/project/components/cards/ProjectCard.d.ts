/**
 * House project card: photo or plan, mark badge, specs, price "от …₽", "Подробнее →".
 * @startingPoint section="Cards" subtitle="Project + contractor cards" viewport="700x400"
 */
export interface ProjectCardProps {
  image?: string;
  title: string;
  /** m² */
  area?: number;
  rooms?: number;
  baths?: number;
  floors?: number;
  /** Starting price in rubles */
  price?: number;
  badge?: 'Популярный' | 'Новинка' | 'Акция' | 'Премиум';
  favorite?: boolean;
  onFavorite?: (fav: boolean) => void;
  onOpen?: () => void;
  style?: React.CSSProperties;
}
export declare function ProjectCard(props: ProjectCardProps): JSX.Element;