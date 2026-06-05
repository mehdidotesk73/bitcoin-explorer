// Beginner-friendly glossary for the in-UI concept tooltips (see InfoTip.vue).
// Keep each `def` to 1–3 plain-English sentences — scannable, no jargon-on-jargon.
// One entry = one concept; reference a key with <InfoTip term="ma" />.

export interface GlossaryEntry {
  term: string // display name shown in the tooltip header
  def: string // short, beginner-level explanation
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  // --- Price Mechanics: uncertainty ---
  bandLevel: {
    term: 'Band % (confidence level)',
    def: 'How much of the re-fit spread the shaded band covers. We re-fit the model many times on resampled history; the band spans the central X% of those fits at each point. So 95% means 95 out of 100 re-fits land inside it. It measures uncertainty in the fitted line — not how far day-to-day price can swing — and a higher % is wider.',
  },
  trendFan: {
    term: 'Trend-line fan',
    def: 'A shaded band showing where the fitted curve could reasonably sit, found by re-fitting on resampled history. It captures uncertainty in the fit — not how far day-to-day price can swing — and a higher % makes it wider.',
  },

  // --- Price Explorer: indicators ---
  ma: {
    term: 'Moving average (MA)',
    def: 'The average closing price over a recent window (say 20 days), recomputed each day. It smooths out daily noise so the underlying trend is easier to see.',
  },
  ema: {
    term: 'Exponential moving average (EMA)',
    def: 'Like a moving average, but recent days count more than older ones — so it reacts to new prices faster.',
  },
  bollinger: {
    term: 'Bollinger bands',
    def: 'A moving average with an upper and lower band drawn a few standard deviations away. Price usually stays between them; riding a band flags an unusually high or low price.',
  },
  sigma: {
    term: 'Sigma (σ)',
    def: 'Standard deviation — a measure of how much price wiggles around its average. Bollinger bands sit k×σ above and below the average (k is usually 2).',
  },
  bollingerScore: {
    term: 'Bollinger score',
    def: 'How far price sits from its moving average, measured in band-widths. 0 = right on the average; +1 and −1 = the upper and lower bands.',
  },
  pctb: {
    term: '%B',
    def: 'The same band position on a 0–1 scale: 0 sits on the lower band, 0.5 on the average, 1 on the upper band.',
  },
  ratio: {
    term: 'Price ÷ MA',
    def: "Today's price divided by a long, slow average. Above 1 means price is high versus its own history; below 1 means relatively cheap.",
  },
  run: {
    term: 'Run (run detection)',
    def: 'A stretch where price trends in one sustained direction — clearly up or clearly down — rather than chopping sideways.',
  },
  runSlope: {
    term: 'Run slope',
    def: 'How fast price climbed or fell per day during a run (shown as % per day).',
  },
  scale: {
    term: 'Scale',
    def: 'The time horizon a metric looks at, from daily to multi-year. A bigger scale gives a slower, smoother signal.',
  },
  sensitivity: {
    term: 'Sensitivity',
    def: 'How easily a run is detected. Higher sensitivity finds more (and longer) runs; lower only flags the strongest moves.',
  },
  period: {
    term: 'Period',
    def: 'The length of the look-back window used to compute an average or band — e.g. 20 days, or 20 months.',
  },
  smoothing: {
    term: 'Smoothing',
    def: 'Extra averaging that removes day-to-day jitter for a cleaner line. More smoothing = smoother but slower to react.',
  },
  logAxis: {
    term: 'Log scale (axis)',
    def: 'An axis where each step multiplies (×10) instead of adds. It makes huge ranges and percentage moves readable on one chart.',
  },

