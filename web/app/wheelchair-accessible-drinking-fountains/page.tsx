import {
  AttributePage,
  buildAttributeMetadata,
  type AttributePageConfig,
} from "../../components/AttributePage";

// A top-level route (not nested under /drinking-fountains) — its URL is the target search phrase.
export const dynamic = "force-dynamic";

const CONFIG: AttributePageConfig = {
  attribute: "wheelchair_reachable",
  canonical: "/wheelchair-accessible-drinking-fountains",
  heading: "Wheelchair-accessible drinking fountains",
  intro: (count) =>
    `${count.toLocaleString()} public drinking fountains reachable from a wheelchair, mapped and ranked on FountainRank.`,
  metaDescription: (count) =>
    `Find ${count.toLocaleString()} wheelchair-accessible public drinking fountains — reachable from a wheelchair, ranked and reviewed on FountainRank.`,
};

export function generateMetadata() {
  return buildAttributeMetadata(CONFIG);
}

export default function WheelchairAccessiblePage() {
  return AttributePage(CONFIG);
}
