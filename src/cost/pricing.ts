/**
 * Pricing database — model prices for cost calculation.
 * Prices sourced from LiteLLM model_prices format, cached in memory.
 * All prices in USD per 1M tokens.
 */

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

/** Built-in pricing data (updated periodically) */
const BUILTIN_PRICES: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o': { inputPerMillion: 2.50, outputPerMillion: 10.00 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  'gpt-4-turbo': { inputPerMillion: 10.00, outputPerMillion: 30.00 },
  'gpt-4': { inputPerMillion: 30.00, outputPerMillion: 60.00 },
  'gpt-3.5-turbo': { inputPerMillion: 0.50, outputPerMillion: 1.50 },
  'o1': { inputPerMillion: 15.00, outputPerMillion: 60.00 },
  'o1-mini': { inputPerMillion: 3.00, outputPerMillion: 12.00 },
  'o3-mini': { inputPerMillion: 1.10, outputPerMillion: 4.40 },

  // Anthropic
  'claude-opus-4-20250514': { inputPerMillion: 15.00, outputPerMillion: 75.00 },
  'claude-sonnet-4-20250514': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  'claude-3-5-sonnet-20241022': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  'claude-3-5-haiku-20241022': { inputPerMillion: 0.80, outputPerMillion: 4.00 },
  'claude-3-opus-20240229': { inputPerMillion: 15.00, outputPerMillion: 75.00 },
  'claude-3-haiku-20240307': { inputPerMillion: 0.25, outputPerMillion: 1.25 },

  // Google
  'gemini-2.0-flash': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
  'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5.00 },
  'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.30 },

  // Meta (via API providers)
  'llama-3.1-405b': { inputPerMillion: 3.00, outputPerMillion: 3.00 },
  'llama-3.1-70b': { inputPerMillion: 0.80, outputPerMillion: 0.80 },
  'llama-3.1-8b': { inputPerMillion: 0.10, outputPerMillion: 0.10 },
};

/** Aliases: shorthand → full model name */
const ALIASES: Record<string, string> = {
  'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku': 'claude-3-5-haiku-20241022',
  'claude-3-opus': 'claude-3-opus-20240229',
  'claude-3-haiku': 'claude-3-haiku-20240307',
};

export class PricingDB {
  private readonly prices: Map<string, ModelPricing>;
  private readonly flatRateModels: Set<string>;

  constructor(flatRate: string[] = []) {
    this.prices = new Map(Object.entries(BUILTIN_PRICES));
    this.flatRateModels = new Set(flatRate);
  }

  /** Add or override pricing for a model */
  set(model: string, pricing: ModelPricing): void {
    this.prices.set(model, pricing);
  }

  /** Look up pricing, resolving aliases and prefix matches */
  get(model: string): ModelPricing | null {
    // Exact match
    if (this.prices.has(model)) return this.prices.get(model)!;
    // Alias
    const alias = ALIASES[model];
    if (alias && this.prices.has(alias)) return this.prices.get(alias)!;
    // Prefix match (e.g. "gpt-4o-2024-08-06" → "gpt-4o")
    for (const [key, pricing] of this.prices) {
      if (model.startsWith(key)) return pricing;
    }
    return null;
  }

  /** Calculate cost for a request */
  calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number
  ): { totalCost: number; inputCost: number; outputCost: number; flatRate: boolean } {
    const isFlatRate = this.flatRateModels.has(model) ||
      [...this.flatRateModels].some((fr) => model.startsWith(fr));

    if (isFlatRate) {
      return { totalCost: 0, inputCost: 0, outputCost: 0, flatRate: true };
    }

    const pricing = this.get(model);
    if (!pricing) {
      return { totalCost: 0, inputCost: 0, outputCost: 0, flatRate: false };
    }

    const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;

    return {
      totalCost: inputCost + outputCost,
      inputCost,
      outputCost,
      flatRate: false,
    };
  }
}
