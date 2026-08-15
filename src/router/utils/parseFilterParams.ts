export function parseFilterParams(
    query?: Record<string, any>,
): Record<string, any> {
    // 1. Guard against null, undefined, or non-object primitives
    if (!query || typeof query !== "object" || Array.isArray(query)) {
        return {};
    }

    const filter: Record<string, any> = {};
    const reservedKeys = new Set(["limit", "skip", "sort", "page"]);

    const operators: Record<string, string> = {
        _gte: "$gte",
        _gt: "$gt",
        _lte: "$lte",
        _lt: "$lt",
        _ne: "$ne",
    };

    // Helper to coerce string values to numbers/booleans recursively
    const parseValue = (val: any): any => {
        if (typeof val === "string") {
            if (!isNaN(Number(val)) && val.trim() !== "") {
                return Number(val);
            }
            if (val === "true") return true;
            if (val === "false") return false;
            return val;
        }
        if (Array.isArray(val)) {
            return val.map(parseValue);
        }
        return val;
    };

    for (const [key, rawValue] of Object.entries(query)) {
        if (reservedKeys.has(key)) continue;

        const value = parseValue(rawValue);

        // Check if the key ends with an operator suffix (e.g. price_gte)
        let matchedOp = false;
        for (const [suffix, mongoOp] of Object.entries(operators)) {
            if (key.endsWith(suffix)) {
                const fieldName = key.slice(0, -suffix.length);
                filter[fieldName] = {
                    ...(filter[fieldName] || {}),
                    [mongoOp]: value,
                };
                matchedOp = true;
                break;
            }
        }

        // Standard exact equality match
        if (!matchedOp) {
            filter[key] = value;
        }
    }

    return filter;
}
