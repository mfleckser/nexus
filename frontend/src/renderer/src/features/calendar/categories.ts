import categoryData from "./categories.json";

export const CATEGORIES: { name: string; color: string }[] = categoryData;

// Chip color for an event category; unknown or missing categories get the
// neutral theme color.
export function categoryColor(category: string | null | undefined): string {
    return CATEGORIES.find((c) => c.name === category)?.color ?? "var(--event-uncategorized)";
}
