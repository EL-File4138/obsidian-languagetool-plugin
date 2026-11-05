import { Extension } from "@codemirror/state";
import { ViewPlugin, ViewUpdate } from "@codemirror/view";
import LanguageToolPlugin from "../main";
import { Notice } from "obsidian";

export function autoCheckListener(plugin: LanguageToolPlugin): Extension {
    return ViewPlugin.fromClass(class {
        private debounceTimer = -1;
        private range = { from: Infinity, to: -Infinity };

        update(update: ViewUpdate) {
            if (!update.docChanged) return;
            const settings = plugin.getActiveFileSettings(update.view);
            if (!settings.shouldAutoCheck || plugin.isFileIgnored(update.view)) {
                this.destroy();
                return;
            }
            // Each pane owns its pending range; earlier edits move with subsequent changes.
            if (Number.isFinite(this.range.from)) {
                this.range.from = update.changes.mapPos(this.range.from, -1);
                this.range.to = update.changes.mapPos(this.range.to, 1);
            }
            update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
                this.range.from = Math.min(this.range.from, fromB);
                this.range.to = Math.max(this.range.to, toB);
            });
            window.clearTimeout(this.debounceTimer);
            this.debounceTimer = window.setTimeout(() => {
                const selection = this.range;
                this.range = { from: Infinity, to: -Infinity };
                void plugin.runDetection(update.view, true, selection).catch((error: unknown) => {
                    if (Date.now() > plugin.autoCheckSuppressErrorsUntil) {
                        plugin.autoCheckSuppressErrorsUntil = Date.now() + 15 * 60_000;
                        new Notice("Auto-check failed:\n" + (error instanceof Error ? error.message : String(error)), 10000);
                    }
                    console.error("Auto-check failed", error);
                });
            }, settings.autoCheckDelay);
        }

        destroy() {
            window.clearTimeout(this.debounceTimer);
            this.range = { from: Infinity, to: -Infinity };
        }
    });
}
