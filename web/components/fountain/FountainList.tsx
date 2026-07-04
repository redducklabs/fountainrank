import type { FountainPin } from "../../lib/fountains";
import { FountainListRow } from "./FountainListRow";

export function FountainList({ fountains }: { fountains: FountainPin[] }) {
  return (
    <ul className="mt-6 divide-y divide-slate-100">
      {fountains.map((f) => (
        <FountainListRow key={String(f.id)} fountain={f} />
      ))}
    </ul>
  );
}
