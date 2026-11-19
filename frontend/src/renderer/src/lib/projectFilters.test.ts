import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import {
    DEFAULT_VIEW,
    filterAndSortProjects,
    NO_STATUS,
    NOT_ARCHIVED,
    onlyArchivedHidden,
    parseView,
    ProjectListView,
    projectTypeOptions,
    UNTYPED,
} from "./projectFilters";

const project = (over: Partial<Project> & { id: string }): Project => ({
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    title: over.id,
    description: "",
    type: null,
    status: null,
    show_tasks_in_main_view: true,
    notes_updated_at: null,
    ...over,
});

const ids = (ps: Project[]) => ps.map((p) => p.id);
const view = (over: Partial<ProjectListView> = {}): ProjectListView => ({ ...DEFAULT_VIEW, ...over });

describe("filterAndSortProjects: search", () => {
    const ps = [
        project({ id: "a", title: "Nexus App", description: "" }),
        project({ id: "b", title: "Garden", description: "Plant the NEXT season" }),
        project({ id: "c", title: "Running" }),
    ];

    it("matches title or description, case-insensitively", () => {
        expect(ids(filterAndSortProjects(ps, view(), "nex"))).toEqual(["a", "b"]);
        expect(ids(filterAndSortProjects(ps, view(), "SEASON"))).toEqual(["b"]);
    });

    it("ignores surrounding whitespace and treats blank as no filter", () => {
        expect(ids(filterAndSortProjects(ps, view(), "  running "))).toEqual(["c"]);
        expect(filterAndSortProjects(ps, view(), "   ")).toHaveLength(3);
    });

    it("returns nothing when nothing matches", () => {
        expect(filterAndSortProjects(ps, view(), "zzz")).toEqual([]);
    });
});

describe("filterAndSortProjects: type and status", () => {
    const ps = [
        project({ id: "code", type: "coding", status: "active" }),
        project({ id: "fit", type: "fitness", status: "archived" }),
        project({ id: "none", type: null, status: null }),
        project({ id: "empty", type: "" as unknown as null, status: "paused" }),
    ];

    it("hides archived by default", () => {
        expect(ids(filterAndSortProjects(ps, view(), ""))).not.toContain("fit");
        expect(filterAndSortProjects(ps, view(), "")).toHaveLength(3);
    });

    it("shows everything with status all", () => {
        expect(filterAndSortProjects(ps, view({ status: "all" }), "")).toHaveLength(4);
    });

    it("filters by a single status, including no status", () => {
        expect(ids(filterAndSortProjects(ps, view({ status: "archived" }), ""))).toEqual(["fit"]);
        expect(ids(filterAndSortProjects(ps, view({ status: NO_STATUS }), ""))).toEqual(["none"]);
    });

    it("filters by type, with untyped matching null and empty", () => {
        expect(ids(filterAndSortProjects(ps, view({ type: "coding" }), ""))).toEqual(["code"]);
        expect(ids(filterAndSortProjects(ps, view({ type: UNTYPED, status: "all" }), "")).toSorted()).toEqual([
            "empty",
            "none",
        ]);
    });

    it("treats a blank status like no status", () => {
        const blank = project({ id: "blank", status: "" as unknown as null });
        expect(ids(filterAndSortProjects([blank], view({ status: NO_STATUS }), ""))).toEqual(["blank"]);
    });

    it("keeps a real type named 'untyped' out of the Untyped filter", () => {
        const literal = project({ id: "lit", type: "untyped" as unknown as null });
        expect(filterAndSortProjects([literal], view({ type: UNTYPED }), "")).toEqual([]);
        expect(projectTypeOptions([literal, project({ id: "n" })])).toEqual(["untyped", UNTYPED]);
    });

    it("combines type, status and search", () => {
        expect(filterAndSortProjects(ps, view({ type: "fitness", status: NOT_ARCHIVED }), "")).toEqual([]);
        expect(ids(filterAndSortProjects(ps, view({ type: "fitness", status: "all" }), "fit"))).toEqual(["fit"]);
    });
});

describe("filterAndSortProjects: sort", () => {
    const ps = [
        project({
            id: "b",
            title: "beta",
            created_at: new Date("2026-02-01"),
            updated_at: new Date("2026-03-01"),
        }),
        project({
            id: "a",
            title: "Alpha",
            created_at: new Date("2026-03-01"),
            updated_at: new Date("2026-01-01"),
        }),
        project({
            id: "c",
            title: "project 10",
            created_at: new Date("2026-01-01"),
            updated_at: new Date("2026-02-01"),
        }),
        project({
            id: "d",
            title: "project 9",
            created_at: new Date("2026-01-15"),
            updated_at: new Date("2026-04-01"),
        }),
    ];

    it("defaults to most recently updated first", () => {
        expect(ids(filterAndSortProjects(ps, view(), ""))).toEqual(["d", "b", "c", "a"]);
    });

    it("sorts by name ignoring case, with numbers in numeric order", () => {
        expect(ids(filterAndSortProjects(ps, view({ sort: "name" }), ""))).toEqual(["a", "b", "d", "c"]);
    });

    it("sorts by creation date both ways", () => {
        expect(ids(filterAndSortProjects(ps, view({ sort: "newest" }), ""))).toEqual(["a", "b", "d", "c"]);
        expect(ids(filterAndSortProjects(ps, view({ sort: "oldest" }), ""))).toEqual(["c", "d", "b", "a"]);
    });

    it("doesn't mutate the input", () => {
        const before = ids(ps);
        filterAndSortProjects(ps, view({ sort: "name" }), "");
        expect(ids(ps)).toEqual(before);
    });
});

describe("projectTypeOptions", () => {
    it("lists types in use, sorted, with untyped last", () => {
        const ps = [
            project({ id: "1", type: "learning" }),
            project({ id: "2", type: null }),
            project({ id: "3", type: "coding" }),
            project({ id: "4", type: "coding" }),
        ];
        expect(projectTypeOptions(ps)).toEqual(["coding", "learning", UNTYPED]);
    });

    it("omits untyped when every project has a type", () => {
        expect(projectTypeOptions([project({ id: "1", type: "coding" })])).toEqual(["coding"]);
    });
});

describe("onlyArchivedHidden", () => {
    it("is true only for the untouched default view", () => {
        expect(onlyArchivedHidden(view({ sort: "name" }), " ")).toBe(true);
        expect(onlyArchivedHidden(view(), "x")).toBe(false);
        expect(onlyArchivedHidden(view({ type: "coding" }), "")).toBe(false);
        expect(onlyArchivedHidden(view({ status: "active" }), "")).toBe(false);
    });
});

describe("parseView", () => {
    it("falls back to the default for missing or malformed input", () => {
        expect(parseView(null)).toEqual(DEFAULT_VIEW);
        expect(parseView("not json")).toEqual(DEFAULT_VIEW);
        expect(parseView("42")).toEqual(DEFAULT_VIEW);
        expect(parseView("null")).toEqual(DEFAULT_VIEW);
    });

    it("keeps valid fields and replaces invalid ones", () => {
        expect(parseView(JSON.stringify({ sort: "name", type: "coding", status: "archived" }))).toEqual({
            sort: "name",
            type: "coding",
            status: "archived",
        });
        expect(parseView(JSON.stringify({ sort: "bogus", type: 3, status: "deleted" }))).toEqual(DEFAULT_VIEW);
    });
});
