import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  permanentRedirect("/sitemaps/fountains/0.xml");
}
