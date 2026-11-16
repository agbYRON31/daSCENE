"""Plain-language breakdown of every calculator's formula, shown in the app as a drop-down
under the formula ("What each part means").

NOTES[calculator id] = (why, parts)
  why   – one or two sentences: the idea behind the formula and why it gives the answer.
  parts – [(term, meaning)]: each piece of the formula as written in the catalog's `math`
          line, what it stands for, and what it does to the result.

build_catalog.py attaches these to catalog.json and refuses to build if any calculator is
missing one, so every formula in the app has an explanation.
"""

NOTES = {}


def note(cid, why, *parts):
    assert cid not in NOTES, cid
    NOTES[cid] = (why, list(parts))


# ── Everyday math ──────────────────────────────────────────────────────────────
note("percentages",
     "“Percent” means “per hundred”, so a percentage is a fraction with 100 underneath. Every percentage question is one of three moves: take a share of a number, see what share one number is of another, or measure a change against where you started.",
     ("x/100 × y", "Turns x% into a fraction (for example 15% → 0.15) and multiplies, giving that share of y."),
     ("part ÷ whole", "How big one number is relative to another. Multiply by 100 to read it as a percent."),
     ("(new − old)", "How much the value moved, in its own units."),
     ("÷ |old|", "Measures that move against the starting value, so it becomes a percent change. The absolute value keeps the sign meaningful when the starting value is negative."))
note("tip_split",
     "A tip is usually figured on the food and service, not on the sales tax, so tax comes out before the rate is applied. Splitting is then just dividing the total evenly.",
     ("bill − tax", "The pre-tax amount the tip is based on."),
     ("× rate", "The tip percentage applied to that amount."),
     ("total", "Bill plus tip: what everyone pays together."),
     ("÷ people", "Each person's equal share of the total."))
note("discount",
     "Stacked discounts multiply rather than add: a second discount applies to the already-reduced price, so 20% then 10% off is 28% off, not 30%. Sales tax is then charged on the final price.",
     ("Price", "The original sticker price."),
     ("(1 − d₁)", "What's left after the first discount; 20% off leaves 0.80 of the price."),
     ("(1 − d₂)", "The second discount, applied to what was left after the first."),
     ("(1 + tax)", "Adds sales tax on the discounted price."))
note("unit_price",
     "Dividing price by quantity puts different package sizes on the same footing, so the cheaper option per unit is obvious.",
     ("Price", "What you pay for the package."),
     ("÷ quantity", "Spreads the price over each unit (ounce, count, sheet…)."))
note("weighted_avg",
     "A weighted average lets some items count more than others. Each score is scaled by its weight, and dividing by the total weight brings the result back to the score's scale.",
     ("score × weight", "Each item's contribution, bigger for heavier weights."),
     ("Σ(…)", "Adds those contributions up across all items."),
     ("÷ Σ weight", "Divides by the total weight so the weights don't need to add to 100%."))
note("grade_needed",
     "Your final grade is a blend: your current grade counts for the part of the course already done, and the final exam counts for its weight. Solving that blend for the exam score gives what you need.",
     ("target", "The overall grade you want."),
     ("current × (1 − w)", "How much your current grade contributes, since it covers everything except the final."),
     ("target − …", "The points still needed, which must come from the final."),
     ("÷ w", "Scales those points up by the final's weight to give the exam score required."))

# ── Growth & time value ─────────────────────────────────────────────────────────
note("fv_lump",
     "Compound growth: each year's return is earned on the original amount and on all the returns before it. Multiplying by the same growth factor once per year captures that.",
     ("Amount", "What you invest today."),
     ("(1 + return)", "The growth factor for one year: each dollar becomes 1 + r dollars (a 6% return turns $1 into $1.06)."),
     ("^years", "Applies that factor once for each year, so gains earn gains. This is what makes growth speed up over time."))
note("fv_contrib",
     "Two pieces grow side by side: what you have today compounds for the whole period, and each year's contribution compounds from when it goes in. The second piece is the sum of a growing series, which has a short closed form.",
     ("Balance × (1+r)^n", "Today's balance compounded for n years."),
     ("contribution", "The amount added each year."),
     ("((1+r)^n − 1) / r", "The future-value factor for a series of equal yearly deposits: early deposits grow for longer, later ones for less, and this adds them all up."),
     ("+", "The two pieces together are the projected balance."))
note("fv_monthly",
     "The same compound-growth idea as yearly saving, but in monthly steps: the yearly return is split into twelve monthly returns and deposits are counted each month.",
     ("annual ÷ 12", "The monthly growth rate."),
     ("years × 12", "The number of monthly periods."),
     ("FV", "Future value of the starting amount plus each monthly deposit, each compounding monthly until the end."))
note("pv_goal",
     "Present value runs compound growth backwards: it asks how much you'd need today so that growth alone reaches the goal.",
     ("Goal", "The amount you want in the future."),
     ("(1 + r)^years", "How much one dollar grows to over the period."),
     ("÷", "Dividing by that growth undoes it, giving today's equivalent amount."))
note("savings_needed",
     "First see how much of the goal your current savings will reach on their own. The yearly saving must then fill the rest, and the fill-the-gap amount comes from turning the future-value-of-deposits formula around.",
     ("current × (1+r)^n", "What today's savings grow to without adding anything."),
     ("Goal − …", "The shortfall that yearly saving must cover."),
     ("× r ÷ ((1+r)^n − 1)", "The inverse of the deposit-growth factor: the level yearly amount that grows to exactly that shortfall."))
