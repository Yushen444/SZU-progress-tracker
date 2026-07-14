import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const html = await readFile(path.join(root, "site", "index.html"), "utf8");
const inlineScript = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .filter(Boolean)
  .join("\n");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name} in site/index.html`);
  const open = html.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = open; index < html.length; index++) {
    const char = html[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") { quote = char; continue; }
    if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

new Function(inlineScript);

for (const marker of [
  'id="welcomeHero"',
  'id="btnStartCloud"',
  'id="btnStartLocal"',
  'class="site-footer"',
  ".welcome-hero[hidden]{display:none!important}",
  ".stat.hero.pending-stat",
  "明快效率型本地设计版"
]) assert.ok(html.includes(marker), `missing design marker: ${marker}`);

assert.ok(
  html.indexOf('id="welcomeHero"') < html.indexOf('id="statCards"'),
  "first-use import guide must appear before progress content"
);
assert.ok(
  html.includes("document.getElementById('welcomeHero').hidden=!firstUse"),
  "import guide is not tied to first-use state"
);
assert.ok(
  html.includes("document.getElementById('btnStartCloud').addEventListener('click',e=>openCloudPlanPicker(e.currentTarget))"),
  "primary onboarding action is not connected to cloud import"
);
assert.ok(
  html.includes("document.getElementById('btnStartLocal').addEventListener('click',()=>document.getElementById('btnLocalPlan').click())"),
  "secondary onboarding action is not connected to local import"
);
assert.ok(
  html.includes("(overall==null?' pending-stat':'')"),
  "empty GPA state is not visually distinguished"
);
assert.ok(html.includes("@media(max-width:600px)"), "mobile layout breakpoint missing");
assert.ok(html.includes("prefers-reduced-motion:reduce"), "reduced-motion support missing");
assert.ok(
  html.includes(".view.active{display:block}") &&
  !/\.view\.active\s*\{[^}]*animation/i.test(html) &&
  html.includes('class="tab-indicator" aria-hidden="true"') &&
  html.includes("function positionTabIndicator(") &&
  html.includes("function animatePanelTransition(") &&
  html.includes("prefersReducedMotion()"),
  "controlled smooth tab motion or reduced-motion fallback is incomplete"
);
assert.ok(!html.includes("transition:all"), "broad transition:all remains in the page");
assert.ok(
  html.includes('aria-controls="view-dash"') &&
  html.includes('role="tabpanel"') &&
  html.includes("tabs.addEventListener('keydown'"),
  "accessible keyboard tab behavior is incomplete"
);
assert.ok(
  html.includes('aria-expanded="false"') &&
  html.includes("function closeImportMenu("),
  "import menu expanded state or Escape behavior is missing"
);
assert.ok(
  html.includes("function openModal(") &&
  html.includes("function closeModal(") &&
  html.includes("modalFocusables(") &&
  html.includes("modalCloseTimers") &&
  html.includes("classList.add('closing')"),
  "shared modal focus management is missing"
);
assert.ok(
  html.includes("function animateListRefresh(") &&
  html.includes("element.children.length>200") &&
  html.includes("function animateCourseAdded("),
  "restrained list or course feedback is missing"
);
assert.ok(
  html.includes('class="table-scroll"') &&
  html.includes("grid-template-columns:repeat(2,minmax(0,1fr))"),
  "table scrolling or two-column mobile tabs are missing"
);
assert.ok(
  html.includes("semNum=Number(sem)") &&
  html.includes("sem:semNum"),
  "course semester values are not normalized to numbers"
);
assert.ok(
  html.includes('aria-busy="false"') &&
  html.includes("setCloudFilterDisabled("),
  "cloud list busy feedback is missing"
);

const interactionContext = vm.createContext({
  Number,
  DB: { cats: ["测试类别"], courses: [[0, "TEST-001", "测试课程", "", 2]] },
  state: { sel: [] },
  uidSeq: 1,
  toast: () => {},
  mutate: () => {}
});
vm.runInContext(`${extractFunction("addCourse")}; this.addCourse = addCourse;`, interactionContext);
for (const semester of ["1", "4", "8"]) interactionContext.addCourse(0, semester);
assert.deepEqual(
  JSON.parse(JSON.stringify(interactionContext.state.sel.map((course) => course.sem))),
  [1, 4, 8],
  "string semester values were not stored as numeric semesters"
);
interactionContext.addCourse(0, "4");
interactionContext.addCourse(0, "9");
assert.equal(interactionContext.state.sel.length, 3, "duplicate or invalid semesters were not rejected");

await access(path.join(root, "backups", "web-design-taste-20260714-161559", "index.html"));
await access(path.join(root, "backups", "web-design-taste-20260714-161559", "ROLLBACK.md"));

console.log("Local design regression test: OK");
