import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const rawRoot = path.join(root, "data", "raw");
const dbRoot = path.join(root, "public", "plan-db");
const index = JSON.parse(await readFile(path.join(dbRoot, "index.json"), "utf8"));
const errors = [];
const warnings = [];
const ids = new Set();
const totals = { plans: index.plans.length, courseRows: 0, byGrade: {}, byDepartment: {}, byStudyType: {}, byGradeDepartment: {} };

const increment = (target, key) => { target[key] = (target[key] || 0) + 1; };
const normalize = (value) => String(value ?? "").trim();

if (index.count !== index.plans.length) errors.push(`index count mismatch: ${index.count} vs ${index.plans.length}`);

const officialIds = new Map();
for (const grade of ["2025", "2024", "2023"]) {
  const listPath = path.join(rawRoot, `plans-list-${grade}.json`);
  const list = JSON.parse(await readFile(listPath, "utf8"));
  if (list.totalSize !== list.rows.length) errors.push(`${grade}: official list reports ${list.totalSize}, received ${list.rows.length}`);
  const rawFiles = (await readdir(path.join(rawRoot, "plans", grade))).filter((file) => file.endsWith(".json"));
  if (rawFiles.length !== list.rows.length) errors.push(`${grade}: raw file count ${rawFiles.length}, official count ${list.rows.length}`);
  const rowIds = new Set();
  for (const row of list.rows) {
    const id = row.PYFADM;
    if (!id) { errors.push(`${grade}: official row without PYFADM`); continue; }
    if (rowIds.has(id)) errors.push(`${grade}: duplicate PYFADM in official list: ${id}`);
    rowIds.add(id);
    if (officialIds.has(id)) errors.push(`${grade}: PYFADM also appears in ${officialIds.get(id).grade}: ${id}`);
    officialIds.set(id, { grade, row });
    try {
      const raw = JSON.parse(await readFile(path.join(rawRoot, "plans", grade, `${id}.json`), "utf8"));
      const metadata = raw.metadata?.[0];
      if (!metadata) errors.push(`${id}: missing raw metadata`);
      else {
        if (normalize(metadata.NJDM) !== grade) errors.push(`${id}: raw grade ${metadata.NJDM} does not match ${grade}`);
        if (normalize(metadata.PYFAMC) !== normalize(row.PYFAMC)) errors.push(`${id}: metadata/list plan name mismatch`);
      }
      if (raw.wid !== id) errors.push(`${id}: raw wid mismatch`);
      if (!Array.isArray(raw.groups) || !raw.groups.length) errors.push(`${id}: raw groups missing`);
      if (!Array.isArray(raw.courses) || !raw.courses.length) errors.push(`${id}: raw courses missing`);
    } catch (error) {
      errors.push(`${id}: raw file unreadable (${error.message})`);
    }
  }
  for (const file of rawFiles) {
    const id = path.basename(file, ".json");
    if (!rowIds.has(id)) errors.push(`${grade}: extra raw file not in official list: ${file}`);
  }
}

for (const entry of index.plans) {
  if (ids.has(entry.id)) errors.push(`duplicate source id in index: ${entry.id}`);
  ids.add(entry.id);
  const official = officialIds.get(entry.id);
  if (!official) errors.push(`${entry.id}: generated plan not found in official lists`);
  const db = JSON.parse(await readFile(path.join(dbRoot, entry.file), "utf8"));
  if (db.sourceId !== entry.id) errors.push(`${entry.id}: generated source id mismatch`);
  if (db.major !== entry.name) errors.push(`${entry.id}: generated/index name mismatch`);
  if (db.grade !== entry.grade) errors.push(`${entry.id}: generated/index grade mismatch`);
  if (official && db.grade !== official.grade) errors.push(`${entry.id}: generated grade ${db.grade} does not match official ${official.grade}`);
  if (official && normalize(db.major) !== normalize(official.row.PYFAMC)) errors.push(`${entry.id}: generated/official plan name mismatch`);
  if (!Array.isArray(db.cats) || !db.cats.length) errors.push(`${entry.name}: no categories`);
  if (!Array.isArray(db.courses) || !db.courses.length) errors.push(`${entry.name}: no courses`);
  if (!Array.isArray(db.req) || !db.req.length) errors.push(`${entry.name}: no requirements`);
  if (db.courses.length <= 3) warnings.push({ id: entry.id, grade: entry.grade, name: entry.name, department: entry.department, studyType: entry.studyType, courses: db.courses.length });
  for (const course of db.courses || []) {
    if (!Number.isInteger(course[0]) || !db.cats[course[0]]) errors.push(`${entry.id}: invalid course category index`);
    if (!course[2]) errors.push(`${entry.id}: course without name`);
  }
  for (const module of db.req || []) for (const sub of module.subs || []) for (const cat of sub.cats || []) {
    if (!Number.isInteger(cat) || !db.cats[cat]) errors.push(`${entry.id}: requirement references invalid category index`);
  }
  totals.courseRows += db.courses.length;
  increment(totals.byGrade, entry.grade);
  increment(totals.byDepartment, entry.department || "未知学院");
  increment(totals.byStudyType, entry.studyType || "未知类型");
  totals.byGradeDepartment[entry.grade] ||= {};
  increment(totals.byGradeDepartment[entry.grade], entry.department || "未知学院");
}

for (const id of officialIds.keys()) if (!ids.has(id)) errors.push(`${id}: official plan missing from generated index`);
if (officialIds.size !== index.count) errors.push(`official/generated total mismatch: ${officialIds.size} vs ${index.count}`);
if (JSON.stringify(index.counts?.byGrade || {}) !== JSON.stringify(totals.byGrade)) errors.push("index by-grade counts do not match generated plans");

const report = { validatedAt: new Date().toISOString(), status: errors.length ? "failed" : "passed", expectedPlans: officialIds.size, generatedPlans: index.count, totals, suspiciousLowCoursePlans: warnings, errors };
const reportDir = path.join(root, "data", "validation");
await mkdir(reportDir, { recursive: true });
await writeFile(path.join(reportDir, "plan-db-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (errors.length) {
  console.error(errors.slice(0, 100).join("\n"));
  console.error(`Validation failed with ${errors.length} error(s).`);
  process.exit(1);
}
console.log(`Validated ${index.count} plan databases and ${totals.courseRows} course rows.`);
console.log(`By grade: ${JSON.stringify(totals.byGrade)}`);
console.log(`Suspicious low-course plans (warning only): ${warnings.length}`);
console.log(`Report: ${path.join(reportDir, "plan-db-report.json")}`);
