import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const rawDir = path.join(root, "data", "raw", "plans");
const outputDir = path.join(root, "public", "plan-db");
const planDir = path.join(outputDir, "plans");
const siteOutputDir = path.join(root, "site", "plan-db");

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const comparePosition = (a, b) => number(a.PX, Number.MAX_SAFE_INTEGER) - number(b.PX, Number.MAX_SAFE_INTEGER);

function termFromCourse(course) {
  const values = String(course.XNXQ || "").split(",").filter(Boolean);
  const hasFall = values.some((value) => value.endsWith("-1"));
  const hasSpring = values.some((value) => value.endsWith("-2"));
  if (hasFall && hasSpring) return "春秋";
  if (hasFall) return "秋";
  if (hasSpring) return "春";
  return "";
}

function descendants(groupId, childrenByParent, leafIds) {
  const result = [];
  const visit = (id) => {
    if (leafIds.has(id)) result.push(id);
    for (const child of childrenByParent.get(id) || []) visit(child.KZH);
  };
  visit(groupId);
  return [...new Set(result)];
}

export function transformPlan(raw) {
  const metadata = raw.metadata?.[0];
  if (!metadata) throw new Error(`${raw.wid}: missing metadata`);

  const groups = [...(raw.groups || [])].sort(comparePosition);
  const sourceCourses = [...(raw.courses || [])].sort(comparePosition);
  const groupsById = new Map(groups.map((group) => [group.KZH, group]));
  const childrenByParent = new Map();
  for (const group of groups) {
    const parent = group.FKZH || "-1";
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(group);
  }
  for (const children of childrenByParent.values()) children.sort(comparePosition);

  const courseGroupIds = new Set(sourceCourses.map((course) => course.KZH).filter(Boolean));
  const leafGroups = groups.filter((group) => group.KZLXDM === "01" || courseGroupIds.has(group.KZH));
  const leafIds = new Set(leafGroups.map((group) => group.KZH));
  for (const groupId of courseGroupIds) {
    if (!groupsById.has(groupId)) {
      const fallback = { KZH: groupId, KZM: "未归类课程", FKZH: "-1", KZLXDM: "01", ZSXDXF: 0 };
      groupsById.set(groupId, fallback);
      leafGroups.push(fallback);
      leafIds.add(groupId);
    }
  }

  const cats = leafGroups.map((group) => group.KZM || "未命名课程组");
  const catIndex = new Map(leafGroups.map((group, index) => [group.KZH, index]));
  const courses = sourceCourses.map((course) => [
    catIndex.get(course.KZH),
    course.KCH || course.TYKCBS || "",
    course.KCM || "",
    "",
    number(course.XF),
    course.XS == null ? "" : String(number(course.XS)),
    String(course.XDXQ || "").replaceAll("，", ","),
    termFromCourse(course)
  ]).filter((course) => Number.isInteger(course[0]) && course[2]);

  const topGroups = childrenByParent.get("-1") || [];
  const req = topGroups.map((module) => {
    const directChildren = childrenByParent.get(module.KZH) || [];
    const requirementGroups = directChildren.length ? directChildren : [module];
    const subs = requirementGroups.map((sub) => ({
      name: sub.KZM || "未命名课程组",
      min: number(sub.ZSXDXF),
      cats: descendants(sub.KZH, childrenByParent, leafIds).map((id) => catIndex.get(id)).filter(Number.isInteger),
      note: sub.BZ || sub.XDYQ || ""
    })).filter((sub) => sub.cats.length || sub.min > 0);
    return { mod: module.KZM || "未命名模块", min: number(module.ZSXDXF), subs };
  });

  const covered = new Set(req.flatMap((module) => module.subs.flatMap((sub) => sub.cats)));
  const uncovered = cats.map((_, index) => index).filter((index) => !covered.has(index));
  if (uncovered.length) req.push({ mod: "其他课程", min: 0, subs: [{ name: "未归类课程", min: 0, cats: uncovered, note: "" }] });

  const rules = [];
  cats.forEach((name, index) => {
    if (name.includes("公共艺术")) rules.push({ type: "credit", cat: index, min: 2, label: name });
    if (name.includes("思想政治理论选择性必修")) rules.push({ type: "count", cat: index, min: 1, label: name });
  });

  return {
    schemaVersion: 2,
    source: "SZU qxfacx detail API",
    sourceId: raw.wid,
    major: metadata.PYFAMC || raw.name,
    grade: String(metadata.NJDM || ""),
    studyType: metadata.XDLXDM_DISPLAY || "",
    department: metadata.DWDM_DISPLAY || "",
    parsedAt: raw.scrapedAt,
    hoursLabel: "总学时",
    cats,
    courses,
    req,
    totalMin: number(metadata.ZSYQXF),
    rules
  };
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(planDir, { recursive: true });
const gradeDirs = (await readdir(rawDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^20\d{2}$/.test(entry.name))
  .map((entry) => entry.name)
  .sort((a, b) => b.localeCompare(a));

const plans = [];
const counts = { byGrade: {}, byDepartment: {}, byStudyType: {}, byGradeDepartment: {} };
for (const grade of gradeDirs) {
  const files = (await readdir(path.join(rawDir, grade))).filter((file) => file.endsWith(".json")).sort();
  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join(rawDir, grade, file), "utf8"));
    const db = transformPlan(raw);
    const outputName = `${raw.wid}.json`;
    await writeFile(path.join(planDir, outputName), `${JSON.stringify(db)}\n`, "utf8");
    plans.push({ id: raw.wid, name: db.major, grade: db.grade, studyType: db.studyType, department: db.department, courses: db.courses.length, credits: db.totalMin, file: `plans/${outputName}` });
    increment(counts.byGrade, db.grade);
    increment(counts.byDepartment, db.department || "未知学院");
    increment(counts.byStudyType, db.studyType || "未知类型");
    counts.byGradeDepartment[db.grade] ||= {};
    increment(counts.byGradeDepartment[db.grade], db.department || "未知学院");
  }
}

plans.sort((a, b) => b.grade.localeCompare(a.grade) || a.department.localeCompare(b.department, "zh-CN") || a.name.localeCompare(b.name, "zh-CN"));
const optionList = (values, countsByValue) => [...new Set(values)].sort((a, b) => a.localeCompare(b, "zh-CN")).map((value) => ({ value, count: countsByValue[value] || 0 }));
const index = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  count: plans.length,
  grades: optionList(plans.map((plan) => plan.grade), counts.byGrade).sort((a, b) => b.value.localeCompare(a.value)),
  departments: optionList(plans.map((plan) => plan.department || "未知学院"), counts.byDepartment),
  studyTypes: optionList(plans.map((plan) => plan.studyType || "未知类型"), counts.byStudyType),
  counts,
  plans
};
await writeFile(path.join(outputDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");

await rm(siteOutputDir, { recursive: true, force: true });
await cp(outputDir, siteOutputDir, { recursive: true });
console.log(`Built ${plans.length} plan databases for grades ${gradeDirs.join(", ")} in ${outputDir} and site/plan-db`);
