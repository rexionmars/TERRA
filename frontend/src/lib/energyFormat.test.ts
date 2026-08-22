/**
 * The precision each energy quantity is printed at, pinned to the quantity
 * rather than to whichever site printed it.
 *
 * The module exists because seven quantities were printed by two surfaces at
 * two different roundings, so a reader could see one measurement twice and
 * find it disagreeing with itself. Nothing structural prevents that from
 * returning: each formatter is an independent literal, and a decimal changed
 * in one of them is a change no type and no compile step objects to. These
 * tests are what objects to it, which is why the expected precisions and units
 * below are written out here rather than read back from the module.
 *
 * Every expected string is derived by hand from the declared precision and the
 * rounding rule in ECMA-262 for Number.prototype.toFixed: the sign is stripped
 * first, then the integer n minimising |n / 10^f - x| is chosen, and on a tie
 * the larger n wins -- so halves round away from zero, not to even. Each tie
 * input below is a dyadic rational (k / 2^m) and therefore exact in binary64.
 * That matters: a decimal literal such as 1.005 is stored slightly under its
 * written value and does not tie at all, so a test built on one would be
 * measuring the float, not the rounding.
 */
import { describe, expect, it } from "vitest"
import {
  areaHa,
  capacityFactorPct,
  capacityMw,
  energyGwh,
  energyMwh,
  recordYears,
  speedMs,
} from "./energyFormat"

/** What each quantity is declared to print: the specification, restated. */
const QUANTITIES = [
  { name: "capacityMw", format: capacityMw, decimals: 2, unit: " MW" },
  { name: "energyGwh", format: energyGwh, decimals: 2, unit: " GWh/yr" },
  { name: "areaHa", format: areaHa, decimals: 1, unit: " ha" },
  { name: "speedMs", format: speedMs, decimals: 2, unit: " m/s" },
  {
    name: "capacityFactorPct",
    format: capacityFactorPct,
    decimals: 1,
    unit: "%",
  },
  { name: "energyMwh", format: energyMwh, decimals: 0, unit: " MWh" },
  { name: "recordYears", format: recordYears, decimals: 2, unit: " years" },
] as const

/** Digits after the decimal point, once the unit is taken off the end. */
function fractionDigits(text: string, unit: string): number {
  expect(text.endsWith(unit), text).toBe(true)
  const number = text.slice(0, text.length - unit.length)
  const point = number.indexOf(".")
  return point === -1 ? 0 : number.length - point - 1
}

describe("capacityMw", () => {
  it("prints two decimals and the megawatt unit, padding a whole number", () => {
    expect(capacityMw(12.5)).toBe("12.50 MW")
    expect(capacityMw(3)).toBe("3.00 MW")
  })

  it("keeps two capacities a sixteenth of a megawatt apart distinguishable", () => {
    // The reason for the second decimal. The section states capacity per
    // suitability class and the classes differ below a tenth of a megawatt,
    // so at one decimal both of these would read 1.3 MW and the class
    // breakdown would look like a repeated row.
    expect(capacityMw(1.25)).toBe("1.25 MW")
    expect(capacityMw(1.3125)).toBe("1.31 MW")
  })

  it("rounds a third decimal of exactly five away from zero", () => {
    expect(capacityMw(0.125)).toBe("0.13 MW")
  })

  it("carries a rounded fraction into the integer part", () => {
    expect(capacityMw(9.999)).toBe("10.00 MW")
  })

  it("prints a zero capacity at full precision rather than as a bare 0", () => {
    // A suitability class can be empty, and the column it sits in is read
    // downwards; "0" among "1.25" and "0.13" reads as a different measurement.
    expect(capacityMw(0)).toBe("0.00 MW")
  })
})

describe("energyGwh", () => {
  it("prints two decimals and the annual unit", () => {
    expect(energyGwh(1234.5)).toBe("1234.50 GWh/yr")
    expect(energyGwh(0)).toBe("0.00 GWh/yr")
  })

  it("rounds a third decimal of exactly five away from zero", () => {
    expect(energyGwh(0.625)).toBe("0.63 GWh/yr")
  })
})

describe("areaHa", () => {
  it("prints one decimal and the hectare unit", () => {
    expect(areaHa(12.5)).toBe("12.5 ha")
    expect(areaHa(0)).toBe("0.0 ha")
  })

  it("rounds a half tenth away from zero", () => {
    expect(areaHa(0.25)).toBe("0.3 ha")
  })

  it("carries a rounded fraction into the integer part", () => {
    expect(areaHa(9.99)).toBe("10.0 ha")
  })

  it("prints the same figure for two areas differing by a thousandth", () => {
    // A thousandth of a hectare is ten square metres, on an area summed from a
    // raster whose pixel covers a hundred. Printing that digit would assert a
    // resolution the input does not have.
    expect(areaHa(12.3)).toBe("12.3 ha")
    expect(areaHa(12.301)).toBe("12.3 ha")
  })
})

