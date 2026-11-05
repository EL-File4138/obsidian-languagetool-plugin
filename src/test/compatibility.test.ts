import { pluginStorage } from "./obsidian";
import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import type { EditorView, PluginValue, ViewUpdate } from "@codemirror/view";
import { editorInfoField, type App, type Command, type Editor, type MarkdownFileInfo, type PluginManifest, type TFile } from "obsidian";
import * as obsidian from "obsidian";
import LanguageToolPlugin from "../main";
import * as api from "../api";
import { AnnotatedText } from "../annotated";
import { DEFAULT_SETTINGS, getEndpoint } from "../settings";
import { buildNfcOffsetMap, isAllowedDetectedLanguage, normalizeServerUrl, parseLanguageList } from "../helpers";
import { addUnderline, underlineDecoration } from "../editor/underlines";
import { autoCheckListener } from "../editor/autoCheck";

let plugin: LanguageToolPlugin;
let frontmatter: Record<string, unknown>;
const file = { path: "note.md" } as TFile;
let originalWindow: PropertyDescriptor | undefined;

beforeEach(() => {
    originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
    frontmatter = {};
    spyOn(pluginStorage, "saveData").mockResolvedValue();
    spyOn(pluginStorage, "loadData").mockResolvedValue(undefined);
    spyOn(api, "languages").mockResolvedValue([]);
    plugin = new LanguageToolPlugin({
        workspace: { getActiveFile: () => file },
        metadataCache: { getFileCache: () => ({ frontmatter }) },
        secretStorage: { getSecret: () => null, setSecret: () => {} },
        fileManager: { processFrontMatter: async (_file: TFile, update: (fm: Record<string, unknown>) => void) => update(frontmatter) },
    } as unknown as App, {} as PluginManifest);
});

