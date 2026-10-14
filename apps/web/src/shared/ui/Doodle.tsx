import placeholderUrl from "../assets/illustrations/placeholder.svg";
import homeUrl from "../assets/illustrations/controls/home.svg";
import householdUrl from "../assets/illustrations/controls/household.svg";
import inventoryUrl from "../assets/illustrations/controls/inventories.svg";
import shoppingUrl from "../assets/illustrations/controls/shopping.svg";
import eggCartonUrl from "../assets/illustrations/inventories/egg-carton.svg";

export type IllustrationKey = "jar" | "milk" | "eggs" | "rice" | "home" | "household" | "inventory" | "basket";

const illustrations: Record<IllustrationKey, string> = {
  jar: placeholderUrl,
  milk: placeholderUrl,
  eggs: eggCartonUrl,
  rice: placeholderUrl,
  home: homeUrl,
  household: householdUrl,
  inventory: inventoryUrl,
  basket: shoppingUrl,
};

const inventoryAssets = import.meta.glob<string>("../assets/illustrations/inventories/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
}

const inventoryUrls = new Map(
  Object.entries(inventoryAssets).map(([path, url]) => [normalize(path.split("/").pop()!.replace(/\.svg$/, "")), url]),
);

// Specific names go first so a compound name selects its matching illustration.
const itemNames: [string, string][] = [
  ["toilet paper", "toilet paper"], ["giay ve sinh", "toilet paper"],
  ["cooking oil", "cooking oil"], ["dau an", "cooking oil"],
  ["egg carton", "egg carton"], ["eggs", "egg carton"], ["egg", "egg carton"], ["trung", "egg carton"],
  ["monosodium glutamate", "monosodium glutamate"], ["bot ngot", "monosodium glutamate"], ["mi chinh", "monosodium glutamate"],
  ["washing dishes", "washing dishes"], ["dishwashing", "washing dishes"], ["dish soap", "washing dishes"], ["nuoc rua chen", "washing dishes"], ["nuoc rua bat", "washing dishes"],
  ["toothpaste", "toothpaste"], ["kem danh rang", "toothpaste"],
  ["shampoo", "shampoo"], ["dau goi", "shampoo"],
  ["detergent", "detergent"], ["bot giat", "detergent"], ["nuoc giat", "detergent"],
  ["tissues", "tissues"], ["tissue", "tissues"], ["khan giay", "tissues"],
  ["wipes", "wipes"], ["khan uot", "wipes"],
  ["yogurt", "yogurt"], ["yoghurt", "yogurt"], ["sua chua", "yogurt"],
  ["cabbage", "cabbage"], ["bap cai", "cabbage"],
  ["carrot", "carrot"], ["ca rot", "carrot"],
  ["garlic", "garlic"], ["toi", "garlic"],
  ["onion", "onion"], ["hanh tay", "onion"],
  ["pepper", "pepper"], ["hat tieu", "pepper"],
  ["salt", "salt"], ["muoi", "salt"],
  ["sugar", "sugar"], ["duong", "sugar"],
  ["soap", "soap"], ["xa phong", "soap"],
  ["ribs", "ribs"], ["suon", "ribs"],
  ["beef", "beef"], ["thit bo", "beef"],
  ["pork", "pork"], ["thit heo", "pork"], ["thit lon", "pork"],
];

function illustrationForItem(name: string) {
  const normalized = ` ${normalize(name)} `;
  const match = itemNames.find(([term]) => normalized.includes(` ${term} `));
  return match ? inventoryUrls.get(match[1]) ?? placeholderUrl : placeholderUrl;
}

export function Doodle({ kind = "jar", itemName, className = "" }: { kind?: IllustrationKey; itemName?: string; className?: string }) {
  const src = itemName ? illustrationForItem(itemName) : illustrations[kind];
  return <img className={`doodle ${className}`.trim()} src={src} width={160} height={160} alt="" aria-hidden="true" draggable={false} />;
}

export function Brand() {
  return <span className="wordmark">Lumio<Doodle /></span>;
}
