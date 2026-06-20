export interface RankedList<T extends string = string> {
  // ids in rank order, best first
  ids: T[];
  weight: number;
  source: string;
}

export interface FusedResult<T extends string = string> {
  id: T;
  score: number;
  // rank (1-based) in each contributing list
  ranks: Record<string, number>;
}

// Reciprocal rank fusion: score(d) = sum_i w_i / (k + rank_i(d)). Rank-based, so vector similarities
// and ts_rank values never need to be put on a common scale. k=60 is the value from the original paper.
export function reciprocalRankFusion<T extends string>(lists: RankedList<T>[], k = 60): FusedResult<T>[] {
  const scores = new Map<T, FusedResult<T>>();
  for (const list of lists) {
    if (list.weight <= 0) continue;
    list.ids.forEach((id, i) => {
      const rank = i + 1;
      const entry = scores.get(id) ?? { id, score: 0, ranks: {} };
      entry.score += list.weight / (k + rank);
      entry.ranks[list.source] = rank;
      scores.set(id, entry);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
