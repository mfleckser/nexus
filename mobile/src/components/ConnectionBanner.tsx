import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Connection } from "../data/useAgendaData";
import { formatUpdatedAt } from "../lib/format";
import { colors, radius } from "../theme";

type Props = {
    connection: Connection;
    hasData: boolean;
    fetchedAt: Date | null;
    now: Date;
    origin: string;
    onRetry: () => void;
};

// Shown while the backend can't be reached: the agenda is the last fetched
// copy and nothing can be changed.
export default function ConnectionBanner({ connection, hasData, fetchedAt, now, origin, onRetry }: Props) {
    if (connection !== "offline") return null;
    const detail =
        hasData && fetchedAt
            ? `${formatUpdatedAt(fetchedAt, now)}. Read-only until Nexus is back.`
            : `Can't reach ${origin}. Nothing saved on this phone yet.`;
    return (
        <View style={styles.banner} accessibilityRole="alert">
            <View style={styles.text}>
                <Text style={styles.title}>Offline</Text>
                <Text style={styles.detail}>{detail}</Text>
            </View>
            <Pressable onPress={onRetry} style={styles.retry} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.retryText}>Retry</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    banner: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginHorizontal: 12,
        marginBottom: 4,
        padding: 12,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.statusWarning,
        backgroundColor: colors.warningMuted,
    },
    text: { flex: 1, gap: 2 },
    title: { color: colors.statusWarning, fontSize: 15, fontWeight: "700" },
    detail: { color: colors.textSecondary, fontSize: 13 },
    retry: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.statusWarning,
    },
    retryText: { color: colors.statusWarning, fontSize: 13, fontWeight: "600" },
});
