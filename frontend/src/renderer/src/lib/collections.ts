
type SetItem = {
    id: string,
    updated_at: Date
};

function sameSet(a: SetItem[], b: SetItem[]): boolean {
    const keyify = (item: SetItem) => `${item.id}:${item.updated_at.getTime()}`;
    const sa = a.map(keyify).toSorted();
    const sb = b.map(keyify).toSorted();
    return sa.every((v, i) => v === sb[i]);
}

export { sameSet };
