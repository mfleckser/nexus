import AsyncStorage from "@react-native-async-storage/async-storage";
import { parseSnapshot, serializeSnapshot, type Snapshot } from "../lib/snapshot";

const KEY = "nexus.snapshot";

export async function loadSnapshot(): Promise<Snapshot | null> {
    try {
        return parseSnapshot(await AsyncStorage.getItem(KEY));
    } catch {
        return null;
    }
}

// Best effort: a failed save only costs the offline copy.
export function saveSnapshot(snapshot: Snapshot): void {
    AsyncStorage.setItem(KEY, serializeSnapshot(snapshot)).catch(() => {});
}
