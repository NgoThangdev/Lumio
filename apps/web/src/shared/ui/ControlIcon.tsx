import homeIconUrl from '../assets/illustrations/controls/homeicon.svg?url';
import clipboardUrl from '../assets/illustrations/controls/clipboard.svg?url';
import shoppingCartUrl from '../assets/illustrations/controls/shoppingcart.svg?url';
import warehouseUrl from '../assets/illustrations/controls/warehouse.svg?url';
import settingsUrl from '../assets/illustrations/controls/setting.svg?url';
import searchUrl from '../assets/illustrations/controls/search.svg?url';
import logoutUrl from '../assets/illustrations/controls/logout.svg?url';
import arrowDownUrl from '../assets/illustrations/controls/arrowdown.svg?url';
import arrowUpUrl from '../assets/illustrations/controls/arrowup.svg?url';
import addUserUrl from '../assets/illustrations/controls/adduser.svg?url';

const controlUrls = {
  homeicon: homeIconUrl,
  clipboard: clipboardUrl,
  shoppingcart: shoppingCartUrl,
  warehouse: warehouseUrl,
  setting: settingsUrl,
  search: searchUrl,
  logout: logoutUrl,
  arrowdown: arrowDownUrl,
  arrowup: arrowUpUrl,
  adduser: addUserUrl,
} as const;

type ControlIconName = keyof typeof controlUrls;

export function ControlIcon({
  name,
  className = '',
}: {
  name: ControlIconName;
  className?: string;
}) {
  const mask = `url("${controlUrls[name]}")`;

  return (
    <span
      className={`control-icon ${className}`.trim()}
      aria-hidden="true"
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    />
  );
}
