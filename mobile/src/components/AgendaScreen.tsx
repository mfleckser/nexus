import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { API_ORIGIN } from "../api";
import { useAgendaData } from "../data/useAgendaData";
import useNow from "../hooks/useNow";
import { buildAgenda, type AgendaItem, type AgendaSection } from "../lib/agenda";
import { formatShortDate } from "../lib/format";
import { colors, radius } from "../theme";
import { EventRow, TaskRow } from "./AgendaRows";
import ConnectionBanner from "./ConnectionBanner";
import QuickAddSheet from "./QuickAddSheet";

export default function AgendaScreen() {
    const insets = useSafeAreaInsets();
    const now = useNow();
    const data = useAgendaData();
    const [openSections, setOpenSections] = useState<ReadonlySet<string>>(new Set());
    const [adding, setAdding] = useState(false);

    const agenda = useMemo(
        () => buildAgenda(data.tasks, data.events, now, data.hiddenProjectIds),
        [data.tasks, data.events, now, data.hiddenProjectIds],
    );
    // Collapsed sections keep their header but list no rows.
    const sections = agenda.map((section) => ({
        section,
        data: section.collapsible && !openSections.has(section.key) ? [] : section.items,
    }));

    const toggleSection = (key: string) =>
        setOpenSections((prev) => {
            const next = new Set(prev);
            if (!next.delete(key)) next.add(key);
            return next;
        });

    const renderItem = (item: AgendaItem, section: AgendaSection) =>
        item.kind === "event" ? (
            <EventRow event={item.event} day={section.day ?? now} />
        ) : (
            <TaskRow
                task={item.task}
                showDate={section.day === null}
                canWrite={data.canWrite}
                onToggle={(task) => data.setTaskComplete(task.id, task.status !== "complete")}
            />
        );

    return (
        <View style={[styles.screen, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Text style={styles.heading}>Agenda</Text>
                <Text style={styles.date}>{formatShortDate(now)}</Text>
            </View>
            <ConnectionBanner
                connection={data.connection}
                hasData={data.hasData}
                fetchedAt={data.fetchedAt}
                now={now}
                origin={API_ORIGIN}
                onRetry={data.refresh}
            />
            {!data.hasData ? (
                <View style={styles.placeholder}>
                    {data.connection === "loading" && <ActivityIndicator color={colors.accent} />}
                </View>
            ) : (
                <SectionList
                    sections={sections}
                    keyExtractor={(item) => item.key}
                    renderItem={({ item, section }) => renderItem(item, section.section)}
                    renderSectionHeader={({ section: { section } }) => (
                        <SectionHeader
                            section={section}
                            open={openSections.has(section.key)}
                            onToggle={() => toggleSection(section.key)}
                        />
                    )}
                    renderSectionFooter={({ section: { section } }) =>
                        section.key === "day:0" && section.items.length === 0 ? (
                            <Text style={styles.empty}>Nothing scheduled</Text>
                        ) : null
                    }
                    stickySectionHeadersEnabled={false}
                    contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
                    refreshControl={
                        <RefreshControl
                            refreshing={data.refreshing}
                            onRefresh={data.pullToRefresh}
                            tintColor={colors.textSecondary}
                        />
                    }
                />
            )}
            {data.error && (
                <Pressable
                    style={[styles.toast, { bottom: insets.bottom + 88 }]}
                    onPress={data.dismissError}
                    accessibilityRole="alert"
                >
                    <Text style={styles.toastText}>{data.error}</Text>
                </Pressable>
            )}
            <Pressable
                style={[styles.fab, { bottom: insets.bottom + 20 }, !data.canWrite && styles.fabDisabled]}
                onPress={() => setAdding(true)}
                disabled={!data.canWrite}
                accessibilityRole="button"
                accessibilityLabel="Quick add"
                accessibilityState={{ disabled: !data.canWrite }}
            >
                <Text style={styles.fabText}>+</Text>
            </Pressable>
            <QuickAddSheet
                visible={adding}
                canWrite={data.canWrite}
                now={now}
                onClose={() => setAdding(false)}
                onAddTask={data.createTask}
                onAddEvent={data.createEvent}
            />
        </View>
    );
}

function SectionHeader({ section, open, onToggle }: { section: AgendaSection; open: boolean; onToggle: () => void }) {
    const title = (
        <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, section.tone === "danger" && styles.sectionDanger]}>
                {section.collapsible ? `${open ? "▾" : "▸"} ${section.title}` : section.title}
            </Text>
            {section.subtitle && <Text style={styles.sectionSubtitle}>{section.subtitle}</Text>}
            {(section.collapsible || section.tone === "danger") && (
                <Text style={styles.sectionCount}>{section.items.length}</Text>
            )}
        </View>
    );
    if (!section.collapsible) return title;
    return (
        <Pressable
            onPress={onToggle}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={`${section.title}, ${section.items.length} tasks`}
        >
            {title}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgApp },
    header: {
        flexDirection: "row",
        alignItems: "baseline",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
    },
    heading: { color: colors.textPrimary, fontSize: 28, fontWeight: "700" },
    date: { color: colors.textSecondary, fontSize: 15 },
    placeholder: { flex: 1, alignItems: "center", justifyContent: "center" },
    sectionHeader: {
        flexDirection: "row",
        alignItems: "baseline",
        gap: 8,
        paddingHorizontal: 16,
        paddingTop: 20,
        paddingBottom: 6,
    },
    sectionTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
    sectionDanger: { color: colors.statusDanger },
    sectionSubtitle: { color: colors.textMuted, fontSize: 13 },
    sectionCount: { marginLeft: "auto", color: colors.textMuted, fontSize: 13 },
    empty: {
        color: colors.textMuted,
        fontSize: 14,
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: colors.bgSurface,
    },
    toast: {
        position: "absolute",
        left: 16,
        right: 16,
        padding: 12,
        borderRadius: radius.md,
        backgroundColor: colors.bgElevated,
        borderWidth: 1,
        borderColor: colors.statusDanger,
    },
    toastText: { color: colors.textPrimary, fontSize: 14 },
    fab: {
        position: "absolute",
        right: 20,
        width: 56,
        height: 56,
        borderRadius: radius.pill,
        backgroundColor: colors.accent,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: colors.shadow,
        shadowOpacity: 0.5,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
    },
    fabDisabled: { backgroundColor: colors.bgActive },
    fabText: { color: colors.textOnAccent, fontSize: 30, lineHeight: 32, fontWeight: "400" },
});
