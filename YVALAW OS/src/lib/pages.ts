// Supabase returns at most its "Max rows" setting per request (1,000 by default), so lists that
// can grow past that (a week of 10-minute YVA Time blocks, years of invoices) are read page by page.
// `build(from, to)` must return the query with a stable order (add .order('id') last) and .range(from, to).
export async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>,
  pageSize = 1000,
  max = 200_000,
): Promise<{ data: T[]; error: { message: string; code?: string } | null }> {
  const out: T[] = []
  for (let from = 0; from < max; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) return { data: out, error }
    out.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return { data: out, error: null }
}