note("years_to_goal",
     "The future-value formula is solved for time instead of money. Because time sits in an exponent, a logarithm is what brings it down.",
     ("goal × r + c", "The goal, expressed in the form the deposit formula needs (deposits c per year at rate r)."),
     ("balance × r + c", "The same expression for where you are today."),
     ("ln(… ÷ …)", "The log of how many times larger the goal is in those terms."),
     ("÷ ln(1 + r)", "Divides by the log of one year's growth, which counts how many years of growth that takes."))
note("cagr",
     "CAGR is the single steady yearly rate that would take the start value to the end value. Taking the n-th root of total growth spreads it evenly across the years.",
     ("End ÷ start", "Total growth as a multiple (for example 2.0 means it doubled)."),
     ("^(1 ÷ years)", "The n-th root: the yearly multiple that compounds to that total."),
     ("− 1", "Turns the yearly multiple into a rate (1.072 → 7.2%)."))
note("real_return",
     "A real return measures growth in what money can buy. Dividing by inflation's growth factor removes the part of the return that only kept up with prices.",
     ("1 + nominal", "How much each dollar grew."),
     ("÷ (1 + inflation)", "Removes the rise in prices over the same period."),
     ("− 1", "Turns the result back into a rate. Simply subtracting inflation is a close shortcut, not exact."))
note("rule72",
     "The Rule of 72 is a mental-math shortcut for doubling time. The exact answer comes from solving (1 + r)^t = 2 with logarithms; 72 works well because it divides evenly by many common rates.",
     ("72 ÷ rate in percent", "Approximate years to double (6% → about 12 years)."),
     ("ln 2", "The log of doubling."),
     ("÷ ln(1 + r)", "The log of one year's growth; the ratio is the exact number of years."))
note("inflation_cost",
     "Prices compound like investments do: each year's increase builds on the last.",
     ("Cost", "What something costs today."),
     ("(1 + inflation)", "One year's price increase as a growth factor."),
     ("^years", "Applies it once per year to give the future price."))
note("effective_rate",
     "A quoted APR is split into smaller periods, and interest on interest within the year makes the true yearly rate a little higher.",
     ("APR ÷ periods", "The rate charged each period (for example monthly)."),
     ("1 + …", "One period's growth factor."),
     ("^periods", "Compounds it across the year."),
     ("− 1", "Turns the yearly multiple back into a rate: the effective annual rate."))
note("growth_schedule",
     "The balance is rolled forward one month at a time: it earns a month of return, then the month's deposit is added and any withdrawal taken out. Doing it month by month shows exactly where the balance stands each year.",
     ("annual return ÷ 12", "The monthly growth rate."),
     ("balance × (1 + …)", "Last month's balance after a month of growth."),
     ("+ contribution", "Money added at the end of the month."),
     ("− withdrawal", "Money taken out at the end of the month. If there isn't enough, what's there is taken and the balance stays at zero."),
     ("÷ (1 + inflation)^years", "Restates the balance in today's dollars, i.e. what it would buy at today's prices."))

# ── Retirement & income ─────────────────────────────────────────────────────────
note("nest_egg",
     "Only the spending that other income doesn't cover has to come from savings. A withdrawal rate says what share of the portfolio you plan to take each year, so dividing the gap by it gives the portfolio size that supports it.",
     ("Spending − other income", "The yearly gap savings must fill (other income is Social Security, a pension, and so on)."),
     ("÷ withdrawal rate", "Scales the gap up to a portfolio size: $40,000 at 4% needs $1,000,000."))
note("retire_gap",
     "Compares what your savings are projected to become with what you'd need. Both sides use the same steps as the growth and nest-egg calculators.",
     ("Projected FV of savings", "Today's savings plus yearly saving, compounded to retirement."),
     ("spending gap ÷ withdrawal rate", "The nest egg needed, as in the Retirement nest egg calculator."),
     ("−", "Positive means a projected surplus; negative means a shortfall."))
note("withdrawal_rate",
     "A withdrawal rate is the year's withdrawals as a share of the portfolio, the common yardstick for whether spending is sustainable.",
     ("Withdrawals", "What you take out in a year."),
     ("÷ balance", "As a share of the portfolio."))
note("level_withdrawal",
     "This is the loan-payment formula in reverse: the portfolio is “lent” to you and paid back in equal amounts, with the money not yet withdrawn still earning the return.",
     ("Balance", "The starting portfolio."),
     ("× r", "One year's return on it."),
     ("(1 + r)^−n", "The value today of one dollar received in n years."),
     ("÷ (1 − …)", "Spreads the balance and its future earnings evenly over n years so it reaches exactly zero at the end."))
note("longevity",
     "Solves the level-withdrawal formula for time: how many years of fixed withdrawals the balance can pay. If the return covers the withdrawal, the money never runs out.",
     ("balance × r", "What the balance earns in a year."),
     ("w − balance × r", "How much each withdrawal exceeds those earnings, i.e. what eats into principal."),
     ("ln(w ÷ (…))", "Log of how fast principal is used up relative to the withdrawal."),
     ("÷ ln(1 + r)", "Converts that into years of growth."))
