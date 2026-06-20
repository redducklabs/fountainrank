const one = (n: number) => n.toFixed(1);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const formatPill = (avg: number | null) => (avg == null ? null : `★ ${one(avg)}`);
export const formatAverage = (avg: number | null) => (avg == null ? "Not yet rated" : one(avg));
export const formatVotes = (n: number) => `${n} ${n === 1 ? "rating" : "ratings"}`;
export const formatDimension = (avg: number | null, votes: number) =>
  avg == null ? "Not yet rated" : `★ ${one(avg)} (${votes})`;
export const formatDate = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
