import type { EventCreate, TaskCreate } from "@nexus/shared";
import { addDays, calendarDaysBetween, startOfDay } from "@nexus/shared";
import { useState } from "react";
import {
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { dayLabel, formatTime } from "../lib/format";
import {
    atMinutes,
    DEFAULT_TASK_DUE_MINUTES,
    defaultEventStart,
    deviceTimeZone,
    DURATIONS,
    eventCreateBody,
    stepMinutes,
    taskCreateBody,
} from "../lib/quickAdd";
import { colors, radius } from "../theme";

type Kind = "task" | "event";

type Props = {
    visible: boolean;
    canWrite: boolean;
    now: Date;
    onClose: () => void;
    onAddTask: (body: TaskCreate) => Promise<boolean>;
    onAddEvent: (body: EventCreate) => Promise<boolean>;
};

// Bottom sheet for adding a task (title + due day/time) or a one-off event
// (title + day + start/duration or all day).
export default function QuickAddSheet({ visible, canWrite, now, onClose, onAddTask, onAddEvent }: Props) {
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            {/* Mounted only while open, so every open starts from a fresh form. */}
            {visible && (
                <QuickAddForm
                    canWrite={canWrite}
                    now={now}
                    onClose={onClose}
                    onAddTask={onAddTask}
                    onAddEvent={onAddEvent}
                />
            )}
        </Modal>
    );
}

function QuickAddForm({ canWrite, now, onClose, onAddTask, onAddEvent }: Omit<Props, "visible">) {
    const insets = useSafeAreaInsets();
    const [kind, setKind] = useState<Kind>("task");
    const [title, setTitle] = useState("");
    const [day, setDay] = useState(() => startOfDay(now));
    const [dueMinutes, setDueMinutes] = useState(DEFAULT_TASK_DUE_MINUTES);
    const [allDay, setAllDay] = useState(false);
    const [startMinutes, setStartMinutes] = useState(() => defaultEventStart(now));
    const [duration, setDuration] = useState<number>(60);
    const [saving, setSaving] = useState(false);

    const canSubmit = canWrite && !saving && title.trim().length > 0;
    const dayOffset = calendarDaysBetween(now, day);

    const submit = async () => {
        if (!canSubmit) return;
        setSaving(true);
        const ok =
            kind === "task"
                ? await onAddTask(taskCreateBody(title, day, dueMinutes))
                : await onAddEvent(
                      eventCreateBody({
                          title,
                          day,
                          allDay,
                          startMinutes,
                          durationMinutes: duration,
                          timeZone: deviceTimeZone(),
                      }),
                  );
        setSaving(false);
        if (ok) onClose();
    };

    return (
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close quick add" />
            <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
                <View style={styles.segment}>
                    {(["task", "event"] as const).map((k) => (
                        <Pressable
                            key={k}
                            style={[styles.segmentItem, kind === k && styles.segmentActive]}
                            onPress={() => setKind(k)}
                            accessibilityRole="tab"
                            accessibilityState={{ selected: kind === k }}
                        >
                            <Text style={[styles.segmentText, kind === k && styles.segmentTextActive]}>
                                {k === "task" ? "Task" : "Event"}
                            </Text>
                        </Pressable>
                    ))}
                </View>

                <TextInput
                    style={styles.input}
                    placeholder={kind === "task" ? "Task title" : "Event title"}
                    placeholderTextColor={colors.textMuted}
                    value={title}
                    onChangeText={setTitle}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={submit}
                />

                <Field label="Day">
                    <Stepper
                        label={dayLabel(day, now)}
                        onPrev={() => setDay((d) => addDays(d, -1))}
                        onNext={() => setDay((d) => addDays(d, 1))}
                        prevDisabled={dayOffset <= 0}
                    />
                </Field>

                {kind === "task" ? (
                    <Field label="Due">
                        <Stepper
                            label={formatTime(atMinutes(day, dueMinutes))}
                            onPrev={() => setDueMinutes((m) => stepMinutes(m, -1))}
                            onNext={() => setDueMinutes((m) => stepMinutes(m, 1))}
                        />
                    </Field>
                ) : (
                    <>
                        <Field label="All day">
                            <Switch
                                value={allDay}
                                onValueChange={setAllDay}
                                trackColor={{ true: colors.accent, false: colors.bgActive }}
                                thumbColor={colors.textPrimary}
                            />
                        </Field>
                        {!allDay && (
                            <>
                                <Field label="Start">
                                    <Stepper
                                        label={formatTime(atMinutes(day, startMinutes))}
                                        onPrev={() => setStartMinutes((m) => stepMinutes(m, -1))}
                                        onNext={() => setStartMinutes((m) => stepMinutes(m, 1))}
                                    />
                                </Field>
                                <Field label="Length">
                                    <View style={styles.chips}>
                                        {DURATIONS.map((d) => (
                                            <Pressable
                                                key={d}
                                                style={[styles.chip, duration === d && styles.chipActive]}
                                                onPress={() => setDuration(d)}
                                                accessibilityRole="radio"
                                                accessibilityState={{ selected: duration === d }}
                                            >
                                                <Text
                                                    style={[styles.chipText, duration === d && styles.chipTextActive]}
                                                >
                                                    {d < 60 ? `${d}m` : `${d / 60}h`}
                                                </Text>
                                            </Pressable>
                                        ))}
                                    </View>
                                </Field>
                            </>
                        )}
                    </>
                )}

                {!canWrite && <Text style={styles.offline}>Offline: adding is off until Nexus is back.</Text>}

                <View style={styles.actions}>
                    <Pressable style={styles.button} onPress={onClose} accessibilityRole="button">
                        <Text style={styles.buttonText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                        style={[styles.button, styles.buttonPrimary, !canSubmit && styles.buttonDisabled]}
                        onPress={submit}
                        disabled={!canSubmit}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !canSubmit }}
                    >
                        <Text style={[styles.buttonText, styles.buttonPrimaryText]}>{saving ? "Adding…" : "Add"}</Text>
                    </Pressable>
                </View>
            </View>
        </KeyboardAvoidingView>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <View style={styles.field}>
            <Text style={styles.fieldLabel}>{label}</Text>
            {children}
        </View>
    );
}

