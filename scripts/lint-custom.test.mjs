import { test } from "node:test";
import assert from "node:assert/strict";
import { runSource } from "./lint-custom.mjs";

function unresolvedFindings(source) {
    return runSource(source).filter((f) => f.ruleId === "alpine-unresolved-identifier");
}

test("x-for loop variables resolve inside their template", () => {
    const source = `<div x-data="{ races: ['Dwarf', 'Elf'] }">
  <select>
    <template x-for="r in races" :key="r"><option :value="r" x-text="r"></option></template>
  </select>
</div>`;
    assert.deepEqual(unresolvedFindings(source), []);
});

test("Alpine.data component name and keys resolve", () => {
    const source = `<div x-data="characterState">
  <span x-text="character.race"></span>
  <span x-show="availableSubraces().length > 0"></span>
</div>
<script>
document.addEventListener('alpine:init', () => {
  Alpine.data('characterState', () => ({
    character: { race: null },
    availableSubraces() { return []; },
  }));
});
</script>`;
    assert.deepEqual(unresolvedFindings(source), []);
});

test("a genuinely unresolved identifier still flags", () => {
    const source = `<div x-data="{ race: null }">
  <span x-text="chracter.race"></span>
</div>`;
    const findings = unresolvedFindings(source);
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /'chracter'/);
});
