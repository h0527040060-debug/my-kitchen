export interface PriceTable {
  as_of: string;
  valid_until: string;
  models: Record<
    string,
    {
      input_per_million: number;
      cached_input_per_million?: number;
      image_input_per_million?: number;
      output_per_million: number;
    }
  >;
}
export function prices(): PriceTable | null {
  if (!process.env.AI_PRICING_JSON) return null;
  try {
    const p = JSON.parse(process.env.AI_PRICING_JSON);
    if (
      !p.as_of ||
      !p.valid_until ||
      Date.parse(p.as_of) > Date.now() ||
      Date.parse(p.valid_until) < Date.now() ||
      !p.models
    )
      return null;
    return p;
  } catch {
    return null;
  }
}
export function estimateUSD(
  model: string,
  usage: any,
): { usd: number; as_of: string } | null {
  const table = prices(),
    p = table?.models[model];
  if (
    !p ||
    !usage ||
    typeof usage.input_tokens !== "number" ||
    typeof usage.output_tokens !== "number"
  )
    return null;
  const cached = Number(usage.input_tokens_details?.cached_tokens ?? 0),
    images = Number(usage.input_tokens_details?.image_tokens ?? 0);
  if (images && !Number.isFinite(p.image_input_per_million)) return null;
  if (cached && !Number.isFinite(p.cached_input_per_million)) return null;
  const usd =
    ((usage.input_tokens - cached - images) * p.input_per_million +
      cached * (p.cached_input_per_million ?? 0) +
      images * (p.image_input_per_million ?? 0) +
      usage.output_tokens * p.output_per_million) /
    1e6;
  return Number.isFinite(usd) && usd >= 0 ? { usd, as_of: table!.as_of } : null;
}
