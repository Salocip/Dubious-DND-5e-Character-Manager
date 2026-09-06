# Gates: full class + subclass features with text

OWNS: main.html, tests/ability-budget.spec.js

Scope: selecting a class + subclass + level shows that class's and the chosen
subclass's PHB features with descriptions (the 5etools rendering equivalent),
for every class and subclass in the app

- [ ] G1: barbarian + Berserker at level 3 shows class features AND subclass
      features (Frenzy) with description text, interleaved in level order
  CHECK: npx playwright test tests/ability-budget.spec.js -g "subclass features"
  EXPECT: 1 passed
  EVIDENCE: pending

- [ ] G2: features render with descriptions for every class/subclass source
      (fixture-driven: class + subclass feature text appears)
  CHECK: npx playwright test tests/ability-budget.spec.js -g "feature description"
  EXPECT: 1 passed
  EVIDENCE: pending

- [ ] G3: full suite has not regressed (ASI/budget/feats/background)
  CHECK: npx playwright test
  EXPECT: 0 failed
  EVIDENCE: pending

- [ ] G4: this ledger states outcomes that can fail
  CHECK: node /home/tom/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: pending