  // --- Price Mechanics (forecast) ---
  valueBaseline: {
    term: 'Value baseline',
    def: "A slow ~4-year average used as a stand-in for Bitcoin's long-term 'fair value', stripped of short-term swings.",
  },
  volatility: {
    term: 'Volatility',
    def: 'How big the price swings are around the baseline — large in early years, assumed to shrink as the market matures.',
  },
  envelope: {
    term: 'Volatility envelope',
    def: 'The modeled size of the swings above the baseline — how far a cycle top can overshoot, and how that overshoot decays over time.',
  },
  growthModel: {
    term: 'Growth model',
    def: 'The shape assumed for long-term growth: power-law (fast but decelerating), exponential (accelerating), or linear (steady).',
  },
  cyclePeaks: {
    term: 'Cycle peaks',
    def: "Bull-market tops placed on Bitcoin's roughly 4-year rhythm. They're an assumption you set, not something derived from data.",
  },
  halving: {
    term: 'Halving',
    def: "About every 4 years the rate of new Bitcoin issuance halves. Historically these events line up with the ~4-year boom/bust cycle.",
  },
  dayZero: {
    term: 'Day zero',
    def: 'The start date used as time = 0 for the growth equations. Shifting it changes how the curve is fitted.',
  },
  horizon: {
    term: 'Horizon',
    def: 'How far into the future the forecast is projected (e.g. through 2030 or 2050).',
  },
  recency: {
    term: 'Recency weighting (γ)',
    def: 'How much the curve fit favors recent data over old. Higher γ trusts recent cycles more.',
  },
  rSquared: {
    term: 'R²',
    def: "A 0–1 score of how well a fitted curve matches past data (1 = perfect fit). A high R² does NOT mean the forecast is accurate.",
  },
  envelopeDecay: {
    term: 'Volatility decay',
    def: 'The assumption that swings get smaller over time (by age or by valuation) as Bitcoin matures.',
  },

  // --- Hodl Explorer ---
  hodl: {
    term: 'HODL',
    def: "Crypto slang for holding for the long term instead of trading in and out. (From a famous typo of 'hold'.)",
  },
  dca: {
    term: 'Dollar-cost averaging (DCA)',
    def: 'Buying a fixed amount on a regular schedule regardless of price, so you average your entry over time.',
  },
  driver: {
    term: 'Driver',
    def: 'The rule that picks which days to buy on: price ÷ MA, Bollinger score, a uniform schedule, or hand-picked dates.',
  },
  buyBand: {
    term: 'Buy band',
    def: 'The range of a metric within which the strategy buys — e.g. buy whenever price ÷ MA is between 0 and 1.5.',
  },
  seedLayer: {
    term: 'Seed layer',
    def: 'One saved set of buy days from a driver. Stack several layers and they combine into the overall strategy.',
  },
  strategy: {
    term: 'Strategy',
    def: 'Your built plan: all the seed layers combined into one set of buy days.',
  },
  baseline: {
    term: 'Baseline',
    def: 'The yardstick to beat: buying an equal amount on every single day of the comparison window.',
  },
  comparisonWindow: {
    term: 'Comparison window',
    def: 'The date range over which the strategy and baseline are simulated and compared — a trailing span or a from/to range.',
  },
  totalBudget: {
    term: 'Total budget',
    def: 'The same total amount of cash spent by both the strategy and the baseline, so the comparison is about timing, not amount.',
  },
  costBasis: {
    term: 'Cost basis',
    def: 'Your average purchase price per BTC across all the buys — lower is better.',
  },
  roi: {
    term: 'ROI',
    def: 'Return on investment: profit (or loss) as a percentage of the cash you put in.',
  },
  coverage: {
    term: 'Coverage',
    def: 'What fraction of the window’s days the strategy actually bought on. A rule that fires rarely has low coverage.',
  },
  uniformSpacing: {
    term: 'Uniform spacing',
    def: 'Buying every X days on a fixed schedule (e.g. weekly), regardless of price — the classic DCA pattern.',
  },
  buyHodlIndicator: {
    term: 'Buy / Hodl indicator',
    def: "For today's price, whether each tuned pattern says this is a day to buy (accumulate) or just hold. A heuristic, not advice.",
  },
}
