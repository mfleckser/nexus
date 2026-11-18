// Feature notes edits whose save failed, by feature id, with the server text they were
// edited from. Reopening the drawer restores them, so closing after a failed save
// doesn't lose the edits. In memory only.
export const unsavedNotes = new Map<string, { text: string; base: string }>();

// Features being deleted: their drawer's pending edits are dropped, not saved.
export const discardedNotes = new Set<string>();
