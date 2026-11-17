"""State individual income tax tables for Wealth Desk (tax year 2026).

Base: Tax Foundation, "State Individual Income Tax Rates and Brackets, 2026" (as of January 1,
2026), and "State Capital Gains Tax Rates, 2026". Corrected for laws enacted after that table and
checked against official state publications where noted in `verified`.

Model (an estimate, stated in the app):
  state taxable income = AGI − standard deduction (phased out where noted) − personal exemptions
  tax = brackets(taxable income) − personal credits, never below zero
Single and joint amounts as published; head of household uses single amounts unless a state's own
head-of-household figures are given. Also modeled: New York's bracket recapture and
Connecticut's exemption phase-out, add-back, recapture and personal credit. Not modeled: local income
taxes, dependents, most other phase-outs (South Carolina's deduction phase-out is modeled), state-specific additions and
subtractions (Social Security, pensions, federal tax deductibility), and credits other than
personal credits.

Brackets: [[threshold, rate], ...] ascending; each rate applies from its threshold to the next.
"""

TAX_YEAR = 2026
VERIFIED_ON = "2026-11-16"

SOURCES = [
    {"title": "Tax Foundation • State Individual Income Tax Rates and Brackets, 2026 (as of Jan 1, 2026)",
     "url": "https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/"},
    {"title": "Tax Foundation • State Capital Gains Tax Rates, 2026",
     "url": "https://taxfoundation.org/data/all/state/state-capital-gains-tax-rates/"},
    {"title": "New York State • IT-201-I (2025) tax rate schedules and tax computation worksheets",
     "url": "https://www.tax.ny.gov/pdf/2025/inc/it201i_2025.pdf"},
    {"title": "Connecticut DRS • Form CT-1040 TCS (Rev. 12/25), Tables A-E",
     "url": "https://portal.ct.gov/-/media/drs/forms/2025/income/ct-1040-tcs_1225.pdf"},
]

NOTES = [
    "State tax is an estimate: brackets, standard deduction, personal exemptions and personal credits for the filing status.",
    "Starts from adjusted gross income. In calculators that take federal taxable income, AGI is estimated as taxable income plus the federal standard deduction.",
    "Not included: local income taxes (for example New York City, Maryland counties, and Ohio, Pennsylvania and Michigan cities), dependents, most other phase-outs, and state-specific adjustments such as Social Security or pension exclusions.",
    "New York's and Connecticut's high-income recapture of their lower brackets is included.",
    "Head of household uses single amounts except where a state publishes its own (California, Connecticut, New York, South Carolina).",
]


def flat(rate, start=0):
    return [[0, 0.0], [start, rate]] if start else [[0, rate]]


def S(code, name, single=None, married=None, *, hoh=None, deduction=(0, 0), exemption=(0, 0), credit=(0, 0),
      hoh_deduction=None, phaseout=None, phaseout_round=0, gains=None, verified="Tax Foundation 2026 table", notes=(),
      hoh_exemption=None, extra=None):
    st = {"code": code, "name": name, "verified": verified, "notes": list(notes)}
    if single is None:
        st["none"] = True
    else:
        st["brackets"] = {"single": single, "married": married if married is not None else single}
        if hoh:
            st["brackets"]["hoh"] = hoh
        st["deduction"] = {"single": deduction[0], "married": deduction[1]}
        if hoh_deduction is not None:
            st["deduction"]["hoh"] = hoh_deduction
        st["exemption"] = {"single": exemption[0], "married": exemption[1]}
        if hoh_exemption is not None:
            st["exemption"]["hoh"] = hoh_exemption
        st["credit"] = {"single": credit[0], "married": credit[1]}
        if phaseout:
            st["deductionPhaseout"] = phaseout
            if phaseout_round:
                st["phaseoutRound"] = phaseout_round
    if extra:
        st.update(extra)
    if gains:
        st["gains"] = gains
    return st


FED_SD = (16100, 32200)       # federal standard deduction 2026, used by states that adopt it
PRE_OBBBA_SD = (8350, 16700)  # states conforming to the pre-2025 federal standard deduction

