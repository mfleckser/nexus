import { describe, expect, it } from "vitest";
import { featureNameFor, projectsToLoadFeatures } from "./taskFeatures";

const features = {
    p1: [
        { id: "f1", name: "Calendar" },
        { id: "f2", name: "Tasks" },
    ],
};

describe("featureNameFor", () => {
    it("finds the task's feature in its project's loaded list", () => {
        expect(featureNameFor({ project_id: "p1", feature_id: "f2" }, features)).toBe("Tasks");
    });

    it("is null without a project or feature", () => {
        expect(featureNameFor({ project_id: null, feature_id: null }, features)).toBeNull();
        expect(featureNameFor({ project_id: "p1", feature_id: null }, features)).toBeNull();
    });

    it("is null while the project's features aren't loaded or the feature is missing", () => {
        expect(featureNameFor({ project_id: "p2", feature_id: "f9" }, features)).toBeNull();
        expect(featureNameFor({ project_id: "p1", feature_id: "f9" }, features)).toBeNull();
    });
});

describe("projectsToLoadFeatures", () => {
    it("returns each project with an unloaded feature once", () => {
        const tasks = [
            { project_id: "p1", feature_id: "f1" }, // loaded
            { project_id: "p2", feature_id: "f5" },
            { project_id: "p2", feature_id: "f6" },
            { project_id: "p1", feature_id: "f3" }, // created since p1 loaded
            { project_id: "p3", feature_id: null },
            { project_id: null, feature_id: null },
        ];
        const requested = new Set<string>();
        expect(projectsToLoadFeatures(tasks, features, requested).toSorted()).toEqual(["p1", "p2"]);
        expect([...requested].toSorted()).toEqual(["f3", "f5", "f6"]);
    });

    it("skips feature ids already requested, so a missing one isn't refetched", () => {
        const requested = new Set(["f9"]);
        expect(projectsToLoadFeatures([{ project_id: "p1", feature_id: "f9" }], features, requested)).toEqual([]);
    });
});