note("growing_annuity",
     "Spending that rises with inflation each year is a growing stream of payments. Its value today has a closed form: payments grow at g while money is discounted at r.",
     ("Spending", "The first year's withdrawal."),
     ("÷ (r − g)", "The value of a growing stream that lasts forever."),
     ("((1+g) ÷ (1+r))^n", "How much of that forever-value lies beyond n years."),
     ("1 − …", "Keeps only the first n years: the amount needed today to fund them."))
note("ss_breakeven",
     "Claiming later pays more per month but starts later. The breakeven age is when total benefits received from both choices are equal; living past it favors waiting.",
     ("benefit × age", "Total collected by a given age, before adjusting for when payments start."),
     ("Later … − earlier …", "The head start the earlier claim has to be overcome."),
     ("÷ (later − earlier benefit)", "Divided by how much more each year of the later benefit pays, giving the age where totals meet."))
note("pension_value",
     "A pension is a stream of monthly payments. Its value today is the sum of each payment discounted back to the present at a chosen rate.",
     ("monthly payments", "The pension amount received each month."),
     ("discount rate ÷ 12", "The monthly rate used to discount; a higher rate means a lower value today."),
     ("PV", "Present value: each payment divided by (1 + monthly rate) raised to its month number, all added up."))
note("rmd",
     "The IRS sets each year's required minimum withdrawal by spreading the account over your remaining life expectancy from its Uniform Lifetime Table.",
     ("Prior year-end balance", "The account value on December 31 of last year."),
     ("÷ table factor", "The IRS life-expectancy factor for your age; it shrinks each year, so the required share grows."))
note("contrib_limits",
     "IRS limits have a base amount for everyone plus a catch-up for older savers. From age 60 to 63, 401(k)-type plans allow a larger catch-up.",
     ("Base limit", "The standard yearly limit for the account type and year."),
     ("+ catch-up", "Extra allowed from age 50 (the larger amount at ages 60–63 for workplace plans)."),
     ("− contributed", "What's left of the limit this year after contributions so far."))
note("employer_match",
     "Employers usually match a share of what you contribute up to a cap. Contributing below the cap leaves free money unclaimed.",
     ("Salary", "Pay the match is based on."),
     ("min(your rate, cap)", "Only contributions up to the cap are matched."),
     ("× match share", "How much the employer adds per dollar matched (for example 50%)."))
note("retirement_timeline",
     "The plan is rolled forward one year at a time with the same rules every year, so each year's saving, spending, tax and growth show up exactly. Spending and other income are in today's dollars and rise with inflation.",
     ("start", "The balance at the start of the year."),
     ("+ saving", "Added each year while working; it can rise each year by the increase in saving."),
     ("spending − other income", "Once retired, the part of spending not covered by Social Security or a pension."),
     ("÷ (1 − tax rate)", "Grosses the withdrawal up so the spending entered is what's left after tax. At 22%, $78,000 of spending needs a $100,000 withdrawal."),
     ("− withdrawal", "Taken out at the start of each retired year (capped at what's there)."),
     ("× (1 + return)", "The year's return on what remains, using the before- or in-retirement rate."))
note("retirement_mc",
     "The same yearly cash flows as the Retirement timeline, but each year's return is drawn at random around the average you enter. Running many paths shows how often the plan works and the range of outcomes.",
     ("cash flows", "Saving, spending, other income and tax on withdrawals, exactly as in the Retirement timeline."),
     ("Normal(average, volatility)", "Each year's return is random: centered on the average, spread by the volatility."),
     ("many simulations", "Each path is one possible sequence of market returns."),
     ("success rate", "The share of paths where every year's spending was fully met through the end of the plan."))
note("monte_carlo",
     "Simulates many possible market paths for a fixed withdrawal plan. The order of good and bad years matters once you're withdrawing, which a single average return can't show.",
     ("draw return ~ Normal(mean, sd)", "A random return each year, centered on the mean and spread by the standard deviation."),
     ("withdraw, then grow", "Each year's withdrawal comes out first, then the rest earns that year's return; the withdrawal rises with inflation."),
     ("success", "A path succeeds if every withdrawal was fully met; the success rate is the share of paths that did."))

# ── Portfolio & risk ────────────────────────────────────────────────────────────
note("mix_volatility",
     "A portfolio's risk isn't just the weighted average of its parts. How the parts move together (correlation) matters: when they don't move in lockstep, they partly offset and total risk falls. That's diversification.",
     ("wS²σS²", "Stock risk, scaled by how much is in stocks (squared because variance is in squared units)."),
     ("wB²σB²", "The same for bonds."),
     ("2·wS·wB·ρ·σS·σB", "How the two interact: positive correlation ρ adds risk, negative takes it away."),
     ("√(…)", "Square root turns variance back into volatility, in the same units as returns."))
note("portfolio_stress",
     "A what-if, not a forecast: you choose a stock move and a rate change, and each part of the portfolio reacts in its own way. Bond prices move opposite to interest rates in proportion to their duration.",
     ("Stocks × market change", "Stock holdings move with the market change you enter."),
     ("−duration × rate change", "Bond prices fall about duration % for each 1% rise in rates, and rise when rates fall."),
     ("cash unchanged", "Cash doesn't move in the scenario."),
     ("− withdrawal", "Any money taken out during the period is removed afterwards."))
