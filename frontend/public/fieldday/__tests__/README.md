# Field Day — engine tests

Unit tests for the pure scoring engine. No DOM, no network, no test framework
dependencies — just Node 18+'s built-in test runner.

## Run

```bash
node --test frontend/public/fieldday/__tests__/engine.test.js
```

Or from this folder:

```bash
node --test engine.test.js
```

## What's covered (47 tests)

- `bestOf` — min for timed, max for distance/weight, null handling
- `compareResults` — timed/distance ordering, null sorting
- `computePlacements` — basic, distance, best-of-N
- Tie modes — average and higher, 2-way and 3-way ties at 1st and 2nd
- Completion / participation points (only awarded on completed events)
- Score-by-age-band partitioning (grade-grouped events)
- `parseBand` / `ageInBand` / `bandForAge` / `divisionForAge`
- `computeAge` — DOB + cutoff edge cases (boundary, future DOB, invalid input)
- `tierForResult` — gold/silver/bronze/null for timed and distance
- `isNewRecord` — first record always wins; ties don't break records
- `didBeatPB` — PB matching by name (case-insensitive) + title
- `ordinal` — typical, teen exceptions, 21st/22nd/23rd
- `fmtTimer` — hundredths precision and dashes for null

## CI integration

Add to `.github/workflows/ci.yml` (or your existing CI config):

```yaml
- name: Run Field Day engine tests
  run: node --test frontend/public/fieldday/__tests__/engine.test.js
```

## Adding tests

Each `test(...)` block is independent. Use `node:assert/strict` (already
imported) for assertions. Keep tests focused on one behaviour each — when
something fails, the test name should make the regression obvious.
