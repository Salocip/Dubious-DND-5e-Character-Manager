# Gates: PHB functionality gap audit

Scope: prove docs/phb/audit-gaps.md is grounded (PHB sources exist, app evidence
exists) and complete (the app genuinely lacks the named features)

OWNS: docs/phb/audit-gaps.md, scripts/verify-audit.mjs

- [x] G1: every PHB source section referenced in the report exists in docs/phb/
  CHECK: node scripts/verify-audit.mjs
  EXPECT: audit verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=df5efa88c546e38da92ae3d53b9637913a2acbe0ffad2a8d06ea7912abe55aef; exit=0; EXPECT=matched; output-sha256=6707affa029e2e800691a660cac66760aea9e40e53ef8551a4f03d89dcacf746; output-bytes=1543; shell=/bin/sh; cwd=/home/tom/Projects/dnd char manager; path=fd7ce7cc3620/13 entries

- [x] G2: every app evidence symbol referenced in the report exists in main.html
  CHECK: node scripts/verify-audit.mjs
  EXPECT: audit verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=df5efa88c546e38da92ae3d53b9637913a2acbe0ffad2a8d06ea7912abe55aef; exit=0; EXPECT=matched; output-sha256=6707affa029e2e800691a660cac66760aea9e40e53ef8551a4f03d89dcacf746; output-bytes=1543; shell=/bin/sh; cwd=/home/tom/Projects/dnd char manager; path=fd7ce7cc3620/13 entries

- [x] G3: the report's "Missing" claims hold — the app lacks the named features
  CHECK: node scripts/verify-audit.mjs
  EXPECT: audit verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=df5efa88c546e38da92ae3d53b9637913a2acbe0ffad2a8d06ea7912abe55aef; exit=0; EXPECT=matched; output-sha256=6707affa029e2e800691a660cac66760aea9e40e53ef8551a4f03d89dcacf746; output-bytes=1543; shell=/bin/sh; cwd=/home/tom/Projects/dnd char manager; path=fd7ce7cc3620/13 entries

- [x] G4: this ledger states outcomes that can fail
  CHECK: node /home/tom/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=c8e7d76f6c11a304c8094bfabe9e20c941fba1f39e9285f9ba5be80cf49180b8; exit=0; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8; shell=/bin/sh; cwd=/home/tom/Projects/dnd char manager; path=fd7ce7cc3620/13 entries