note("weighted_return",
     "A portfolio's return is the weighted average of its holdings' returns: each holding contributes in proportion to its share.",
     ("weight × return", "Each holding's contribution to the total return."),
     ("Σ", "Added across holdings."),
     ("÷ Σ weight", "Normalizes, so weights don't have to add to exactly 100%."))
note("two_asset",
     "The portfolio-variance formula for two assets: individual risks plus a term for how they move together. Lower correlation means more diversification benefit.",
     ("w²σA²", "Asset A's risk, scaled by its weight squared."),
     ("(1−w)²σB²", "Asset B's risk, scaled by its weight squared."),
     ("2w(1−w)ρσAσB", "The co-movement term; it shrinks or turns negative as correlation ρ falls."),
     ("√", "Back from variance to volatility."))
note("sharpe",
     "The Sharpe ratio asks how much extra return you got for each unit of risk taken, measured against a risk-free alternative.",
     ("Return − risk-free", "The excess return over a safe investment such as T-bills."),
     ("÷ volatility", "Per unit of total ups and downs; higher is better compensation for risk."))
note("sortino",
     "Like Sharpe, but it only counts bad volatility (returns below your target), since upside surprises aren't a risk most people mind.",
     ("Return − target", "Return above your minimum acceptable return."),
     ("÷ downside deviation", "Per unit of shortfall risk only."))
note("capm",
     "CAPM says investors are paid only for market risk they can't diversify away. Beta measures how much of that risk an investment carries.",
     ("Risk-free", "What a riskless investment pays."),
     ("market − risk-free", "The market's extra return for bearing risk (the equity risk premium)."),
     ("× beta", "Scaled by how sensitive the investment is to the market (1 = moves with the market)."))
note("rebalance",
     "Rebalancing moves each holding back to its target share. The trade is the difference between where it should be and where it is.",
     ("Target value", "Total portfolio × target weight."),
     ("− current value", "What's held now; positive means buy, negative means sell."))
note("drawdown",
     "Losses and gains aren't symmetric: after a fall you're working from a smaller base, so you need a bigger percentage gain to get back.",
     ("1 − loss", "What's left after the loss (a 50% loss leaves 0.5)."),
     ("1 ÷ (…)", "The multiple needed to return to the start (0.5 → ×2)."),
     ("− 1", "As a gain: a 50% loss needs a 100% gain to recover."))
note("hpr",
     "Holding-period return counts everything you got back (price change plus income) relative to what you put in.",
     ("End − begin", "The change in value."),
     ("+ income", "Dividends or interest received."),
     ("÷ begin", "As a share of the starting value."))
note("irr",
     "IRR is the single rate that makes all deposits and withdrawals, at their actual times, balance out exactly. It accounts for the timing and size of each cash flow.",
     ("cash flows", "Money in (negative) and out (positive), year by year."),
     ("net present value", "Each cash flow discounted back by the rate, added up."),
     ("= 0", "The IRR is the rate where that sum is exactly zero; found by searching, since there's no closed form."))
note("dca",
     "Buying a fixed dollar amount each time buys more shares when prices are low and fewer when high, so your average cost per share is lower than the average price.",
     ("Total invested", "All the money put in."),
     ("÷ total shares", "Your average cost per share."))

# ── Fees & costs ────────────────────────────────────────────────────────────────
note("fee_drag",
     "A fee is a return you don't get, every year, and it compounds just like returns do. Comparing growth with and without it shows the true cost over time.",
     ("Amount × (1 + r)^n", "What the money would grow to with no fee."),
     ("(1 + r − fee)^n", "Growth with the fee taken off each year's return."),
     ("−", "The difference is the total cost of the fee, including lost growth on money paid out as fees."))
note("fee_compare",
     "Two otherwise identical investments with different fees: each grows at the return minus its fee, so the gap shows what the cheaper option is worth.",
     ("growth", "The same return assumption for both."),
     ("net of each fee", "Each fee taken off every year's return."))
note("aum_vs_flat",
     "An asset-based fee grows as the portfolio grows; a flat fee doesn't. Comparing them shows where one becomes cheaper than the other.",
     ("Assets × AUM rate", "The yearly fee as a percentage of assets."),
     ("vs. flat fee", "A fixed dollar amount regardless of size."))
note("tiered_fee",
     "Tiered fees work like tax brackets: each slice of assets is charged its own tier's rate, so a higher tier only applies to the dollars inside it.",
     ("slice of assets", "The part of the portfolio inside each tier."),
     ("× tier's rate", "Charged at that tier's rate."),
     ("sum", "Added up for the total fee; dividing by assets gives the blended rate."))
note("front_load",
     "A front-end load is taken off the top before anything is invested, so less money goes to work from day one.",
     ("Amount", "What you pay in."),
     ("× (1 − load)", "What's actually invested after the sales charge."))

# ── Stocks & bonds ──────────────────────────────────────────────────────────────
note("bond_price",
     "A bond's price is what its future payments are worth today at the market's yield: each coupon and the face value are discounted back.",
     ("i = yield ÷ payments per year", "The yield per coupon period."),
     ("Coupon × (1 − (1+i)^−n) ÷ i", "Today's value of all remaining coupon payments."),
     ("face × (1+i)^−n", "Today's value of the face amount repaid at maturity."),
     ("+", "Together, the bond's fair price; when yields rise, both parts fall."))
