export function parseSortParam(
    sortQuery?: string,
): Record<string, 1 | -1> | undefined {
    if (!sortQuery || typeof sortQuery !== "string" || !sortQuery.trim()) {
        return undefined;
    }

    const sortMap: Record<string, 1 | -1> = {};
    const fields = sortQuery
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);

    if (fields.length === 0) return undefined;

    for (const field of fields) {
        if (field.startsWith("-")) {
            const cleanField = field.substring(1).trim();
            if (cleanField) sortMap[cleanField] = -1;
        } else if (field.startsWith("+")) {
            const cleanField = field.substring(1).trim();
            if (cleanField) sortMap[cleanField] = 1;
        } else {
            sortMap[field] = 1;
        }
    }

    return Object.keys(sortMap).length > 0 ? sortMap : undefined;
}