describe("speedMs", () => {
  it("prints two decimals and the metres-per-second unit", () => {
    expect(speedMs(7.5)).toBe("7.50 m/s")
  })

  it("rounds a third decimal of exactly five away from zero", () => {
    expect(speedMs(7.125)).toBe("7.13 m/s")
  })

  it("prints the same figure for two speeds differing at the fourth decimal", () => {
    // The shear table carries four decimals on its own field, where
    // consecutive rows genuinely differ below a centimetre per second. This is
    // a single reported hub speed, with no neighbouring row to separate it
    // from, so the fourth decimal has nothing to distinguish.
    expect(speedMs(6.8125)).toBe("6.81 m/s")
    expect(speedMs(6.8126)).toBe("6.81 m/s")
  })
})

describe("capacityFactorPct", () => {
  it("prints one decimal and a percent sign with nothing between them", () => {
    const text = capacityFactorPct(41.5)
    expect(text).toBe("41.5%")
    // No space anywhere in the string: a space is a place a line can break,
    // and a percent sign that wraps onto the next line reads as a footnote.
    expect(text).not.toContain(" ")
  })

  it("rounds a half tenth away from zero", () => {
    expect(capacityFactorPct(18.75)).toBe("18.8%")
  })

  it("prints both ends of the range at the same one decimal", () => {
    expect(capacityFactorPct(0)).toBe("0.0%")
    expect(capacityFactorPct(100)).toBe("100.0%")
  })
})

describe("energyMwh", () => {
  it("prints whole megawatt-hours with no decimal point", () => {
    const text = energyMwh(1234.4)
    expect(text).toBe("1234 MWh")
    expect(text).not.toContain(".")
    expect(energyMwh(4200)).toBe("4200 MWh")
  })

  it("rounds a half away from zero rather than to the even value", () => {
    // Banker's rounding, which several formatting libraries use, would return
    // 2 and 4 here. A column summed by a reader would then be short by the
    // difference, with no digit on screen showing where it went.
    expect(energyMwh(2.5)).toBe("3 MWh")
    expect(energyMwh(3.5)).toBe("4 MWh")
  })

  it("collapses an energy below half a megawatt-hour to zero", () => {
    expect(energyMwh(0.4)).toBe("0 MWh")
    expect(energyMwh(0)).toBe("0 MWh")
  })
})

describe("recordYears", () => {
  it("prints two decimals and the years unit", () => {
    expect(recordYears(30)).toBe("30.00 years")
  })

  it("rounds a third decimal of exactly five away from zero", () => {
    expect(recordYears(42.125)).toBe("42.13 years")
  })

  it("prints a record shorter than one year at the same two decimals", () => {
    // The figure is captioned with `record_window`, which carries the exact
    // dates, so a short record has to be legible as a fraction beside them.
    expect(recordYears(0.5)).toBe("0.50 years")
  })
})

describe("the formatters as a set", () => {
  it("gives each quantity one precision, whatever the magnitude", () => {
    // The failure the module was written against: one quantity printed at two
    // roundings by two surfaces that sit on screen together. It returns the
    // moment a formatter's precision depends on anything but the quantity, so
    // the check is run across five magnitudes rather than one.
    const magnitudes = [0, 1, 7.5, 1234.5678, 0.0001]
    for (const q of QUANTITIES) {
      for (const v of magnitudes) {
        expect(fractionDigits(q.format(v), q.unit), `${q.name}(${v})`).toBe(
          q.decimals
        )
      }
    }
  })

  it("ends every quantity with its unit, so no bare number reaches a caption", () => {
    // These strings are used as the whole value of a headline figure, with the
    // label carrying the quantity and not the unit. A formatter that returned
    // digits alone would put an unlabelled number under "Mean speed".
    //
    // Written out rather than assembled from the table above, so that the
    // seven contracts can be read at once: one value, seven renderings.
    expect(capacityMw(1)).toBe("1.00 MW")
    expect(energyGwh(1)).toBe("1.00 GWh/yr")
    expect(areaHa(1)).toBe("1.0 ha")
    expect(speedMs(1)).toBe("1.00 m/s")
    expect(capacityFactorPct(1)).toBe("1.0%")
    expect(energyMwh(1)).toBe("1 MWh")
    expect(recordYears(1)).toBe("1.00 years")
  })

  it("prints a plain decimal, with no thousands separator and no exponent", () => {
    // toFixed, not toLocaleString. A grouped number reads differently on two
    // machines with different locales -- and in some of them the separator is
    // the decimal comma, which would move the point rather than mark a
    // thousand.
    for (const q of QUANTITIES) {
      for (const v of [1234.5, 0.0001, 1000000]) {
        const text = q.format(v)
        expect(text, `${q.name}(${v})`).not.toContain(",")
        expect(text, `${q.name}(${v})`).not.toContain("e+")
      }
    }
  })

  it("prints capacity and annual energy at a matching precision", () => {
    // The stated reason for two decimals on energy: a reader divides the
    // printed energy by the printed capacity to check the yield by hand. If
    // one of the two carried a digit the other did not, the quotient would not
    // reproduce the figure printed beside them.
    expect(fractionDigits(energyGwh(24.5), " GWh/yr")).toBe(
      fractionDigits(capacityMw(12.5), " MW")
    )
  })
})