note("bond_ytm",
     "Yield to maturity is the single rate that makes the bond's future payments worth exactly today's price. It's found by searching, like an IRR.",
     ("cash flows", "Coupons and the face value at maturity."),
     ("worth exactly the price", "The yield is the discount rate that makes their present value equal what you pay."))
note("bond_duration",
     "Duration measures how sensitive a bond's price is to interest rates. Convexity corrects for the curve in that relationship, which matters for big rate moves.",
     ("ΔP/P", "The percentage change in price."),
     ("−modified duration × Δy", "The main effect: price falls about duration % for each 1% rise in yield."),
     ("½ × convexity × Δy²", "A smaller correction that always helps the holder; it grows with the size of the move."))
note("tbill",
     "T-bills pay no coupon; you buy at a discount and get face value at maturity. Banks quote the discount on a 360-day year; the bond-equivalent yield restates it as a return on the price over 365 days.",
     ("Discount ÷ face", "The discount as a share of face value."),
     ("× 360 ÷ days", "Annualized on the 360-day banking convention."),
     ("discount ÷ price × 365 ÷ days", "Bond-equivalent yield: return on what you actually pay, on a 365-day year, comparable with other bonds."))
note("stock_valuation",
     "Three ratios that compare price to what the company earns and pays out.",
     ("Dividend ÷ price", "Dividend yield: cash paid per dollar invested."),
     ("price ÷ EPS", "P/E: dollars paid per dollar of yearly earnings."),
     ("dividend ÷ EPS", "Payout ratio: share of earnings paid out as dividends."))
note("position_pl",
     "Profit is the price move on each share times shares held. Total return also counts dividends received.",
     ("price − cost", "Gain or loss per share."),
     ("shares ×", "Across the whole position."),
     ("+ dividends", "Cash paid while holding, for total return."))
note("dividend_income",
     "Dividend income in each year is the starting yield on your investment, grown by the dividend growth rate year after year.",
     ("amount × yield", "First year's dividend income."),
     ("(1 + growth)^(k−1)", "Grown for each year after the first."))
note("ddm",
     "The dividend discount model values a stock as all its future dividends discounted back. If dividends grow at a steady rate forever, that endless sum collapses to one division.",
     ("next dividend", "The dividend expected over the next year."),
     ("required return − growth", "How fast you discount, minus how fast dividends grow; it must be positive."),
     ("÷", "The value today of the whole growing stream."))
note("position_size",
     "Turns a target share of the portfolio into a number of shares you can actually buy.",
     ("portfolio × weight", "Dollars you want in the position."),
     ("÷ price", "How many shares that buys."),
     ("floor", "Rounded down to whole shares; the remainder stays in cash."))

# ── Tax ─────────────────────────────────────────────────────────────────────────
note("income_tax",
     "US income tax is progressive by slices: each bracket's rate applies only to the income inside that bracket, not to all of it. That's why moving into a higher bracket never lowers take-home pay. Most states tax income the same way with their own brackets, after their own deduction and exemptions.",
     ("each slice of income", "The part of taxable income that falls inside one bracket."),
     ("× its bracket rate", "Taxed at that bracket's rate."),
     ("sum", "Total federal tax; divided by income it gives the effective rate. The marginal rate is the top bracket reached."),
     ("state's own brackets", "State tax starts from AGI (estimated as taxable income plus the federal standard deduction), subtracts the state's deduction and exemptions, then applies the state's brackets and any personal credit."),
     ("combined marginal rate", "Federal plus state rate on the next dollar: the rate to use when a decision adds or removes income."))

note("taxable_income",
     "Tax is figured on income after deductions. Federally you take whichever is bigger: itemized deductions or the standard deduction. States start from the same AGI but subtract their own deduction and exemptions.",
     ("AGI", "Adjusted gross income."),
     ("larger of itemized or standard", "The federal deduction that saves more tax."),
     ("−", "What's left is federal taxable income."),
     ("state tax from AGI", "The state's own deduction and exemptions come off AGI, then its brackets apply."))

note("after_tax_return",
     "Taxes take a share of each year's return, so you keep the rest.",
     ("Return", "The pre-tax return."),
     ("× (1 − tax rate)", "The share you keep after tax."))
note("tey",
     "Tax-equivalent yield answers: what would a taxable bond need to pay to match a tax-free one after tax?",
     ("Tax-free yield", "What the municipal bond pays."),
     ("÷ (1 − tax rate)", "Grosses it up to a taxable equivalent; the higher your bracket, the more a tax-free yield is worth."))
note("ltcg_tax",
     "Long-term gains have their own federal 0%, 15% and 20% brackets, but they sit on top of ordinary income, so ordinary income decides how much room is left in the lower brackets. Most states simply tax gains like other income; some exclude part of the gain or use their own rates.",
     ("ordinary income", "Fills the brackets first."),
     ("gains stack on top", "Gains are taxed in the slices above ordinary income."),
     ("0% / 15% / 20% thresholds", "Each slice of gain is taxed at the federal rate for where it lands."),
     ("state tax on the gain", "The extra state tax from adding the gain to income, after any state exclusion (for example 44% in South Carolina), cap or separate rate."))

