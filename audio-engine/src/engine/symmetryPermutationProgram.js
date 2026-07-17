const MAX_COMPILED_ROWS = 256;
const MAX_SEQUENCE_STEPS = 64;
const MAX_PERIODIC_RULES = 8;
const MAX_PERIOD = 64;
const MAX_PLACE_NOTATION_LENGTH = 128;

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(`Invalid symmetry permutation program: ${message}`);
  }
};

const assertNnotes = (nnotes) => {
  assert(Number.isInteger(nnotes) && nnotes >= 2 && nnotes <= 64, 'invalid nnotes');
};

const identityRow = (nnotes) => Array.from({ length: nnotes }, (_, index) => index);

const normalizeSeed = (seed) => {
  if (seed === undefined || seed === null) return 1;
  assert(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'seed must be uint32');
  return seed || 1;
};

const createSeededRandom = (seed) => {
  let state = normalizeSeed(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const validateRow = (row, nnotes) => {
  assert(Array.isArray(row), 'row must be an array');
  assert(row.length === nnotes, `row length must equal nnotes (${nnotes})`);
  const seen = new Set();
  row.forEach((value) => {
    assert(Number.isInteger(value), 'row entries must be integers');
    assert(value >= 0 && value < nnotes, `row entry ${value} out of range`);
    assert(!seen.has(value), `row contains duplicate entry ${value}`);
    seen.add(value);
  });
};

const assertRowLimit = (rows) => {
  assert(
    rows.length >= 1 && rows.length <= MAX_COMPILED_ROWS,
    `compiled row count must be 1-${MAX_COMPILED_ROWS}`,
  );
};

const rotateRow = (row, by) => {
  assert(Number.isInteger(by), 'rotate.by must be an integer');
  const length = row.length;
  const offset = ((by % length) + length) % length;
  if (offset === 0) return row.slice();
  return row.slice(length - offset).concat(row.slice(0, length - offset));
};

const seededShuffleRow = (row, seed) => {
  const next = row.slice();
  const random = createSeededRandom(seed);
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
};

const normalizeSwapPair = (pair) => {
  if (Array.isArray(pair) && pair.length === 2) {
    return pair;
  }
  if (isObject(pair)) {
    return [pair.left, pair.right];
  }
  throw new Error('swap pair must have left/right indexes');
};

const applySwapAdjacent = (row, pairs, nnotes) => {
  assert(Array.isArray(pairs) && pairs.length > 0, 'swapAdjacent.pairs required');
  const next = row.slice();
  const touched = new Set();

  pairs.forEach((pair) => {
    const [left, right] = normalizeSwapPair(pair);
    assert(Number.isInteger(left) && Number.isInteger(right), 'swap indexes must be integers');
    assert(left >= 0 && right >= 0 && left < nnotes && right < nnotes, 'swap index out of range');
    assert(Math.abs(left - right) === 1, 'swapAdjacent pairs must be adjacent');
    assert(!touched.has(left) && !touched.has(right), 'swap indexes may not overlap');
    touched.add(left);
    touched.add(right);
    [next[left], next[right]] = [next[right], next[left]];
  });

  return next;
};

const gcd = (a, b) => {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
};

const applyAffine = (row, op, nnotes) => {
  const { a, b = 0 } = op;
  assert(Number.isInteger(a) && Number.isInteger(b), 'affine requires integer a and b');
  assert(gcd(a, nnotes) === 1, 'affine.a must be coprime with nnotes');
  const next = new Array(nnotes);
  for (let index = 0; index < nnotes; index += 1) {
    const target = (((a * index + b) % nnotes) + nnotes) % nnotes;
    next[target] = row[index];
  }
  validateRow(next, nnotes);
  return next;
};

const parsePlaceNotationTokens = (notation) => {
  assert(typeof notation === 'string' && notation.length > 0, 'placeNotation.notation required');
  assert(
    notation.length <= MAX_PLACE_NOTATION_LENGTH,
    `place notation max length is ${MAX_PLACE_NOTATION_LENGTH}`,
  );

  const compact = notation.replace(/\s+/g, '');
  const tokens = [];
  let places = '';

  for (const char of compact) {
    if (char === '.' || char === ',') {
      if (places) {
        tokens.push(places);
        places = '';
      }
      continue;
    }
    if (char === 'x' || char === 'X' || char === '-') {
      if (places) {
        tokens.push(places);
        places = '';
      }
      tokens.push('x');
      continue;
    }
    assert(
      /[1-90eEtT]/.test(char),
      `unsupported place notation character "${char}"`,
    );
    places += char;
  }

  if (places) tokens.push(places);
  assert(tokens.length > 0, 'place notation produced no tokens');
  return tokens;
};

const placeSymbolToNumber = (symbol) => {
  const upper = symbol.toUpperCase();
  if (/[1-9]/.test(upper)) return Number(upper);
  if (upper === '0') return 10;
  if (upper === 'E') return 11;
  if (upper === 'T') return 12;
  throw new Error(`unsupported place notation character "${symbol}"`);
};

const swapsFromFixedPlaces = (fixedPlaces, nnotes) => {
  const swaps = [];
  let index = 0;

  while (index < nnotes) {
    if (fixedPlaces.has(index)) {
      index += 1;
      continue;
    }
    if (index + 1 < nnotes && !fixedPlaces.has(index + 1)) {
      swaps.push([index, index + 1]);
      index += 2;
      continue;
    }
    throw new Error(`unpaired moving place ${index + 1}`);
  }

  return swaps;
};

const rowsFromPlaceNotation = (row, notation, nnotes) => {
  const tokens = parsePlaceNotationTokens(notation);
  let current = row.slice();

  return tokens.map((token) => {
    if (token === 'x') {
      const pairs = [];
      for (let index = 0; index + 1 < nnotes; index += 2) {
        pairs.push([index, index + 1]);
      }
      current = applySwapAdjacent(current, pairs, nnotes);
      return current.slice();
    }

    const fixedPlaces = new Set();
    for (const char of token) {
      const place = placeSymbolToNumber(char);
      assert(place >= 1 && place <= nnotes, `place ${place} out of range`);
      assert(!fixedPlaces.has(place - 1), `duplicate place ${place}`);
      fixedPlaces.add(place - 1);
    }

    current = applySwapAdjacent(
      current,
      swapsFromFixedPlaces(fixedPlaces, nnotes),
      nnotes,
    );
    return current.slice();
  });
};

const applyOperation = (row, operation, nnotes, seed) => {
  assert(isObject(operation), 'operation must be an object');

  switch (operation.op) {
    case 'identity':
      return [row.slice()];
    case 'reverse':
      return [row.slice().reverse()];
    case 'rotate':
      return [rotateRow(row, operation.by ?? 1)];
    case 'swapAdjacent':
      return [applySwapAdjacent(row, operation.pairs, nnotes)];
    case 'affine':
      return [applyAffine(row, operation, nnotes)];
    case 'seededShuffle':
      return [seededShuffleRow(row, operation.seed ?? seed)];
    case 'compose': {
      assert(Array.isArray(operation.ops) && operation.ops.length > 0, 'compose.ops required');
      let current = row.slice();
      operation.ops.forEach((child) => {
        const childRows = applyOperation(current, child, nnotes, seed);
        current = childRows[childRows.length - 1];
      });
      return [current.slice()];
    }
    case 'placeNotation':
      return rowsFromPlaceNotation(row, operation.notation, nnotes);
    default:
      throw new Error(`Invalid symmetry permutation program: unsupported op "${operation.op}"`);
  }
};

const compileSequence = (program, nnotes) => {
  assert(Array.isArray(program.sequence), 'sequence mode requires sequence array');
  assert(
    program.sequence.length >= 1 && program.sequence.length <= MAX_SEQUENCE_STEPS,
    `sequence length must be 1-${MAX_SEQUENCE_STEPS}`,
  );

  const rows = [];
  let current = identityRow(nnotes);
  program.sequence.forEach((operation) => {
    const operationRows = applyOperation(current, operation, nnotes, program.seed);
    operationRows.forEach((row) => {
      validateRow(row, nnotes);
      rows.push(row);
    });
    current = rows[rows.length - 1].slice();
  });

  assertRowLimit(rows);
  return rows;
};

const compilePeriodicRules = (program, nnotes) => {
  assert(Array.isArray(program.rules), 'periodicRules mode requires rules array');
  assert(
    program.rules.length >= 1 && program.rules.length <= MAX_PERIODIC_RULES,
    `rules length must be 1-${MAX_PERIODIC_RULES}`,
  );
  assert(Number.isInteger(program.cycleCount), 'periodicRules.cycleCount required');
  assert(
    program.cycleCount >= 1 && program.cycleCount <= MAX_COMPILED_ROWS,
    `cycleCount must be 1-${MAX_COMPILED_ROWS}`,
  );

  program.rules.forEach((rule) => {
    assert(isObject(rule), 'periodic rule must be an object');
    assert(
      Number.isInteger(rule.every) && rule.every >= 1 && rule.every <= MAX_PERIOD,
      `rule.every must be 1-${MAX_PERIOD}`,
    );
    assert(isObject(rule.op), 'rule.op required');
  });

  const rows = [];
  let current = identityRow(nnotes);
  for (let cycle = 1; cycle <= program.cycleCount; cycle += 1) {
    program.rules.forEach((rule) => {
      if (cycle % rule.every !== 0) return;
      const operationRows = applyOperation(current, rule.op, nnotes, program.seed);
      current = operationRows[operationRows.length - 1].slice();
    });
    validateRow(current, nnotes);
    rows.push(current.slice());
  }

  assertRowLimit(rows);
  return rows;
};

const plainHuntOperationForStep = (step, nnotes) => {
  const pairs = [];
  const start = step % 2 === 0 ? 0 : 1;
  for (let index = start; index + 1 < nnotes; index += 2) {
    pairs.push([index, index + 1]);
  }
  return { op: 'swapAdjacent', pairs };
};

const compileMethod = (program, nnotes) => {
  const method = program.method || 'plainHunt';
  const leads = program.leads ?? 1;
  assert(Number.isInteger(leads) && leads >= 1 && leads <= 16, 'method.leads must be 1-16');

  if (method === 'plainHunt') {
    const rows = [identityRow(nnotes)];
    let current = rows[0];
    const steps = Math.min(MAX_COMPILED_ROWS - 1, leads * 2 * (nnotes - 1));
    for (let step = 0; step < steps; step += 1) {
      [current] = applyOperation(current, plainHuntOperationForStep(step, nnotes), nnotes);
      rows.push(current);
    }
    assertRowLimit(rows);
    return rows;
  }

  if (method === 'alternatingPlaces') {
    const outerPairs = plainHuntOperationForStep(0, nnotes).pairs;
    const innerPairs = plainHuntOperationForStep(1, nnotes).pairs;
    return compileSequence(
      {
        ...program,
        sequence: [
          { op: 'identity' },
          outerPairs.length
            ? { op: 'swapAdjacent', pairs: outerPairs }
            : { op: 'identity' },
          innerPairs.length
            ? { op: 'swapAdjacent', pairs: innerPairs }
            : { op: 'identity' },
          { op: 'reverse' },
        ],
      },
      nnotes,
    );
  }

  throw new Error(`Invalid symmetry permutation program: unsupported method "${method}"`);
};

const defaultGeneratorSteps = (family, nnotes) => {
  switch (family) {
    case 'cyclic':
      return [{ op: 'rotate', by: 1 }];
    case 'dihedral':
      return [{ op: 'rotate', by: 1 }, { op: 'reverse' }];
    case 'affine':
      return [{ op: 'affine', a: nnotes % 2 === 0 ? nnotes - 1 : 2, b: 1 }];
    case 'adjacentTransposition':
    case 'grayWalk':
      return Array.from({ length: nnotes - 1 }, (_, index) => ({
        op: 'swapAdjacent',
        pairs: [[index, index + 1]],
      }));
    default:
      throw new Error(`Invalid symmetry permutation program: unsupported family "${family}"`);
  }
};

const compileGeneratorWalk = (program, nnotes) => {
  const family = program.family || 'cyclic';
  const cycleCount = program.cycleCount ?? Math.min(16, MAX_COMPILED_ROWS);
  assert(
    Number.isInteger(cycleCount) && cycleCount >= 1 && cycleCount <= MAX_COMPILED_ROWS,
    `generatorWalk.cycleCount must be 1-${MAX_COMPILED_ROWS}`,
  );
  const steps = program.steps || defaultGeneratorSteps(family, nnotes);
  assert(Array.isArray(steps) && steps.length >= 1 && steps.length <= MAX_SEQUENCE_STEPS, 'generatorWalk steps length invalid');

  const rows = [];
  let current = identityRow(nnotes);
  for (let cycle = 0; cycle < cycleCount; cycle += 1) {
    const step = steps[cycle % steps.length];
    const operation = step.generator
      ? {
          op: step.generator === 'reflect' ? 'reverse' : step.generator,
          by: step.by,
          a: step.a,
          b: step.b,
          pairs: step.pairs,
          seed: step.seed,
          ops: step.ops,
        }
      : step;
    const operationRows = applyOperation(current, operation, nnotes, program.seed);
    current = operationRows[operationRows.length - 1].slice();
    validateRow(current, nnotes);
    rows.push(current.slice());
  }

  assertRowLimit(rows);
  return rows;
};

export function compileSymmetryPermutationProgram(program, nnotes) {
  if (program === undefined || program === null) return null;
  assertNnotes(nnotes);
  assert(isObject(program), 'program must be an object');
  assert(program.version === undefined || program.version === 1, 'unsupported version');
  normalizeSeed(program.seed);

  let rows;
  switch (program.mode) {
    case 'sequence':
      rows = compileSequence(program, nnotes);
      break;
    case 'periodicRules':
      rows = compilePeriodicRules(program, nnotes);
      break;
    case 'method':
      rows = compileMethod(program, nnotes);
      break;
    case 'generatorWalk':
      rows = compileGeneratorWalk(program, nnotes);
      break;
    default:
      throw new Error(`Invalid symmetry permutation program: unsupported mode "${program.mode}"`);
  }

  rows.forEach((row) => validateRow(row, nnotes));
  return rows;
}
