import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const html = await readFile(path.join(root, "site", "index.html"), "utf8");

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

const functionNames = [
  "resultOf",
  "normalizedCourseName",
  "dbCourseKeys",
  "selectedCourseKeys",
  "buildAddonProgress",
  "addonCategoryStats",
  "cappedProgress",
  "addonRequirementTotals",
  "mergeSupplementData"
];

const context = vm.createContext({
  console,
  JSON,
  Number,
  Math,
  Set,
  Map,
  GPA: { "A+": 4.5, A: 4, "B+": 3.5, B: 3, "C+": 2.5, C: 2, D: 1, F: 0 },
  gradeFromScore: () => null,
  fmt: (value) => (Math.round(value * 100) / 100).toString(),
  state: { sel: [] }
});
vm.runInContext(functionNames.map(extractFunction).join("\n"), context);

const mainRequirements = [{ mod: "主修模块", min: 157.5, subs: [{ name: "主修课程", min: 157.5, cats: [0], note: "" }] }];
const main = {
  major: "主修方案",
  totalMin: 157.5,
  cats: ["主修课程"],
  courses: [[0, "A", "主辅共享课", "", 3]],
  req: structuredClone(mainRequirements),
  rules: [],
  addons: []
};
const minor = {
  sourceId: "0123456789abcdef0123456789abcdef",
  major: "2025级测试专业辅修培养方案",
  studyType: "辅修",
  department: "测试学院",
  totalMin: 5,
  cats: ["辅修基础", "辅修核心"],
  courses: [
    [0, "A", "主辅共享课", "", 3],
    [1, "B", "辅修独立课", "", 2]
  ],
  req: [{ mod: "辅修模块", min: 5, subs: [
    { name: "辅修基础", min: 3, cats: [0], note: "" },
    { name: "辅修核心", min: 2, cats: [1], note: "" }
  ] }],
  rules: []
};

const mergeResult = context.mergeSupplementData(main, minor);
assert.deepEqual(JSON.parse(JSON.stringify(mergeResult)), { added: 1, skipped: 1 });
assert.equal(main.totalMin, 157.5, "minor import changed main total credits");
assert.deepEqual(main.req, mainRequirements, "minor import changed main requirements");
assert.equal(main.addons[0].progress.totalMin, 5);
assert.equal(main.addons[0].progress.courseCount, 2);

context.state.sel = [
  { code: "A", name: "主辅共享课", credits: 3, mode: "g", grade: "A", catName: "主修课程" },
  { code: "B", name: "辅修独立课", credits: 2, mode: "g", grade: null, catName: main.cats[1] }
];
let totals = context.addonRequirementTotals(main.addons[0].progress);
assert.deepEqual(JSON.parse(JSON.stringify(totals)), { earned: 3, doing: 2 }, "shared/main course was not counted independently for minor progress");

context.state.sel[1].grade = "A";
context.state.sel.push({ code: "B", name: "辅修独立课", credits: 2, mode: "g", grade: null, catName: main.cats[1] });
totals = context.addonRequirementTotals(main.addons[0].progress);
assert.deepEqual(JSON.parse(JSON.stringify(totals)), { earned: 5, doing: 0 }, "duplicate enrollment was counted twice");

console.log("Addon progress regression test: OK");