type StepperProps = { label: string; onPrev: () => void; onNext: () => void; prevDisabled?: boolean };

function Stepper({ label, onPrev, onNext, prevDisabled = false }: StepperProps) {
    return (
        <View style={styles.stepper}>
            <Pressable
                style={styles.stepButton}
                onPress={onPrev}
                disabled={prevDisabled}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Earlier"
            >
                <Text style={[styles.stepArrow, prevDisabled && styles.stepArrowDisabled]}>‹</Text>
            </Pressable>
            <Text style={styles.stepLabel}>{label}</Text>
            <Pressable
                style={styles.stepButton}
                onPress={onNext}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Later"
            >
                <Text style={styles.stepArrow}>›</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.bgOverlay },
    sheet: {
        gap: 14,
        paddingTop: 16,
        paddingHorizontal: 16,
        backgroundColor: colors.bgElevated,
        borderTopLeftRadius: radius.lg,
        borderTopRightRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.borderDefault,
    },
    segment: {
        flexDirection: "row",
        padding: 3,
        borderRadius: radius.md,
        backgroundColor: colors.bgSurface,
    },
    segmentItem: { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: radius.sm },
    segmentActive: { backgroundColor: colors.bgActive },
    segmentText: { color: colors.textSecondary, fontSize: 14, fontWeight: "600" },
    segmentTextActive: { color: colors.textPrimary },
    input: {
        color: colors.textPrimary,
        fontSize: 17,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.borderStrong,
        backgroundColor: colors.bgSurface,
    },
    field: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 36 },
    fieldLabel: { color: colors.textSecondary, fontSize: 15 },
    stepper: { flexDirection: "row", alignItems: "center", gap: 4 },
    stepButton: {
        width: 34,
        height: 34,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.md,
        backgroundColor: colors.bgHover,
    },
    stepArrow: { color: colors.textPrimary, fontSize: 22, lineHeight: 24 },
    stepArrowDisabled: { color: colors.textDisabled },
    stepLabel: { minWidth: 112, textAlign: "center", color: colors.textPrimary, fontSize: 15, fontWeight: "500" },
    chips: { flexDirection: "row", gap: 6 },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.borderStrong,
    },
    chipActive: { backgroundColor: colors.accentMuted, borderColor: colors.accentBorder },
    chipText: { color: colors.textSecondary, fontSize: 14 },
    chipTextActive: { color: colors.accent },
    offline: { color: colors.statusWarning, fontSize: 13 },
    actions: { flexDirection: "row", gap: 10, marginTop: 4 },
    button: {
        flex: 1,
        alignItems: "center",
        paddingVertical: 12,
        borderRadius: radius.md,
        backgroundColor: colors.bgHover,
    },
    buttonPrimary: { backgroundColor: colors.accent },
    buttonDisabled: { opacity: 0.4 },
    buttonText: { color: colors.textPrimary, fontSize: 16, fontWeight: "600" },
    buttonPrimaryText: { color: colors.textOnAccent },
});
