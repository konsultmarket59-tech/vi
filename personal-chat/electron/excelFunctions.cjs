// Excel functions that fast-formula-parser ships as empty stubs.
//
// The library implements ~290 functions but leaves ~50 as `() => {}` placeholders,
// and its dispatcher turns an undefined return into "Function X is not implemented".
// Several of those blanks are everyday spreadsheet functions — MAX and MIN among
// them — so a normal business workbook fails to recalculate without these.
// Anything passed in the parser's `functions` option overrides the built-in entry,
// which is how these get used.

const FormulaParser = require("fast-formula-parser");
const { FormulaError, FormulaHelpers } = FormulaParser;

/** Flattens parser arguments (scalars, ranges, nested arrays) into a plain list. */
function flatten(args) {
  const out = [];
  const walk = (v) => {
    if (v == null) return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v === "object" && "value" in v) return walk(v.value);
    out.push(v);
  };
  args.forEach(walk);
  return out;
}

/** Numbers only — Excel's MAX/MIN/SUM family ignores text and blanks. */
function numbers(args) {
  return flatten(args)
    .filter((v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))))
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

/** MAXA/MINA count text as 0 and booleans as 1/0, unlike MAX/MIN. */
function numbersWithText(args) {
  return flatten(args).map((v) => {
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") return isNaN(Number(v)) ? 0 : Number(v);
    return 0;
  });
}