afterEach(() => {
    // Dispose network tasks without invoking Obsidian's component lifecycle in the mock.
    const tasks = plugin as unknown as { languageTask: { dispose(): void }; dictionaryTask: { dispose(): void } };
    tasks.languageTask.dispose();
    tasks.dictionaryTask.dispose();
    mock.restore();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

function editor(doc = "wrng", withFile = true): EditorView {
    const view = {
        state: EditorState.create({ doc, extensions: [
            underlineDecoration,
            ...(withFile ? [editorInfoField.init(() => ({ file }) as MarkdownFileInfo)] : []),
        ] }),
        dispatch(transaction: Parameters<EditorState["update"]>[0]) {
            view.state = view.state.update(transaction).state;
        },
    };
    return view as unknown as EditorView;
}

const match: api.LTLint = {
    range: { from: 0, to: 4 }, text: "wrng", title: "", message: "Wrong", replacements: ["wrong"],
    ruleId: "TEST_RULE", categoryId: "TYPOS",
};

function response(matches: { offset: number; length: number }[] = []) {
    return { status: 200, text: "", json: {
        language: { code: "en-US", detectedLanguage: { code: "en" } },
        matches: matches.map(range => ({ ...range, shortMessage: "", message: "Wrong", replacements: [], rule: { id: "TEST_RULE", category: { id: "TYPOS" } } })),
    }, headers: {}, arrayBuffer: new ArrayBuffer(0) };
}

test("normalizes API URL suffixes and preserves endpoint rate limits", async () => {
    for (const suffix of ["/", "/v2", "/v2/check/"]) {
        expect(normalizeServerUrl(`https://api.languagetool.org${suffix}`)).toBe("https://api.languagetool.org");
        expect(getEndpoint(`https://api.languagetool.org${suffix}`).minDelay).toBe(3000);
    }
    await plugin.settings.update({ endpoint: "custom", serverUrl: "http://localhost:8010/v2/check/", autoCheckDelay: 50 });
    expect(plugin.settings.options.serverUrl).toBe("http://localhost:8010");
    expect(plugin.settings.options.autoCheckDelay).toBe(50);
    await plugin.settings.update({ endpoint: "premium" });
    expect(plugin.settings.options.autoCheckDelay).toBe(750);
    await plugin.settings.update({ endpoint: "public" });
    expect(plugin.settings.options.autoCheckDelay).toBe(3000);
});

test("loads local language restrictions and migrates plaintext keys without losing settings", async () => {
    spyOn(pluginStorage, "loadData").mockResolvedValue({
        serverUrl: "https://api.languagetool.org/v2/check", possibleLanguages: [" en ", "de", "en"],
        autoCheckDelay: 500, apikey: "test-key", dictionary: ["custom"],
    });
    const secret = spyOn(plugin.app.secretStorage, "setSecret");
    await plugin.settings.load();
    expect(secret).toHaveBeenCalledWith("languagetool-apikey", "test-key");
    expect(plugin.settings.options.possibleLanguages).toEqual(["en", "de"]);
    expect(plugin.settings.options.dictionary).toEqual(["custom"]);
    expect(plugin.settings.options.autoCheckDelay).toBe(3000);
    expect(plugin.settings.options).not.toHaveProperty("apikey");
});

test("note settings use the editor file, support aliases, and permit explicit auto detection", async () => {
    await plugin.settings.update({ staticLanguage: "fr", shouldAutoCheck: false, disabledRules: ["GLOBAL"] });
    frontmatter = { "lt_language": " auto ", language: "de", "lt-autoCheck": "true", "lt_possibleLanguages": " en, de, en ", "lt-disabledRules": ["NOTE"] };
    const options = plugin.getActiveFileSettings(editor());
    expect(options.staticLanguage).toBe("auto");
    expect(options.shouldAutoCheck).toBe(true);
    expect(options.possibleLanguages).toEqual(["en", "de"]);
    expect(options.disabledRules).toEqual(["GLOBAL", "NOTE"]);
    // An editor without a file must not inherit the active pane's metadata.
    expect(plugin.getActiveFileSettings(editor("wrng", false)).staticLanguage).toBe("fr");
    frontmatter = { lang: " de-DE ", "lt-autocheck": false, "lt-autoCheck": true };
    expect(plugin.getActiveFileSettings(editor()).staticLanguage).toBe("de-DE");
    expect(plugin.getActiveFileSettings(editor()).shouldAutoCheck).toBe(false);
});

test.each([{ tags: ["lt-ignore"] }, { tags: "other, lt-ignore" }, { tags: ["#lt-ignore"] }])("exact ignore tag prevents any request: %o", async ({ tags }) => {
    frontmatter = { tags };
    const check = spyOn(api, "check");
    await plugin.runDetection(editor());
    await plugin.runDetection(editor(), true);
    expect(check).not.toHaveBeenCalled();
});

test("similar tags do not suppress checks; language filtering and session ignore persist", async () => {
    frontmatter = { tags: ["lt-ignore-other"] };
    const check = spyOn(api, "check").mockResolvedValue({ matches: [match], detectedLanguage: "de" });
    await plugin.settings.update({ possibleLanguages: ["en"] });
    const view = editor();
    await plugin.runDetection(view);
    expect(check).toHaveBeenCalled();
    expect(view.state.field(underlineDecoration).size).toBe(0);
    frontmatter["lt-language"] = "de";
    await plugin.runDetection(view);
    expect(view.state.field(underlineDecoration).size).toBe(1);
    plugin.ignoreMatch(match, view);
    await plugin.runDetection(view);
    expect(view.state.field(underlineDecoration).size).toBe(0);
});

test("language filter accepts variants, missing detection, and static overrides", () => {
    expect(parseLanguageList(" en, de , en, ")).toEqual(["en", "de"]);
    expect(parseLanguageList(["en", 1])).toBeUndefined();
    expect(isAllowedDetectedLanguage("en-GB", ["en-US"], "auto")).toBe(true);
    expect(isAllowedDetectedLanguage("de", ["en"], "auto")).toBe(false);
    expect(isAllowedDetectedLanguage("de", ["en"], "de-DE")).toBe(true);
    expect(isAllowedDetectedLanguage(undefined, ["en"], "")).toBe(true);
});

test("NFC requests map offsets back through decomposed text and markdown", async () => {
    const request = spyOn(obsidian, "requestUrl").mockResolvedValue(response([{ offset: 2, length: 4 }, { offset: 7, length: 4 }]));
    const result = await api.check(DEFAULT_SETTINGS, null, 20, new AnnotatedText([{ markup: "  " }, { text: "cafe\u0301 wrng" }]));
    expect(result.matches.map(m => m.range)).toEqual([{ from: 22, to: 27 }, { from: 28, to: 32 }]);
    expect(result.matches.map(m => m.text)).toEqual(["cafe\u0301", "wrng"]);
    expect(result.detectedLanguage).toBe("en");
    const body = new URLSearchParams((request.mock.calls[0][0] as obsidian.RequestUrlParam).body as string);
    expect(body.get("data")).toContain("café wrng");
    expect(buildNfcOffsetMap("\u1100\u1161")).toBeNull();
});

test("NFC offset mapping leaves decomposed excluded markup unchanged", async () => {
    const request = spyOn(obsidian, "requestUrl").mockResolvedValue(response([{ offset: 10, length: 4 }]));
    const result = await api.check(DEFAULT_SETTINGS, null, 0, new AnnotatedText([
        { text: "cafe\u0301" }, { markup: " e\u0301xx " }, { text: "wrng" },
    ]));
    expect(result.matches[0].range).toEqual({ from: 11, to: 15 });
    expect(result.matches[0].text).toBe("wrng");
    const body = new URLSearchParams((request.mock.calls[0][0] as obsidian.RequestUrlParam).body as string);
    expect(body.get("data")).toContain(JSON.stringify({ markup: " e\u0301xx " }));
});

test("fixed languages omit detection preferences and missing detected language is optional", async () => {
    const payload = response();
    payload.json.language = { code: "de-DE" } as typeof payload.json.language;
    const request = spyOn(obsidian, "requestUrl").mockResolvedValue(payload);
    const result = await api.check({ ...DEFAULT_SETTINGS, serverUrl: "http://localhost:8010/v2/check/", staticLanguage: "de-DE", preferredLanguages: ["en"] }, null, 0, new AnnotatedText([{ text: "Test" }]));
    const params = new URLSearchParams((request.mock.calls[0][0] as obsidian.RequestUrlParam).body as string);
    expect(params.has("preferredVariants")).toBe(false);
    expect(params.has("preferredLanguages")).toBe(false);
    expect((request.mock.calls[0][0] as obsidian.RequestUrlParam).url).toBe("http://localhost:8010/v2/check");
    expect(result.detectedLanguage).toBe("de-DE");
});

test.each([
    { existing: false, edited: false },
    { existing: true, edited: false },
    { existing: false, edited: true },
])("dictionary undo preserves existing/concurrent words and avoids stale underlines: %o", async ({ existing, edited }) => {
    const originalFragment = Object.getOwnPropertyDescriptor(globalThis, "createFragment");
    let undo: () => Promise<void>;
    Object.defineProperty(globalThis, "createFragment", { configurable: true, value: (callback: (fragment: unknown) => void) => {
        callback({ appendText() {}, createEl(_tag: string, _options: unknown, init: (button: unknown) => void) {
            const button = {} as { onclick: () => Promise<void> };
            init(button);
            undo = button.onclick;
        } });
        return {};
    } });
    try {
        let words = ["obsidian", ...(existing ? ["wrng"] : [])];
        Object.assign(plugin.app, { vault: {
            getConfig: () => words,
            setConfig: (_key: string, updated: string[]) => { words = updated; },
        } });
        await plugin.settings.update({ dictionary: ["keep", ...(existing ? ["wrng"] : [])] });
        const view = editor();
        view.dispatch({ effects: addUnderline.of(match) });
        await plugin.addToDictionary("wrng", view);
        expect(plugin.settings.options.dictionary).toContain("wrng");
        expect(words).toContain("wrng");
        expect(view.state.field(underlineDecoration).size).toBe(0);
        await plugin.settings.update(current => ({ dictionary: [...current.dictionary, "later"] }));
        words.push("later");
        if (edited) view.dispatch({ changes: { from: 0, insert: "x" } });
        await undo!();
        expect(plugin.settings.options.dictionary.includes("wrng")).toBe(existing);
        expect(words.includes("wrng")).toBe(existing);
        expect(plugin.settings.options.dictionary).toContain("later");
        expect(words).toContain("later");
        expect(view.state.field(underlineDecoration).size).toBe(edited ? 0 : 1);
    } finally {
        if (originalFragment) Object.defineProperty(globalThis, "createFragment", originalFragment);
        else Reflect.deleteProperty(globalThis, "createFragment");
    }
});

function commands(): Map<string, Command> {
    const registered = new Map<string, Command>();
    Object.assign(plugin, { addCommand: (command: Command) => registered.set(command.id, command) });
    (plugin as unknown as { registerCommands(): void }).registerCommands();
    return registered;
}

test("document autocheck toggle persists the canonical key and removes redundant overrides", async () => {
    frontmatter = { "lt-autoCheck": false };
    const toggle = commands().get("toggle-auto-check-document")!;
    await toggle.editorCallback!(undefined as unknown as Editor, { file } as MarkdownFileInfo);
    expect(frontmatter).toEqual({ "lt-autocheck": true });
    await toggle.editorCallback!(undefined as unknown as Editor, { file } as MarkdownFileInfo);
    expect(frontmatter).toEqual({});
});

test("navigation advances past selected suggestions and handles document boundaries", () => {
    const registered = commands();
    const view = editor("wrng wrng");
    view.dispatch({ effects: [addUnderline.of(match), addUnderline.of({ ...match, range: { from: 5, to: 9 } })] });
    const wrapped = { cm: view } as unknown as Editor;
    const next = registered.get("next")!.editorCheckCallback!;
    const previous = registered.get("previous")!.editorCheckCallback!;
    next(false, wrapped, {} as MarkdownFileInfo);
    expect(view.state.selection.main.from).toBe(0);
    next(false, wrapped, {} as MarkdownFileInfo);
    expect(view.state.selection.main.from).toBe(5);
    expect(next(true, wrapped, {} as MarkdownFileInfo)).toBe(false);
    previous(false, wrapped, {} as MarkdownFileInfo);
    expect(view.state.selection.main.from).toBe(0);
    expect(previous(true, wrapped, {} as MarkdownFileInfo)).toBe(false);
});

test("autocheck timers and mapped pending ranges are isolated per editor and cleaned up", async () => {
    await plugin.settings.update({ shouldAutoCheck: true });
    const callbacks = new Map<number, () => void>();
    let nextTimer = 0;
    spyOn(window, "setTimeout").mockImplementation(((callback: () => void) => {
        callbacks.set(++nextTimer, callback);
        return nextTimer;
    }) as typeof window.setTimeout);
    spyOn(window, "clearTimeout").mockImplementation(id => { callbacks.delete(Number(id)); });
    const detection = spyOn(plugin, "runDetection").mockResolvedValue(true);
    // Instantiate the actual ViewPlugin values without a browser DOM.
    const extension = autoCheckListener(plugin) as unknown as { create(view: EditorView): PluginValue };
    const first = editor("abcdef");
    const second = editor("xyz");
    const a = extension.create(first);
    const b = extension.create(second);
    const edit = (view: EditorView, value: PluginValue, from: number, insert: string) => {
        const transaction = view.state.update({ changes: { from, insert } });
        Object.assign(view, { state: transaction.state });
        value.update!({ docChanged: true, view, changes: transaction.changes } as ViewUpdate);
    };
    edit(first, a, 4, "X");
    edit(second, b, 1, "Y");
    edit(first, a, 0, "ZZ");
    expect(callbacks.size).toBe(2);
    for (const callback of callbacks.values()) callback();
    expect(detection).toHaveBeenCalledWith(first, true, { from: 0, to: 7 });
    expect(detection).toHaveBeenCalledWith(second, true, { from: 1, to: 2 });
    callbacks.clear();
    edit(first, a, 0, "A");
    a.destroy!();
    b.destroy!();
    expect(callbacks.size).toBe(0);
});
