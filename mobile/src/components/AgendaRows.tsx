import { Pressable, StyleSheet, Text, View } from "react-native";
import { eventTimeLabel, formatShortDate, formatTime } from "../lib/format";
import type { CalendarEvent, Task } from "../lib/types";
import { colors, radius } from "../theme";

type TaskRowProps = {
    task: Task;
    // Overdue and later tasks show their date, day sections only the time.
    showDate: boolean;
    canWrite: boolean;
    onToggle: (task: Task) => void;
};

export function TaskRow({ task, showDate, canWrite, onToggle }: TaskRowProps) {
    const complete = task.status === "complete";
    const blocked = task.status === "blocked";
    const due =
        task.due_at &&
        (showDate ? `${formatShortDate(task.due_at)}, ${formatTime(task.due_at)}` : formatTime(task.due_at));
    return (
        <View style={styles.row}>
            <Pressable
                onPress={() => onToggle(task)}
                disabled={!canWrite}
                hitSlop={10}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: complete, disabled: !canWrite }}
                accessibilityLabel={complete ? `Reopen ${task.title}` : `Complete ${task.title}`}
                style={[styles.check, complete && styles.checkDone, !canWrite && styles.checkLocked]}
            >
                {complete && <Text style={styles.checkMark}>✓</Text>}
            </Pressable>
            <View style={styles.body}>
                <Text style={[styles.title, complete && styles.titleDone]} numberOfLines={2}>
                    {task.title}
                </Text>
                {(due || blocked) && (
                    <View style={styles.metaRow}>
                        {due && <Text style={styles.meta}>Due {due}</Text>}
                        {blocked && <Text style={styles.blocked}>Blocked</Text>}
                    </View>
                )}
            </View>
        </View>
    );
}

export function EventRow({ event, day }: { event: CalendarEvent; day: Date }) {
    return (
        <View style={styles.row}>
            <View style={styles.eventBar} />
            <View style={styles.body}>
                <Text style={styles.title} numberOfLines={2}>
                    {event.title}
                </Text>
                <Text style={styles.meta}>{eventTimeLabel(event, day)}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 10,
        paddingHorizontal: 14,
        backgroundColor: colors.bgSurface,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.borderSubtle,
    },
    body: { flex: 1, gap: 2 },
    title: { color: colors.textPrimary, fontSize: 16 },
    titleDone: { color: colors.textMuted, textDecorationLine: "line-through" },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    meta: { color: colors.textSecondary, fontSize: 13 },
    blocked: {
        color: colors.statusWarning,
        fontSize: 11,
        fontWeight: "600",
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: radius.pill,
        backgroundColor: colors.warningMuted,
        overflow: "hidden",
    },
    check: {
        width: 22,
        height: 22,
        borderRadius: radius.pill,
        borderWidth: 1.5,
        borderColor: colors.pillarTask,
        alignItems: "center",
        justifyContent: "center",
    },
    checkDone: { backgroundColor: colors.pillarTask },
    checkLocked: { opacity: 0.45 },
    checkMark: { color: colors.bgApp, fontSize: 13, fontWeight: "700" },
    eventBar: { width: 4, alignSelf: "stretch", borderRadius: radius.sm, backgroundColor: colors.pillarCalendar },
});
