const one = (n: number) => n.toFixed(1);

/** Map rating pill label, e.g. "★ 4.2"; null when unrated (no pill drawn). */
export const formatPill = (avg: number | null) => (avg == null ? null : `★ ${one(avg)}`);
