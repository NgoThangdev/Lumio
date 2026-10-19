import placeholderUrl from '../assets/illustrations/placeholder.svg';
const controlAssets = import.meta.glob<string>(
  '../assets/illustrations/controls/*.svg',
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
);

export type IllustrationKey =
  | 'jar'
  | 'milk'
  | 'eggs'
  | 'rice'
  | 'home'
  | 'household'
  | 'inventory'
  | 'inventories'
  | 'basket'
  | 'shopping'
  | 'add'
  | 'calendar'
  | 'close'
  | 'cogwheel'
  | 'settings'
  | 'menu-bar'
  | 'menu'
  | 'minus'
  | 'plus'
  | 'profile'
  | 'refresh'
  | 'restock'
  | 'sort'
  | 'undo'
  | 'use';

const inventoryAssets = import.meta.glob<string>(
  '../assets/illustrations/inventories/*.svg',
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
);

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const inventoryUrls = new Map(
  Object.entries(inventoryAssets).map(([path, url]) => [
    normalize(
      path
        .split('/')
        .pop()!
        .replace(/\.svg$/, ''),
    ),
    url,
  ]),
);

const controlUrls = new Map(
  Object.entries(controlAssets).map(([path, url]) => [
    normalize(
      path
        .split('/')
        .pop()!
        .replace(/\.svg$/, ''),
    ),
    url,
  ]),
);

function controlUrl(asset: string, fallback?: string) {
  return (
    controlUrls.get(normalize(asset)) ??
    (fallback ? controlUrls.get(normalize(fallback)) : undefined) ??
    placeholderUrl
  );
}

const controlIllustrations: Record<
  Exclude<IllustrationKey, 'jar' | 'milk' | 'eggs' | 'rice'>,
  string
> = {
  home: controlUrl('home'),
  household: controlUrl('household'),
  inventory: controlUrl('inventory', 'inventories'),
  inventories: controlUrl('inventories', 'inventory'),
  basket: controlUrl('shopping'),
  shopping: controlUrl('shopping'),
  add: controlUrl('add'),
  calendar: controlUrl('calendar'),
  close: controlUrl('close'),
  cogwheel: controlUrl('cogwheel'),
  settings: controlUrl('cogwheel'),
  'menu-bar': controlUrl('menu-bar'),
  menu: controlUrl('menu-bar'),
  minus: controlUrl('minus'),
  plus: controlUrl('plus'),
  profile: controlUrl('profile'),
  refresh: controlUrl('refresh'),
  restock: controlUrl('restock'),
  sort: controlUrl('sort'),
  undo: controlUrl('undo'),
  use: controlUrl('use'),
};

const illustrations: Record<IllustrationKey, string> = {
  jar: placeholderUrl,
  milk: inventoryUrls.get('milk') ?? placeholderUrl,
  eggs: inventoryUrls.get('egg carton') ?? placeholderUrl,
  rice: inventoryUrls.get('rice') ?? placeholderUrl,
  ...controlIllustrations,
};

// Specific names go first so a compound name selects its matching illustration.
const itemNames: [string, string][] = [
  ['bell pepper', 'bell pepper'],
  ['bell peppers', 'bell pepper'],
  ['canned foods', 'canned food'],
  ['canned goods', 'canned food'],
  ['dishwasher tablet', 'tablet'],
  ['dishwasher tablets', 'tablet'],
  ['diaper', 'diapers'],
  ['diapers', 'diapers'],
  ['garbage bags', 'garbage bag'],
  ['trash bag', 'garbage bag'],
  ['trash bags', 'garbage bag'],
  ['light bulb', 'light bulbs'],
  ['mushroom', 'mushrooms'],
  ['oat', 'oats'],
  ['sausage', 'sausages'],
  ['snack', 'snacks'],
  ['toothbrushes', 'toothbrush'],
  ['toilet paper', 'toilet paper'],
  ['giay ve sinh', 'toilet paper'],
  ['cooking oil', 'cooking oil'],
  ['dau an', 'cooking oil'],
  ['egg carton', 'egg carton'],
  ['eggs', 'egg carton'],
  ['egg', 'egg carton'],
  ['trung', 'egg carton'],
  ['monosodium glutamate', 'monosodium glutamate'],
  ['bot ngot', 'monosodium glutamate'],
  ['mi chinh', 'monosodium glutamate'],
  ['washing dishes', 'washing dishes'],
  ['dishwashing', 'washing dishes'],
  ['dish soap', 'washing dishes'],
  ['nuoc rua chen', 'washing dishes'],
  ['nuoc rua bat', 'washing dishes'],
  ['toothpaste', 'toothpaste'],
  ['kem danh rang', 'toothpaste'],
  ['shampoo', 'shampoo'],
  ['dau goi', 'shampoo'],
  ['detergent', 'detergent'],
  ['bot giat', 'detergent'],
  ['nuoc giat', 'detergent'],
  ['tissues', 'tissues'],
  ['tissue', 'tissues'],
  ['khan giay', 'tissues'],
  ['wipes', 'wipes'],
  ['khan uot', 'wipes'],
  ['yogurt', 'yogurt'],
  ['yoghurt', 'yogurt'],
  ['sua chua', 'yogurt'],
  ['cabbage', 'cabbage'],
  ['bap cai', 'cabbage'],
  ['carrot', 'carrot'],
  ['ca rot', 'carrot'],
  ['garlic', 'garlic'],
  ['toi', 'garlic'],
  ['onion', 'onion'],
  ['hanh tay', 'onion'],
  ['pepper', 'pepper'],
  ['hat tieu', 'pepper'],
  ['salt', 'salt'],
  ['muoi', 'salt'],
  ['sugar', 'sugar'],
  ['duong', 'sugar'],
  ['soap', 'soap'],
  ['xa phong', 'soap'],
  ['ribs', 'ribs'],
  ['suon', 'ribs'],
  ['beef', 'beef'],
  ['thit bo', 'beef'],
  ['pork', 'pork'],
  ['thit heo', 'pork'],
  ['thit lon', 'pork'],
];

function illustrationForItem(name: string) {
  const normalized = ` ${normalize(name)} `;
  const exactMatch = inventoryUrls.get(normalize(name));
  if (exactMatch) return exactMatch;

  const match = itemNames.find(([term]) => normalized.includes(` ${term} `));
  return match
    ? (inventoryUrls.get(match[1]) ?? placeholderUrl)
    : placeholderUrl;
}

export function Doodle({
  kind = 'jar',
  itemName,
  className = '',
}: {
  kind?: IllustrationKey;
  itemName?: string;
  className?: string;
}) {
  const src = itemName ? illustrationForItem(itemName) : illustrations[kind];
  return (
    <img
      className={`doodle ${className}`.trim()}
      src={src}
      width={160}
      height={160}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

export function Brand() {
  return (
    <span className="wordmark">
      Lumio
      <Doodle />
    </span>
  );
}
