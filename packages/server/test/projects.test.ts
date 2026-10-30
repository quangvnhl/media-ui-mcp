import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { mergeProjects, projectsFromCards } from "../../extension/src/content/projects.ts";
import type { ProjectInfo } from "@media-mcp/shared";

const baseUrl = "https://flow.google.com/u/0/";

function read(html: string): ProjectInfo[] {
  const { document } = parseHTML(html);
  return projectsFromCards(document.querySelectorAll(".projects-grid-item"), baseUrl);
}

function card(id: string, title: string): string {
  return `<div class="projects-grid-item">
    <div><a class="project-thumbnail-container" aria-label="Mở dự án" href="/u/0/project/${id}">
      <img alt="hình thu nhỏ của ảnh dự án trong Flow">
    </a></div>
    <div class="project-title-label" style="text-overflow:ellipsis">${title}</div>
    <button>Tùy chọn khác</button>
  </div>`;
}

test("project cards read sibling titles instead of thumbnail alt or open labels", () => {
  const projects = read(card("demo-project", "Demo Project") + card("default", "Tháng 1 02 - 03:04"));
  assert.deepEqual(projects, [
    { projectId: "demo-project", name: "Demo Project", url: `${baseUrl}project/demo-project`, accountIndex: 0, updatedAt: null },
    { projectId: "default", name: "Tháng 1 02 - 03:04", url: `${baseUrl}project/default`, accountIndex: 0, updatedAt: null }
  ]);
});

test("project names preserve short, localized, long and control-like user names", () => {
  const names = ["A", "Công việc 🎨", "Mở dự án", "Google Flow – Demo Project", "Dự án dài ".repeat(30)];
  assert.deepEqual(read(names.map((name, i) => card(String(i), name)).join("")).map((p) => p.name), names.map((name) => name.trim()));
});

test("title extraction excludes nested edit icons without modifying real edit names or live DOM", () => {
  const { document } = parseHTML(
    card("demo-project", 'Demo Project <mat-icon>edit</mat-icon>')
    + card("default", 'Tháng 1 02 - 03:04 <span class="material-symbols-outlined">edit</span>')
    + card("custom", 'My edit <button aria-label="Rename">edit</button>')
    + card("literal", "edit")
  );
  const before = document.toString();
  const projects = projectsFromCards(document.querySelectorAll(".projects-grid-item"), baseUrl);
  assert.deepEqual(projects.map((p) => p.name), ["Demo Project", "Tháng 1 02 - 03:04", "My edit", "edit"]);
  assert.equal(document.toString(), before);
});

test("project title buttons omit Material edit icons but retain the project name", () => {
  const html = `<div class="projects-grid-item">
    <a class="project-thumbnail-container" href="/u/0/project/demo-project" aria-label="Mở dự án"></a>
    <button class="project-title-label"><span>Demo Project</span> <span class="google-symbols">edit</span></button>
  </div>` + card("nested", 'My edit <button><span class="google-symbols">edit</span></button>')
    + card("material", 'Tháng 1 02 - 03:04 <i class="material-icons-round">edit</i>');
  assert.deepEqual(read(html).map((project) => project.name), ["Demo Project", "My edit", "Tháng 1 02 - 03:04"]);
});

test("titles remain attached to their own card and equal names retain separate ids", () => {
  const projects = read(card("one", "Demo Project") + card("two", "Demo Project") + card("three", "Example Scene"));
  assert.deepEqual(projects.map((p) => [p.projectId, p.name]), [["one", "Demo Project"], ["two", "Demo Project"], ["three", "Example Scene"]]);
});

test("missing titles never fall back to another card or thumbnail descriptions", () => {
  const html = card("missing", "").replace('<div class="project-title-label" style="text-overflow:ellipsis"></div>', "");
  assert.deepEqual(read(html + card("next", "Demo Project")).map((p) => p.name), [null, "Demo Project"]);
});

test("duplicate cards prefer a readable title and preserve first-seen order", () => {
  const projects = read(card("one", "") + card("two", "Second") + card("one", "Demo Project") + card("one", ""));
  assert.deepEqual(projects.map((p) => [p.projectId, p.name]), [["one", "Demo Project"], ["two", "Second"]]);
});

test("project parser rejects unrelated links, foreign origins and other accounts", () => {
  const html = card("valid", "Valid")
    + card("foreign", "Foreign").replace('/u/0/project/foreign', 'https://example.com/u/0/project/foreign')
    + card("other", "Other").replace('/u/0/project/other', '/u/2/project/other')
    + card("home", "Home").replace('/u/0/project/home', '/u/0/')
    + '<div class="projects-grid-item"><a href="/u/0/project/unrelated">Unrelated</a><span class="project-title-label">Wrong</span></div>'
    + '<div class="projects-grid-item"><span class="project-title-label">No link</span></div>';
  assert.deepEqual(read(html).map((p) => p.projectId), ["valid"]);
});

test("rendered title updates replace missing names without losing virtualized cards", () => {
  const collected = new Map<string, ProjectInfo>();
  mergeProjects(collected, read(card("first", "") + card("second", "Tháng 1 02 - 03:04")));
  mergeProjects(collected, read(card("first", "Demo Project")));
  mergeProjects(collected, read(card("first", "") + card("third", "New")));
  assert.deepEqual([...collected.values()].map((p) => [p.projectId, p.name]), [
    ["first", "Demo Project"], ["second", "Tháng 1 02 - 03:04"], ["third", "New"]
  ]);
});
