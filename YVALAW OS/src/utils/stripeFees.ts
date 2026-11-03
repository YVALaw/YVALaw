// Stripe fees for Reports — pure sums over client_payments rows (stripe_fee from supabase/migrate-expenses-recurring-fees.sql).
// Stripe keeps its fee from every payment and doesn't give it back on a refund, so a refunded payment's fee still counts.

export type FeeRow = { amount: number; source: string; kind?: string | null; stripeFee?: number | null }

export type FeeSummary = {
  collected: number       // every payment row in the period (refunds/disputes are negative)
  fees: number            // what Stripe kept from the Stripe payments in the period
  received: number        // collected − fees
  stripePayments: number  // Stripe payment rows in the period
  missing: number         // Stripe payments whose fee isn't known yet
}

const cents = (n: number) => Math.round(n * 100) / 100

export function feeSummary(rows: FeeRow[]): FeeSummary {
  let collected = 0, fees = 0, stripePayments = 0, missing = 0
  for (const r of rows) {
    collected += Number(r.amount) || 0
    if (r.source !== 'stripe' || (r.kind && r.kind !== 'payment')) continue
    stripePayments++
    const fee = r.stripeFee == null ? null : Number(r.stripeFee)
    if (fee === null || !Number.isFinite(fee)) missing++
    else fees += fee
  }
  return { collected: cents(collected), fees: cents(fees), received: cents(collected - fees), stripePayments, missing }
}