note("niit",
     "A 3.8% surtax applies to investment income only when income is above a threshold, and only on the smaller of the two amounts.",
     ("MAGI over the threshold", "How far income exceeds the filing-status threshold."),
     ("lesser of … investment income", "The tax applies to whichever is smaller."),
     ("3.8% ×", "The surtax rate."))
note("roth_vs_trad",
     "Both accounts grow the same; the difference is when tax is paid. Traditional defers it to withdrawal, Roth pays it now. If the rates are the same, the results are identical.",
     ("C × growth", "The contribution grown over time."),
     ("× (1 − future rate)", "Traditional: tax taken at withdrawal."),
     ("× (1 − today's rate)", "Roth: tax paid up front, then tax-free growth."))
note("roth_conversion",
     "The tax cost of converting is the extra tax caused by adding the conversion to this year's income, federal and state.",
     ("Tax(income + conversion)", "Tax with the conversion added."),
     ("− tax(income)", "Minus tax without it: the conversion's own cost."),
     ("federal and state", "The same difference worked out with the state's brackets, added to the federal amount."))

note("tlh",
     "Capital losses first offset capital gains, then up to $3,000 of ordinary income per year; anything left carries forward to future years.",
     ("Losses offset gains", "Net capital gain is reduced first."),
     ("up to $3,000 of ordinary income", "The yearly limit against wages and other income."),
     ("carries forward", "Unused losses are kept for later years."))
note("tax_deferral",
     "Paying tax every year shrinks the return that compounds; deferring lets the full return compound and taxes it once at the end.",
     ("(1 + r(1−t))^n", "Taxable: each year's return is reduced by tax before it compounds."),
     ("growth taxed once at the end", "Deferred: full compounding, then tax on the gain at withdrawal."))

# ── Statistics & econometrics ───────────────────────────────────────────────────
note("descriptive",
     "The mean is the balance point of the data; the standard deviation is the typical distance from it. Dividing by n − 1 corrects for using the sample's own mean.",
     ("Σx ÷ n", "The mean: total divided by count."),
     ("(x − x̄)²", "Each value's squared distance from the mean."),
     ("÷ (n − 1)", "Averages those, with n − 1 (Bessel's correction) for an unbiased sample variance."),
     ("√", "Square root brings it back to the data's units: the standard deviation."))
note("normal_prob",
     "Any normal distribution can be converted to the standard one by measuring distance from the mean in standard deviations. Then one table (the CDF) gives probabilities.",
     ("x − μ", "Distance from the mean."),
     ("÷ σ", "In standard deviations: the z-score."),
     ("standard normal CDF", "The probability of a value below z."))
note("normal_between",
     "The probability of landing between two values is the area under the curve between them: everything below b minus everything below a.",
     ("Φ((b − μ)/σ)", "Probability below the upper value."),
     ("− Φ((a − μ)/σ)", "Minus the probability below the lower value."))
note("inverse_normal",
     "The critical value is the cutoff that leaves the chosen error α split between the two tails.",
     ("1 − α/2", "The probability below the upper cutoff (α/2 in each tail)."),
     ("Φ⁻¹(…)", "The z value with that probability below it."),
     ("t⁻¹(…, df)", "The same for the t distribution, which has fatter tails for small samples."))
note("pvalue",
     "The p-value is how likely a result at least this extreme would be if the null hypothesis were true. Small p-values make the null harder to believe.",
     ("|t|", "How far the test statistic is from zero, in either direction."),
     ("P(|T| ≥ …)", "The chance of something at least that far out, from the t or normal distribution."))
note("ci_mean_data",
     "A confidence interval is the estimate plus or minus a margin. The margin is the critical value times the standard error, which shrinks as the sample grows.",
     ("x̄", "The sample mean, the center of the interval."),
     ("s ÷ √n", "Standard error: how much the mean varies from sample to sample."),
     ("t* ×", "Widened by the critical value for the confidence level."))
note("ci_mean_summary",
     "The same interval as from raw data, built from the mean, standard deviation and sample size directly.",
     ("x̄", "The sample mean."),
     ("s ÷ √n", "Standard error of the mean."),
     ("± t* ×", "The margin of error at the chosen confidence level."))
note("ci_proportion",
     "For a proportion, the standard error comes from the binomial spread p(1 − p).",
     ("p̂", "The sample proportion."),
     ("√(p̂(1 − p̂) ÷ n)", "Standard error of a proportion."),
     ("± z* ×", "The margin at the chosen confidence level."))
note("sample_size",
     "Turns the confidence-interval formula around: given the margin of error you want, solve for n. Halving the margin needs four times the sample.",
     ("z* σ ÷ E", "Critical value times spread, relative to the margin wanted."),
     ("(…)²", "Squared, because precision improves with √n."),
     ("p(1 − p)", "For proportions, the spread; 0.5 gives the most conservative size."))
note("t_test_one",
     "Measures how many standard errors the sample mean is from the hypothesized value.",
     ("x̄ − μ₀", "Difference between sample mean and the hypothesized mean."),
     ("÷ (s ÷ √n)", "In standard errors: the t statistic."),
     ("df = n − 1", "Degrees of freedom for the t distribution."))
