// "Midnight Study" tokens from frontend/src/renderer/src/theme.css, for
// React Native styles. Keep the two in step; add a token here rather than
// inlining a color in a component.
export const colors = {
    bgApp: "#16171b",
    bgSurface: "#1d1f24",
    bgElevated: "#252830",
    bgHover: "#2d3038",
    bgActive: "#363a44",
    bgOverlay: "rgba(0, 0, 0, 0.55)",

    borderSubtle: "#23262d",
    borderDefault: "#2d3038",
    borderStrong: "#3c4049",

    textPrimary: "#e8e9ed",
    textSecondary: "#a5a8b1",
    textMuted: "#6f727c",
    textDisabled: "#4a4d54",
    textOnAccent: "#ffffff",

    accent: "#8b9aff",
    accentActive: "#6f80f0",
    accentMuted: "rgba(139, 154, 255, 0.15)",
    accentBorder: "rgba(139, 154, 255, 0.40)",

    pillarCalendar: "#8b9aff",
    pillarTask: "#6dd4a3",

    statusWarning: "#f5c772",
    statusDanger: "#ed7a7a",
    warningMuted: "rgba(245, 199, 114, 0.12)",
    dangerMuted: "rgba(237, 122, 122, 0.12)",

    shadow: "#000000",
} as const;

export const radius = { sm: 4, md: 8, lg: 12, pill: 999 } as const;
