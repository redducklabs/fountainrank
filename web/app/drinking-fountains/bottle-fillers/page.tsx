import {
  AttributePage,
  buildAttributeMetadata,
  type AttributePageConfig,
} from "../../../components/AttributePage";

// A static segment, so it takes precedence over the sibling /drinking-fountains/[country] dynamic
// route (Next matches literal segments first) — "bottle-fillers" is never treated as a country.
export const dynamic = "force-dynamic";

const CONFIG: AttributePageConfig = {
  attribute: "bottle_filler",
  canonical: "/drinking-fountains/bottle-fillers",
  heading: "Drinking fountains with bottle fillers",
  intro: (count) =>
    `${count.toLocaleString()} public drinking fountains with a bottle-filling spout, mapped and ranked on FountainRank.`,
  metaDescription: (count) =>
    `Find ${count.toLocaleString()} public drinking fountains with a water-bottle refill / bottle-filling spout — ranked and reviewed on FountainRank.`,
};

export function generateMetadata() {
  return buildAttributeMetadata(CONFIG);
}

export default function BottleFillersPage() {
  return AttributePage(CONFIG);
}