function mean(list) {
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function variance(list, sample) {
  if (list.length < (sample ? 2 : 1)) throw FormulaError.DIV0;
  const m = mean(list);
  const sum = list.reduce((acc, x) => acc + (x - m) ** 2, 0);
  return sum / (list.length - (sample ? 1 : 0));
}

/** Excel's percentile with linear interpolation (the .INC variant). */
function percentileInc(list, p) {
  if (list.length === 0 || p < 0 || p > 1) throw FormulaError.NUM;
  const sorted = [...list].sort((a, b) => a - b);
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * Excel's wildcard/comparison criteria used by SUMIFS/COUNTIFS/AVERAGEIFS:
 * ">100", "<=5", "<>x", "Иван", "Ив*".
 */
function makeCriteria(raw) {
  let criterion = raw;
  if (criterion && typeof criterion === "object" && "value" in criterion) criterion = criterion.value;
  if (typeof criterion === "number" || typeof criterion === "boolean") {
    return (v) => v === criterion || Number(v) === Number(criterion);
  }
  const text = String(criterion ?? "");
  const m = /^(<=|>=|<>|=|<|>)(.*)$/.exec(text);
  const op = m ? m[1] : "=";
  const operand = m ? m[2] : text;
  const operandNum = operand.trim() === "" ? NaN : Number(operand);
  const isNum = !isNaN(operandNum);

  return (value) => {
    const vNum = typeof value === "number" ? value : Number(value);
    const comparable = isNum && !isNaN(vNum);
    switch (op) {
      case "<": return comparable && vNum < operandNum;
      case ">": return comparable && vNum > operandNum;
      case "<=": return comparable && vNum <= operandNum;
      case ">=": return comparable && vNum >= operandNum;
      case "<>": return comparable ? vNum !== operandNum : String(value ?? "") !== operand;
      default: {
        if (comparable) return vNum === operandNum;
        const target = String(value ?? "");
        if (/[*?]/.test(operand)) {
          const rx = new RegExp(
            "^" + operand.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
            "i"
          );
          return rx.test(target);
        }
        return target.toLowerCase() === operand.toLowerCase();
      }
    }
  };
}

/** Applies the (range, criteria) pairs of the *IFS family, returning matching indexes. */
function matchingIndexes(pairs, length) {
  const hits = [];
  for (let i = 0; i < length; i++) {
    let ok = true;
    for (const [range, criteria] of pairs) {
      if (!criteria(range[i])) {
        ok = false;
        break;
      }
    }
    if (ok) hits.push(i);
  }
  return hits;
}

function toFlatArray(arg) {
  return flatten([arg]);
}

/** Builds the (range, matcher) pairs from an *IFS argument list. */
function buildPairs(args, startIndex) {
  const pairs = [];
  for (let i = startIndex; i + 1 < args.length; i += 2) {
    pairs.push([toFlatArray(args[i]), makeCriteria(args[i + 1])]);
  }
  return pairs;
}

const EXTRA_FUNCTIONS = {
  MAX: (...args) => {
    const list = numbers(args);
    return list.length === 0 ? 0 : Math.max(...list);
  },
  MIN: (...args) => {
    const list = numbers(args);
    return list.length === 0 ? 0 : Math.min(...list);
  },
  MAXA: (...args) => {
    const list = numbersWithText(args);
    return list.length === 0 ? 0 : Math.max(...list);
  },
  MINA: (...args) => {
    const list = numbersWithText(args);
    return list.length === 0 ? 0 : Math.min(...list);
  },
  MEDIAN: (...args) => {
    const list = numbers(args).sort((a, b) => a - b);
    if (list.length === 0) throw FormulaError.NUM;
    const mid = Math.floor(list.length / 2);
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  },
  LARGE: (range, k) => {
    const list = numbers([range]).sort((a, b) => b - a);
    const n = Math.trunc(FormulaHelpers.accept(k, null, 1));
    if (n < 1 || n > list.length) throw FormulaError.NUM;
    return list[n - 1];
  },
  SMALL: (range, k) => {
    const list = numbers([range]).sort((a, b) => a - b);
    const n = Math.trunc(FormulaHelpers.accept(k, null, 1));
    if (n < 1 || n > list.length) throw FormulaError.NUM;
    return list[n - 1];
  },
  "STDEV.S": (...args) => Math.sqrt(variance(numbers(args), true)),
  "STDEV.P": (...args) => Math.sqrt(variance(numbers(args), false)),
  STDEVA: (...args) => Math.sqrt(variance(numbersWithText(args), true)),
  STDEVPA: (...args) => Math.sqrt(variance(numbersWithText(args), false)),
  "VAR.S": (...args) => variance(numbers(args), true),
  "VAR.P": (...args) => variance(numbers(args), false),
  VARA: (...args) => variance(numbersWithText(args), true),
  VARPA: (...args) => variance(numbersWithText(args), false),
  "PERCENTILE.INC": (range, p) => percentileInc(numbers([range]), FormulaHelpers.accept(p, null, 0)),
  "QUARTILE.INC": (range, q) => percentileInc(numbers([range]), Math.trunc(FormulaHelpers.accept(q, null, 0)) / 4),
  "MODE.SNGL": (...args) => {
    const list = numbers(args);
    const counts = new Map();
    for (const n of list) counts.set(n, (counts.get(n) || 0) + 1);
    let best = null;
    let bestCount = 1;
    for (const [n, c] of counts) {
      if (c > bestCount) {
        best = n;
        bestCount = c;
      }
    }
    if (best === null) throw FormulaError.NA;
    return best;
  },
  "RANK.EQ": (value, range, order) => {
    const v = FormulaHelpers.accept(value, null, 0);
    const asc = order != null && FormulaHelpers.accept(order, null, 0);
    const list = numbers([range]).sort((a, b) => (asc ? a - b : b - a));
    const idx = list.indexOf(v);
    if (idx === -1) throw FormulaError.NA;
    return idx + 1;
  },
  SUMIFS: (sumRange, ...rest) => {
    const values = toFlatArray(sumRange);
    const pairs = buildPairs(rest, 0);
    return matchingIndexes(pairs, values.length).reduce((acc, i) => acc + (Number(values[i]) || 0), 0);
  },
  AVERAGEIFS: (avgRange, ...rest) => {
    const values = toFlatArray(avgRange);
    const hits = matchingIndexes(buildPairs(rest, 0), values.length);
    if (hits.length === 0) throw FormulaError.DIV0;
    return hits.reduce((acc, i) => acc + (Number(values[i]) || 0), 0) / hits.length;
  },
  MAXIFS: (maxRange, ...rest) => {
    const values = toFlatArray(maxRange);
    const hits = matchingIndexes(buildPairs(rest, 0), values.length).map((i) => Number(values[i]) || 0);
    return hits.length ? Math.max(...hits) : 0;
  },
  MINIFS: (minRange, ...rest) => {
    const values = toFlatArray(minRange);
    const hits = matchingIndexes(buildPairs(rest, 0), values.length).map((i) => Number(values[i]) || 0);
    return hits.length ? Math.min(...hits) : 0;
  },
  MATCH: (lookup, range, matchType) => {
    const target = FormulaHelpers.accept(lookup);
    const list = toFlatArray(range);
    const type = matchType == null ? 1 : Math.trunc(FormulaHelpers.accept(matchType, null, 1));
    if (type === 0) {
      const matcher = makeCriteria(target);
      const idx = list.findIndex((v) => matcher(v));
      if (idx === -1) throw FormulaError.NA;
      return idx + 1;
    }
    // Ordered search: largest value <= target (ascending) / smallest >= target (descending).
    let found = -1;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (v == null || v === "") continue;
      if (type === 1 ? v <= target : v >= target) found = i;
    }
    if (found === -1) throw FormulaError.NA;
    return found + 1;
  },
  // CHOOSE is on the parser's "needs context" list, so it is invoked as
  // fn(context, ...args) rather than fn(...args) — hence the leading parameter.
  CHOOSE: (_context, index, ...options) => {
    const i = Math.trunc(FormulaHelpers.accept(index, null, 0));
    if (i < 1 || i > options.length) throw FormulaError.VALUE;
    const chosen = options[i - 1];
    return chosen && typeof chosen === "object" && "value" in chosen ? chosen.value : chosen;
  },
  SWITCH: (expression, ...rest) => {
    const value = FormulaHelpers.accept(expression);
    for (let i = 0; i + 1 < rest.length; i += 2) {
      if (FormulaHelpers.accept(rest[i]) === value) return FormulaHelpers.accept(rest[i + 1]);
    }
    // An odd trailing argument is the default.
    if (rest.length % 2 === 1) return FormulaHelpers.accept(rest[rest.length - 1]);
    throw FormulaError.NA;
  },
  SUBSTITUTE: (text, oldText, newText, instanceNum) => {
    const s = String(FormulaHelpers.accept(text, null, "") ?? "");
    const from = String(FormulaHelpers.accept(oldText, null, "") ?? "");
    const to = String(FormulaHelpers.accept(newText, null, "") ?? "");
    if (from === "") return s;
    if (instanceNum == null) return s.split(from).join(to);
    const n = Math.trunc(FormulaHelpers.accept(instanceNum, null, 1));
    if (n < 1) throw FormulaError.VALUE;
    let seen = 0;
    let idx = 0;
    while (idx <= s.length - from.length) {
      const at = s.indexOf(from, idx);
      if (at === -1) break;
      seen++;
      if (seen === n) return s.slice(0, at) + to + s.slice(at + from.length);
      idx = at + from.length;
    }
    return s;
  },
  TEXTJOIN: (delimiter, ignoreEmpty, ...args) => {
    const sep = String(FormulaHelpers.accept(delimiter, null, "") ?? "");
    const skipEmpty = FormulaHelpers.accept(ignoreEmpty, null, true);
    const parts = flatten(args)
      .map((v) => (v == null ? "" : String(v)))
      .filter((v) => (skipEmpty ? v !== "" : true));
    return parts.join(sep);
  },
};

module.exports = { EXTRA_FUNCTIONS, makeCriteria };
