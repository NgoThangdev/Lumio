import { Link } from 'react-router';
import { tr } from '../../shared/i18n';
import { Doodle } from '../../shared/ui/Doodle';

export function HomeQuickActions({ base }: { base: string }) {
  return (
    <section
      className="home-quick-actions"
      aria-label={tr('home:quickActions')}
    >
      <Link className="home-quick-card home-quick-use" to={`${base}/inventory`}>
        <span className="home-quick-icon">
          <Doodle kind="jar" />
        </span>
        <span>
          <strong>{tr('common:use')}</strong>
          <small>{tr('home:chooseItemUse')}</small>
        </span>
        <span className="home-quick-arrow" aria-hidden="true">
          ›
        </span>
      </Link>
      <Link
        className="home-quick-card home-quick-restock"
        to={`${base}/inventory`}
      >
        <span className="home-quick-icon">
          <Doodle kind="basket" />
        </span>
        <span>
          <strong>{tr('common:restock')}</strong>
          <small>{tr('home:chooseItemRestock')}</small>
        </span>
        <span className="home-quick-arrow" aria-hidden="true">
          ›
        </span>
      </Link>
    </section>
  );
}