note("t_test_two",
     "Compares two group means relative to how uncertain each is. Welch's version doesn't assume the groups have equal variances.",
     ("x̄₁ − x̄₂", "The difference in means."),
     ("√(s₁²/n₁ + s₂²/n₂)", "Standard error of that difference."),
     ("Welch–Satterthwaite df", "An adjusted degrees of freedom for unequal variances."))
note("correlation",
     "Correlation is covariance rescaled to run from −1 to 1, so it measures the strength of a straight-line relationship regardless of units.",
     ("cov(x, y)", "How x and y move together."),
     ("÷ (sₓ s_y)", "Divided by each one's spread to remove units."),
     ("t = r √((n − 2) ÷ (1 − r²))", "Test statistic for whether the true correlation is zero."))
note("ols",
     "Least squares picks the line that makes the squared vertical misses as small as possible. The slope is how much y moves with x, scaled by how much x varies.",
     ("β₁ = cov(x, y) ÷ var(x)", "The slope: change in y per one-unit change in x."),
     ("β₀ = ȳ − β₁x̄", "The intercept, set so the line passes through the means."),
     ("SE(β₁)", "Uncertainty in the slope; smaller with less scatter and more spread-out x."))
note("ols_predict",
     "A prediction uses the fitted line; its interval adds the line's own uncertainty to the scatter of individual points, and widens farther from the average x.",
     ("ŷ = β₀ + β₁x₀", "The point prediction at x₀."),
     ("t* sₑ", "Critical value times residual standard error."),
     ("√(1 + 1/n + (x₀ − x̄)² ÷ Σ(x − x̄)²)", "1 for a new observation's scatter, plus the line's uncertainty, which grows away from x̄."))
note("f_test",
     "The F test asks whether the model explains significantly more than nothing at all. Adjusted R² penalizes adding predictors that don't help.",
     ("R²/k", "Explained variation per predictor."),
     ("(1 − R²)/(n − k − 1)", "Unexplained variation per remaining degree of freedom."),
     ("adj. R²", "R² adjusted for the number of predictors."))
note("durbin_watson",
     "Checks whether regression errors are correlated with the previous period's error, common in time-series data. Around 2 means no autocorrelation.",
     ("(eₜ − eₜ₋₁)²", "Squared change in the residual from one period to the next."),
     ("÷ Σeₜ²", "Relative to the residuals' total size; near 0 means positive autocorrelation, near 4 negative."))
note("log_coef",
     "When a variable is in logs, its coefficient reads as a percentage effect. The exact conversions avoid the small-change approximation.",
     ("log-level: e^(βΔx) − 1", "Percent change in y for a Δx change in x."),
     ("level-log: β ln(1 + Δ%)", "Change in y for a percentage change in x."),
     ("log-log: β", "An elasticity: percent change in y per 1% change in x."))
note("binomial",
     "Counts the ways to get exactly k successes in n tries, times the chance of any one such arrangement.",
     ("C(n, k)", "Number of ways to choose which k tries succeed."),
     ("pᵏ", "Chance those k succeed."),
     ("(1 − p)ⁿ⁻ᵏ", "Chance the rest fail."))

# ── Economics ───────────────────────────────────────────────────────────────────
note("elasticity",
     "Elasticity is how strongly quantity responds to price, in percentages. The midpoint method gives the same answer whichever direction the change is measured.",
     ("%ΔQ", "Change in quantity relative to the average quantity."),
     ("%ΔP", "Change in price relative to the average price."),
     ("÷", "Above 1 (in absolute value) is elastic, below 1 inelastic."))
note("market_equilibrium",
     "The market clears where buyers want to buy as much as sellers want to sell. A tax drives a wedge between the price paid and received; surplus areas are triangles on the graph.",
     ("a − bQ", "Demand: the price buyers will pay for quantity Q."),
     ("c + dQ (+ t)", "Supply: the price sellers need, plus any per-unit tax."),
     ("set equal", "Solve for the quantity where they meet, then the price."),
     ("triangle areas", "Consumer and producer surplus, tax revenue and deadweight loss."))
note("cpi_inflation",
     "The CPI tracks the price of a fixed basket. The ratio of two CPI readings is how much prices rose, and dividing by it converts dollars between years.",
     ("CPI₁ ÷ CPI₀ − 1", "Inflation between the two dates."),
     ("nominal × CPI_base ÷ CPI_then", "Restates a past amount in base-year dollars."))
note("gdp_deflator",
     "Nominal GDP uses current prices and real GDP uses base-year prices, so their ratio is a broad price index.",
     ("nominal ÷ real", "How much higher today's prices are than base-year prices."),
     ("× 100", "Expressed as an index with the base year at 100."))
note("rule70",
     "Like the Rule of 72: dividing 70 by a growth rate approximates the years to double, the convention economists use for GDP and population.",
     ("70 ÷ growth %", "Approximate doubling time."),
     ("ln 2 ÷ ln(1 + g)", "The exact doubling time."))
note("multiplier",
     "Each dollar of spending becomes someone's income, part of which is spent again, and so on. The multiplier adds up that chain; taxes and saving shrink each round.",
     ("MPC(1 − t)", "Share of each extra dollar of income that is spent after tax."),
     ("1 ÷ (1 − …)", "Total spending from one initial dollar."),
     ("−MPC ÷ (…)", "A tax cut starts one step later (it's spent at the MPC), so its multiplier is smaller."))