STATES = [
    S("AL", "Alabama", [[0, .02], [500, .04], [3000, .05]], [[0, .02], [1000, .04], [6000, .05]],
      deduction=(3000, 8500), exemption=(1500, 3000),
      notes=["Alabama lets taxpayers deduct federal income tax paid and phases its standard deduction down at higher incomes; neither is modeled, so this overstates Alabama tax."]),
    S("AK", "Alaska"),
    S("AZ", "Arizona", flat(.025), deduction=PRE_OBBBA_SD, gains={"exclude": 0.25}),
    S("AR", "Arkansas",
      [[0, 0.0], [5600, .02], [11200, .03], [16000, .034], [26400, .037], [94700, 0.136055], [97600, .037]],
      deduction=(2470, 4940), credit=(29, 58),
      gains={"exclude": 0.50, "exemptAbove": 10_000_000},
      verified="Official: Arkansas DFA Withholding Tax Formula effective 1/1/2026 (top rate 3.7% under HB 1001, 2026)",
      notes=["Between $94,700 and $97,600 of net income Arkansas takes back the benefit of its lower brackets; modeled as a steep band that ends at the DFA formula's 3.7% × income − $79.90."]),
    S("CA", "California",
      [[0, .01], [11079, .02], [26264, .04], [41452, .06], [57542, .08], [72724, .093], [371479, .103], [445771, .113],
       [742953, .123], [1_000_000, .133]],
      [[0, .01], [22158, .02], [52528, .04], [82904, .06], [115084, .08], [145448, .093], [742958, .103], [891542, .113],
       [1_000_000, .123], [1485906, .133]],
      hoh=[[0, .01], [22173, .02], [52530, .04], [67716, .06], [83805, .08], [98990, .093], [505208, .103], [606251, .113],
           [1_000_000, .123], [1010417, .133]],
      deduction=(5706, 11412), hoh_deduction=11412, credit=(153, 306),
      verified="Official: FTB 2025 California Tax Rate Schedules X, Y, Z and 2025 standard deduction (2026 schedules not yet published)",
      notes=["Includes the 1% Behavioral Health Services Tax on taxable income over $1 million.",
             "Uses 2025 brackets and deduction, the latest California has published; California indexes them each year."]),
    S("CO", "Colorado", flat(.044), deduction=FED_SD),
    S("CT", "Connecticut",
      [[0, .02], [10000, .045], [50000, .055], [100000, .06], [200000, .065], [250000, .069], [500000, .0699]],
      [[0, .02], [20000, .045], [100000, .055], [200000, .06], [400000, .065], [500000, .069], [1_000_000, .0699]],
      hoh=[[0, .02], [16000, .045], [80000, .055], [160000, .06], [320000, .065], [400000, .069], [800000, .0699]],
      exemption=(15000, 24000), hoh_exemption=19000,
      extra={
          # Table A: exemption falls $1,000 for each $1,000 (or part) of AGI over the start.
          "exemptionPhaseout": {"single": [30000, 1000, 1000], "married": [48000, 1000, 1000], "hoh": [38000, 1000, 1000]},
          # Tables C (2% rate phase-out add-back) and D (recapture), summed: [AGI over, step width, amount per step, cap].
          "addBack": {
              "single": [[56500, 5000, 25, 250], [105000, 5000, 25, 250], [200000, 5000, 90, 2700], [500000, 5000, 50, 450]],
              "married": [[100500, 5000, 50, 500], [210000, 10000, 50, 500], [400000, 10000, 180, 5400], [1_000_000, 10000, 100, 900]],
              "hoh": [[78500, 4000, 40, 400], [168000, 8000, 40, 400], [320000, 8000, 140, 4200], [800000, 8000, 80, 720]],
          },
          # Table E: personal tax credit as a share of tax, by AGI ("more than" each amount).
          "creditRate": {
              "single": [[0, .75], [18800, .70], [19300, .65], [19800, .60], [20300, .55], [20800, .50], [21300, .45], [21800, .40],
                         [22300, .35], [25000, .30], [25500, .25], [26000, .20], [26500, .15], [31300, .14], [31800, .13], [32300, .12],
                         [32800, .11], [33300, .10], [60000, .09], [60500, .08], [61000, .07], [61500, .06], [62000, .05], [62500, .04],
                         [63000, .03], [63500, .02], [64000, .01], [64500, 0.0]],
              "married": [[0, .75], [30000, .70], [30500, .65], [31000, .60], [31500, .55], [32000, .50], [32500, .45], [33000, .40],
                          [33500, .35], [40000, .30], [40500, .25], [41000, .20], [41500, .15], [50000, .14], [50500, .13], [51000, .12],
                          [51500, .11], [52000, .10], [96000, .09], [96500, .08], [97000, .07], [97500, .06], [98000, .05], [98500, .04],
                          [99000, .03], [99500, .02], [100000, .01], [100500, 0.0]],
              "hoh": [[0, .75], [24000, .70], [24500, .65], [25000, .60], [25500, .55], [26000, .50], [26500, .45], [27000, .40],
                      [27500, .35], [34000, .30], [34500, .25], [35000, .20], [35500, .15], [44000, .14], [44500, .13], [45000, .12],
                      [45500, .11], [46000, .10], [74000, .09], [74500, .08], [75000, .07], [75500, .06], [76000, .05], [76500, .04],
                      [77000, .03], [77500, .02], [78000, .01], [78500, 0.0]],
          },
      },
      verified="Official: Connecticut DRS Form CT-1040 TCS (Rev. 12/25), Tables A-E; Connecticut has not changed them for 2026",
      notes=["Includes Connecticut's exemption phase-out, 2% rate phase-out add-back, recapture of lower brackets and personal tax credit (Tables A, C, D and E).",
             "Connecticut adds tax in $5,000 steps of income; the next-dollar rate shown spreads each step evenly across its $5,000."]),
    S("DE", "Delaware",
      [[0, 0.0], [2000, .022], [5000, .039], [10000, .048], [20000, .052], [25000, .0555], [60000, .066]],
      deduction=(3250, 6500), credit=(110, 220)),
    S("DC", "District of Columbia",
      [[0, .04], [10000, .06], [40000, .065], [60000, .085], [250000, .0925], [500000, .0975], [1_000_000, .1075]],
      deduction=FED_SD),
    S("FL", "Florida"),
    S("GA", "Georgia", flat(.0499), deduction=(12000, 24000),
      verified="Law: HB 463 (signed May 2026) sets 4.99% for tax years beginning in 2026"),
    S("HI", "Hawaii",
      [[0, .014], [9600, .032], [14400, .055], [19200, .064], [24000, .068], [36000, .072], [48000, .076], [125000, .079],
       [175000, .0825], [225000, .09], [275000, .10], [325000, .11]],
      [[0, .014], [19200, .032], [28800, .055], [38400, .064], [48000, .068], [72000, .072], [96000, .076], [250000, .079],
       [350000, .0825], [450000, .09], [550000, .10], [650000, .11]],
      deduction=(4400, 8800), exemption=(1144, 2288), gains={"maxRate": 0.0725}),
    S("ID", "Idaho", [[0, 0.0], [4811, .053]], [[0, 0.0], [9622, .053]], deduction=FED_SD),
    S("IL", "Illinois", flat(.0495), exemption=(2925, 5850)),
    S("IN", "Indiana", flat(.0295), exemption=(1000, 2000),
      notes=["Indiana counties add their own income tax, not included."]),
    S("IA", "Iowa", flat(.038), deduction=FED_SD, credit=(40, 80)),
    S("KS", "Kansas", [[0, .052], [23000, .0558]], [[0, .052], [46000, .0558]], deduction=(3605, 8240), exemption=(9160, 18320)),
    S("KY", "Kentucky", flat(.035), deduction=(3360, 3360), notes=["Kentucky cities and counties add occupational taxes, not included."]),
    S("LA", "Louisiana", flat(.03), deduction=(12875, 25750)),
    S("ME", "Maine", [[0, .058], [27399, .0675], [64849, .0715]], [[0, .058], [54849, .0675], [129749, .0715]],
      deduction=PRE_OBBBA_SD, exemption=(5300, 10600)),
    S("MD", "Maryland",
      [[0, .02], [1000, .03], [2000, .04], [3000, .0475], [100000, .05], [125000, .0525], [150000, .055], [250000, .0575],
       [500000, .0625], [1_000_000, .065]],
      [[0, .02], [1000, .03], [2000, .04], [3000, .0475], [150000, .05], [175000, .0525], [225000, .055], [300000, .0575],
       [600000, .0625], [1_200_000, .065]],
      deduction=(3350, 6700), exemption=(3200, 6400), gains={"surtax": 0.02, "agiOver": 350000},
      notes=["Maryland counties and Baltimore City add 2.25%–3.30% local income tax, not included."]),
    S("MA", "Massachusetts", [[0, .05], [1083150, .09]], exemption=(4400, 8800)),
    S("MI", "Michigan", flat(.0425), exemption=(5900, 11800), notes=["Some Michigan cities add income tax, not included."]),
    S("MN", "Minnesota", [[0, .0535], [33310, .068], [109430, .0785], [203150, .0985]],
      [[0, .0535], [48700, .068], [193480, .0785], [337930, .0985]], deduction=(15300, 30600),
      gains={"niiSurtax": 0.01, "niiOver": 1_000_000}),
    S("MS", "Mississippi", flat(.04, 10000), deduction=(2300, 4600), exemption=(6000, 12000)),
    S("MO", "Missouri", [[0, 0.0], [1348, .02], [2696, .025], [4044, .03], [5392, .035], [6740, .04], [8088, .045], [9436, .047]],
      deduction=FED_SD, gains={"none": True}),
    S("MT", "Montana", [[0, .047], [47500, .0565]], [[0, .047], [95000, .0565]], deduction=FED_SD,
      gains={"rates": [0.03, 0.041], "threshold": {"single": 47500, "married": 95000}}),
    S("NE", "Nebraska", [[0, .0246], [4130, .0351], [24760, .0455]], [[0, .0246], [8250, .0351], [49530, .0455]],
      deduction=(8850, 17700), credit=(176, 352)),
    S("NV", "Nevada"),
    S("NH", "New Hampshire"),
    S("NJ", "New Jersey",
      [[0, .014], [20000, .0175], [35000, .035], [40000, .0553], [75000, .0637], [500000, .0897], [1_000_000, .1075]],
      [[0, .014], [20000, .0175], [50000, .0245], [70000, .035], [80000, .0553], [150000, .0637], [500000, .0897], [1_000_000, .1075]],
      exemption=(1000, 2000)),
    S("NM", "New Mexico", [[0, .015], [5500, .032], [16500, .043], [33500, .047], [66500, .049], [210000, .059]],
      [[0, .015], [8000, .032], [25000, .043], [50000, .047], [100000, .049], [315000, .059]], deduction=FED_SD,
      gains={"excludeFlat": 2500}),
    S("NY", "New York",
      [[0, .039], [8500, .044], [11700, .0515], [13900, .054], [80650, .059], [215400, .0685], [1077550, .0965],
       [5_000_000, .103], [25_000_000, .109]],
      [[0, .039], [17150, .044], [23600, .0515], [27900, .054], [161550, .059], [323200, .0685], [2155350, .0965],
       [5_000_000, .103], [25_000_000, .109]],
      hoh=[[0, .039], [12800, .044], [17650, .0515], [20900, .054], [107650, .059], [269300, .0685], [1616450, .0965],
           [5_000_000, .103], [25_000_000, .109]],
      deduction=(8000, 16050), hoh_deduction=11200,
      extra={
          # Tax Law §601(d-1), IT-201 tax computation worksheets: above $107,650 of AGI the benefit of the
          # lower brackets is taken back over $50,000 of AGI. `first` is the bracket whose rate applies flat
          # to all income once fully phased in; each bracket above it phases in its own incremental benefit.
          "recapture": {"agiStart": 107650, "phaseIn": 50000, "flatAgi": 25_000_000,
                        "first": {"single": 4, "married": 3, "hoh": 4}},
      },
      verified="Official: NY IT-201-I (2025) tax computation worksheets 1-16, with the 2026 rates; recapture amounts derived the same way",
      notes=["Includes New York's recapture of the lower brackets for incomes over $107,650 (the IT-201 tax computation worksheets), worked out with 2026 rates.",
             "New York City and Yonkers income taxes are not included."]),
    S("NC", "North Carolina", flat(.0399), deduction=(12750, 25500)),
    S("ND", "North Dakota", [[0, 0.0], [48475, .0195], [244825, .025]], [[0, 0.0], [80975, .0195], [298075, .025]],
      deduction=FED_SD, gains={"exclude": 0.40}),
    S("OH", "Ohio", flat(.0275, 26050), exemption=(2400, 4800),
      notes=["Ohio cities and school districts add income tax, not included. Exemptions end above $500,000 of income; not modeled."]),
    S("OK", "Oklahoma", [[0, 0.0], [3750, .025], [4900, .035], [7200, .045]], [[0, 0.0], [7500, .025], [9800, .035], [14400, .045]],
      deduction=(6350, 12700), exemption=(1000, 2000)),
    S("OR", "Oregon", [[0, .0475], [4550, .0675], [11400, .0875], [125000, .099]],
      [[0, .0475], [9100, .0675], [22800, .0875], [250000, .099]], deduction=(2910, 5820), credit=(256, 512),
      notes=["Oregon lets taxpayers subtract part of federal income tax paid; not modeled, so this overstates Oregon tax somewhat."]),
    S("PA", "Pennsylvania", flat(.0307), notes=["Pennsylvania municipalities and school districts add earned-income tax, not included."]),
    S("RI", "Rhode Island", [[0, .0375], [82050, .0475], [186450, .0599]], deduction=(11200, 22400), exemption=(5250, 10500)),
    S("SC", "South Carolina", [[0, .0199], [30000, .0521]], deduction=(15000, 30000), hoh_deduction=22500,
      phaseout={"single": [40000, 95000], "married": [80000, 190000], "hoh": [60000, 142500]},
      phaseout_round=10,
      gains={"exclude": 0.44},
      verified="Official: SC Department of Revenue, 2026 Tax Legislation Update (Act 110 / H.4216): 1.99% and 5.21%, SC Income Adjusted Deduction"),
    S("SD", "South Dakota"),
    S("TN", "Tennessee"),
    S("TX", "Texas"),
    S("UT", "Utah", flat(.0445), credit=(966, 1932),
      verified="Law: SB 60 (2026) sets 4.45% retroactive to January 1, 2026",
      notes=["Utah's taxpayer credit phases out as income rises; not modeled, so higher earners' Utah tax is understated by up to the credit."]),
    S("VT", "Vermont", [[0, .0335], [49400, .066], [119700, .076], [249700, .0875]],
      [[0, .0335], [82500, .066], [199450, .076], [304000, .0875]], deduction=(7650, 15300), exemption=(5300, 10600)),
    S("VA", "Virginia", [[0, .02], [3000, .03], [5000, .05], [17000, .0575]], deduction=(8750, 17500), exemption=(930, 1860)),
    S("WA", "Washington", gains={"separate": {"deduction": 278000, "brackets": [[0, .07], [1_000_000, .099]]}},
      notes=["Washington has no tax on wages. It taxes long-term capital gains: 7% above a $278,000 deduction (2025 amount; 2026 not yet published) and 9.9% on gains above $1 million."]),
    S("WV", "West Virginia", [[0, .0211], [10000, .0281], [25000, .0316], [40000, .0422], [60000, .0458]],
      exemption=(2000, 4000),
      verified="Official: enrolled Committee Substitute for SB 392 (2026), §11-21-4j, rates for 2026"),
    S("WI", "Wisconsin", [[0, .035], [15110, .044], [51950, .053], [332720, .0765]],
      [[0, .035], [20150, .044], [69260, .053], [443630, .0765]], deduction=(13960, 25840), exemption=(700, 1400),
      gains={"exclude": 0.30}, notes=["Wisconsin's standard deduction phases out as income rises; not modeled."]),
    S("WY", "Wyoming"),
]

# Choice values for the "State" field: 0 = not included, then alphabetical by name.
STATES.sort(key=lambda s: s["name"])
OPTIONS = [{"value": 0, "label": "No state tax (not included)"}] + [
    {"value": i + 1, "label": s["name"]} for i, s in enumerate(STATES)]
for i, s in enumerate(STATES):
    s["value"] = i + 1
assert len(STATES) == 51
