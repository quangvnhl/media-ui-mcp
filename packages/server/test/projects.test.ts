import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { mergeProjects, projectsFromCards } from "../../extension/src/content/projects.ts";
import type { ProjectInfo } from "@media-mcp/shared";

const baseUrl = "https://flow.google.com/u/1/";

function read(html: string): ProjectInfo[] {
  const { document } = parseHTML(html);
  return projectsFromCards(document.querySelectorAll(".projects-grid-item"), baseUrl);
}

function card(id: string, title: string): string {
  return `<div class="projects-grid-item">
    <div><a class="project-thumbnail-container" aria-label="Mở dự án" href="/u/1/project/${id}">
      <img alt="hình thu nhỏ của ảnh dự án trong Flow">
    </a></div>
    <div class="project-title-label" style="text-overflow:ellipsis">${title}</div>
    <button>Tùy chọn khác</button>
  </div>`;
}

test("project cards read sibling titles instead of thumbnail alt or open labels", () => {
  const projects = read(card("ckw", "CKW") + card("default", "Tháng 10 30 - 00:26"));
  assert.deepEqual(projects, [
    { projectId: "ckw", name: "CKW", url: `${baseUrl}project/ckw`, accountIndex: 1, updatedAt: null },
    { projectId: "default", name: "Tháng 10 30 - 00:26", url: `${baseUrl}project/default`, accountIndex: 1, updatedAt: null }
  ]);
});

test("project names preserve short, localized, long and control-like user names", () => {
  const names = ["A", "Công việc 🎨", "Mở dự án", "Google Flow – CKW", "Dự án dài ".repeat(30)];
  assert.deepEqual(read(names.map((name, i) => card(String(i), name)).join("")).map((p) => p.name), names.map((name) => name.trim()));
});

test("title extraction excludes nested edit icons without modifying real edit names or live DOM", () => {
  const { document } = parseHTML(
    card("ckw", 'CKW <mat-icon>edit</mat-icon>')
    + card("default", 'Tháng 10 30 - 00:26 <span class="material-symbols-outlined">edit</span>')
    + card("custom", 'My edit <button aria-label="Rename">edit</button>')
    + card("literal", "edit")
  );
  const before = document.toString();
  const projects = projectsFromCards(document.querySelectorAll(".projects-grid-item"), baseUrl);
  assert.deepEqual(projects.map((p) => p.name), ["CKW", "Tháng 10 30 - 00:26", "My edit", "edit"]);
  assert.equal(document.toString(), before);
});

test("project title buttons omit Material edit icons but retain the project name", () => {
  const html = `<div class="projects-grid-item">
    <a class="project-thumbnail-container" href="/u/1/project/ckw" aria-label="Mở dự án"></a>
    <button class="project-title-label"><span>CKW</span> <span class="google-symbols">edit</span></button>
  </div>` + card("nested", 'My edit <button><span class="google-symbols">edit</span></button>')
    + card("material", 'Tháng 10 30 - 00:26 <i class="material-icons-round">edit</i>');
  assert.deepEqual(read(html).map((project) => project.name), ["CKW", "My edit", "Tháng 10 30 - 00:26"]);
});

test("titles remain attached to their own card and equal names retain separate ids", () => {
  const projects = read(card("one", "CKW") + card("two", "CKW") + card("three", "Fish 2.5D"));
  assert.deepEqual(projects.map((p) => [p.projectId, p.name]), [["one", "CKW"], ["two", "CKW"], ["three", "Fish 2.5D"]]);
});

test("missing titles never fall back to another card or thumbnail descriptions", () => {
  const html = card("missing", "").replace('<div class="project-title-label" style="text-overflow:ellipsis"></div>', "");
  assert.deepEqual(read(html + card("next", "CKW")).map((p) => p.name), [null, "CKW"]);
});

test("duplicate cards prefer a readable title and preserve first-seen order", () => {
  const projects = read(card("one", "") + card("two", "Second") + card("one", "CKW") + card("one", ""));
  assert.deepEqual(projects.map((p) => [p.projectId, p.name]), [["one", "CKW"], ["two", "Second"]]);
});

test("project parser rejects unrelated links, foreign origins and other accounts", () => {
  const html = card("valid", "Valid")
    + card("foreign", "Foreign").replace('/u/1/project/foreign', 'https://example.com/u/1/project/foreign')
    + card("other", "Other").replace('/u/1/project/other', '/u/2/project/other')
    + card("home", "Home").replace('/u/1/project/home', '/u/1/')
    + '<div class="projects-grid-item"><a href="/u/1/project/unrelated">Unrelated</a><span class="project-title-label">Wrong</span></div>'
    + '<div class="projects-grid-item"><span class="project-title-label">No link</span></div>';
  assert.deepEqual(read(html).map((p) => p.projectId), ["valid"]);
});

test("rendered title updates replace missing names without losing virtualized cards", () => {
  const collected = new Map<string, ProjectInfo>();
  mergeProjects(collected, read(card("first", "") + card("second", "Tháng 10 30 - 00:26")));
  mergeProjects(collected, read(card("first", "CKW")));
  mergeProjects(collected, read(card("first", "") + card("third", "New")));
  assert.deepEqual([...collected.values()].map((p) => [p.projectId, p.name]), [
    ["first", "CKW"], ["second", "Tháng 10 30 - 00:26"], ["third", "New"]
  ]);
});