note("money",
     "Banks lend out money that isn't held as reserves, which is redeposited and lent again. The quantity equation links money to prices.",
     ("1 ÷ reserve ratio", "Maximum money created per dollar of reserves."),
     ("%ΔM + %ΔV − %ΔY", "From MV = PY: inflation ≈ money growth plus velocity change minus real growth."))
note("taylor_rule",
     "A guide for setting interest rates: start at the neutral real rate plus inflation, then lean against inflation above target and output above potential.",
     ("r* + π", "The neutral nominal rate."),
     ("0.5(π − π*)", "Raise rates when inflation is above target."),
     ("0.5(output gap)", "Raise rates when the economy runs above potential."))
note("labor_market",
     "Labor-market rates are shares of different groups: the unemployed among those in the labor force, and the labor force among the adult population.",
     ("U ÷ (U + E)", "Unemployment rate: unemployed as a share of the labor force."),
     ("(U + E) ÷ population", "Participation rate: share of adults working or looking."))
note("okun",
     "Okun's law: when unemployment is above its natural rate, output falls short of potential by roughly a fixed multiple.",
     ("u − u*", "Unemployment above (or below) its natural rate."),
     ("−k ×", "Each point of excess unemployment costs about k% of potential output."))
note("monopoly",
     "A monopolist produces where one more unit adds as much revenue as it costs (MR = MC). That's less output and a higher price than competition, which causes a deadweight loss.",
     ("MR = a − 2bQ", "Marginal revenue falls twice as fast as demand price, because selling more lowers the price on all units."),
     ("= MC", "Profit-maximizing quantity."),
     ("(a − MC)² ÷ 8b", "Deadweight loss: the triangle of trades that would benefit both sides but don't happen."))
note("costs",
     "Cost per unit, measured different ways: marginal cost is the cost of the next unit; average costs spread totals over all units.",
     ("ΔTC ÷ ΔQ", "Marginal cost."),
     ("TC ÷ Q", "Average total cost."),
     ("VC ÷ Q, FC ÷ Q", "Average variable and average fixed cost."))
note("hhi",
     "Concentration index: squaring market shares weights big firms much more heavily, so a market dominated by a few scores high.",
     ("share in %", "Each firm's market share as a whole-number percentage."),
     ("²", "Squared to emphasize large firms."),
     ("Σ", "Added up: up to 10,000 for a monopoly."))
note("cobb_douglas",
     "Output comes from capital and labor with set shares. Growth accounting peels off what capital and labor explain; what's left is productivity growth.",
     ("A Kᵅ L¹⁻ᵅ", "Output from productivity A, capital K and labor L."),
     ("α g_K + (1 − α) g_L", "Growth explained by more capital and labor."),
     ("g_Y − …", "The remainder: total factor productivity growth."))
note("comparative_advantage",
     "Trade pays off by comparing opportunity costs, not absolute ability: whoever gives up less to make something should make it.",
     ("Y given up", "Output of the other good sacrificed."),
     ("÷ X gained", "Per unit of this good: the opportunity cost."))

# ── Planning & protection ───────────────────────────────────────────────────────
note("net_worth",
     "Net worth is what you'd have if you sold everything and paid off every debt.",
     ("Assets", "Everything owned, at current value."),
     ("− liabilities", "Everything owed."))
note("savings_rate",
     "The share of income you keep, a core measure of financial progress.",
     ("Savings", "Money saved or invested in the year."),
     ("÷ gross income", "As a share of income before tax."))
note("emergency_fund",
     "A cash cushion sized in months of essential expenses.",
     ("Monthly expenses", "Essential spending each month."),
     ("× months", "How many months to cover."))
note("college",
     "College costs rise each year, so each year's cost is today's cost grown by college inflation, and the fund must cover all of them.",
     ("Cost grows with inflation", "Each year's cost, inflated to when it's paid."),
     ("funded by the first day", "The total needed when college starts, and the saving required to get there."))
note("life_insurance",
     "Coverage should replace what your family would lose and cover what they'd owe, minus what they already have.",
     ("PV(income)", "Today's value of the income to replace."),
     ("+ debts + goals", "Mortgage, other debts and goals such as college."),
     ("− existing coverage − assets", "What's already in place."))
note("estate_exposure",
     "Federal estate tax applies only above the remaining exemption, at the top rate.",
     ("estate − remaining exemption", "The taxable amount above the exemption."),
     ("× top rate", "Estimated federal estate tax."))
note("debt_vs_invest",
     "Paying down debt earns a guaranteed return equal to its after-tax interest rate. Compare that with the after-tax return you'd expect from investing.",
     ("After-tax return", "What investing is expected to earn after tax."),
     ("− after-tax debt cost", "What the debt costs after any tax deduction."),
     ("result", "Positive favors investing; negative favors paying down the debt."))
note("loan_payment",
     "The level payment that repays the loan exactly over its term: early payments are mostly interest, later ones mostly principal.",
     ("i", "The monthly interest rate (annual rate ÷ 12)."),
     ("Principal × i", "One month's interest on the full loan."),
     ("÷ (1 − (1+i)^−n)", "Spreads repayment evenly across n monthly payments."))
