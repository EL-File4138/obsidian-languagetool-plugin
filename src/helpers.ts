export type LintClass = "lt-minor" | "lt-style" | "lt-major";

// Assign a CSS class based on a rule's category ID
export function lintClass(categoryId: string, ruleId: string): LintClass {
    // Newer form of spelling errors (probably using LLMs in the backend)
    if (
        ruleId.includes("SPELLING") ||
        (ruleId.startsWith("QB_NEW_EN_") && ruleId.includes("ORTHOGRAPHY"))
    ) {
        return "lt-major";
    }

    switch (categoryId) {
        case "COLLOQUIALISMS":
        case "REDUNDANCY":
        case "STYLE":
        case "SYNONYMS":
            return "lt-style";
        case "TYPOS":
            return "lt-major";
        default:
            return "lt-minor";
    }
}

export function setDifference<T>(setA: Set<T>, setB: Set<T>): Set<T> {
    const difference = new Set(setA);
    for (const elem of setB) {
        difference.delete(elem);
    }
    return difference;
}
export function setUnion<T>(setA: Set<T>, setB: Set<T>): Set<T> {
    const union = new Set(setA);
    for (const elem of setB) {
        union.add(elem);
    }
    return union;
}
export function setIntersect<T>(setA: Set<T>, setB: Set<T>): Set<T> {
    const intersection = new Set<T>();
    for (const elem of setB) {
        if (setA.has(elem)) {
            intersection.add(elem);
        }
    }
    return intersection;
}

export function isWord(text: string): boolean {
    return /^(?=.*\p{L})[\P{P}_-](?:\S*[\P{P}_-])?$/u.test(text.trim());
}

export function cmpIgnoreCase(a: string, b: string): number {
    return a.localeCompare(b);
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
/** Strip API paths copied from LanguageTool documentation. */
export function normalizeServerUrl(url: string): string {
    return url.trim().replace(/\/+$/, "").replace(/\/v2(\/check)?$/, "");
}

/** Translate NFC UTF-16 offsets back to the original text (Clemens-E, #131). */
export function buildNfcOffsetMap(original: string): number[] | null {
    const normalized = original.normalize("NFC");
    if (normalized === original) return null;

    const map: number[] = [];
    const pieces: string[] = [];
    let nfcPos = 0;
    for (let i = 0; i < original.length;) {
        let j = i + (original.codePointAt(i)! > 0xffff ? 2 : 1);
        while (j < original.length) {
            const char = String.fromCodePoint(original.codePointAt(j)!);
            if (!/\p{M}/u.test(char)) break;
            j += char.length;
        }
        const cluster = original.slice(i, j).normalize("NFC");
        pieces.push(cluster);
        for (let k = 0; k < cluster.length; k++) map[nfcPos + k] = Math.min(i + k, j - 1);
        nfcPos += cluster.length;
        i = j;
    }
    map[nfcPos] = original.length;
    // Hangul Jamo can compose across these cluster boundaries.
    return pieces.join("") === normalized ? map : null;
}

export function parseLanguageList(value: unknown): string[] | undefined {
    const values = typeof value === "string" ? value.split(",") : value;
    if (!Array.isArray(values) || !values.every((code: unknown) => typeof code === "string"))
        return undefined;
    return [...new Set(values.map(code => code.trim()).filter(Boolean))];
}

export function isAllowedDetectedLanguage(
    detected: string | undefined,
    allowed: readonly string[] | undefined,
    staticLanguage: string,
): boolean {
    if ((staticLanguage && staticLanguage !== "auto") || !allowed?.length || !detected) return true;
    const language = detected.toLowerCase();
    return allowed.some(code => {
        const candidate = code.toLowerCase();
        return candidate === language || candidate.split("-")[0] === language.split("-")[0];
    });
}
