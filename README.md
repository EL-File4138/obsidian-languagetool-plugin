# Obsidian LanguageTool Plugin

This plugin for [Obsidian.md](https://obsidian.md) integrates [LanguageTool](https://languagetool.org/) to provide advanced grammar and spellchecking.

<img src="demos/image.png" style="border:1px solid black" />

> This fork combines [Wrenger's LanguageTool plugin](https://github.com/wrenger/obsidian-languagetool) with changes from the original [obsidian-languagetool-plugin](https://github.com/Clemens-E/obsidian-languagetool-plugin) and local additions:
>
> - Support for synonyms and mother tongue
> - Tooltip button for disabling rules
> - Note-specific settings
> - Allowed detected languages and next/previous suggestion navigation
> - Clean up the codebase, and fix multiple bugs and freezes

**Note:** if you are worried about the privacy of your notes, you should self-host LanguageTool locally on your PC or on a server.
If you decide to self-host the service, you must change the link in the configuration accordingly.

## Installation

1. In Obsidian, under Settings / Community plugins, turn off "Safe mode" (read the safety warning).
2. Click the Browse button for Community plugins.
3. In the top-left search field, search for "LanguageTool". Click the Install button.
4. After the installation is successful, click Enable to enable the plugin.

## Setting Up & Use Case

After installing and enabling the plugin, you can set up hotkeys (under Settings / Hotkeys), which can be found under the description "LanguageTool" through the Filter search field, to find specific hotkey functions quicker. Ensure no conflict exists with existing hotkeys and the spellcheck function within Obsidian if enabled (`Settings / Editor / Spellcheck ON/OFF`).

- **"Check Text"** checks the whole document in view if no text is selected. If you want to check only a word, sentence, or paragraph, select the text of choice and press the keyboard shortcut you have previously set. Click on the red underlined word that LanguageTool identified as a possible spelling mistake to get corrective suggestions in a popover window, with the option to add the word to a personal dictionary.
- **"Clear Suggestions"** clears the document or selected text of all red underlines from words or passages that were not corrected or changed.
- **"Toggle Automatic Checking"** toggles ON/OFF the automatic spellchecking function as you write or change the document's contents.
- **"Toggle automatic checking for current document"** saves an override in the note's frontmatter. Toggling back to the global behavior removes the override.
- **"Jump to next suggestion"** and **"Jump to previous suggestion"** select and scroll to a suggestion.
- **"Ignore current suggestion"** ignores the same text and rule for the rest of the session.

Enable **Ribbon icon** in settings for a manual-check button on desktop or mobile. Press `Escape` to close a suggestion tooltip without removing the underline.

**LanguageTool tries to auto-detect the language used.** Selecting a specific language (under `Settings / LanguageTool / Static language`) usually is not necessary. This feature enables the user to spellcheck in different languages within the same document (e.g., a dissertation written in English with quotes in a foreign language), which is ordinarily not possible with the built-in spellcheck function of Obsidian.

**Custom Spellchecker Dictionary:** Words added from suggestions go into both the plugin dictionary and Obsidian's spellcheck dictionary. The confirmation offers an undo. LanguageTool Premium dictionary synchronization remains optional. Manage the plugin dictionary under `Settings / LanguageTool / Spellcheck dictionary`; Obsidian dictionary entries are managed separately.

API keys are migrated from older plaintext settings into Obsidian SecretStorage. Secrets are device-local and do not sync, so configure the key separately on each device. Version 1.6.1 requires Obsidian 1.13.6 or newer for the declarative settings interface.

## Note-Specific Configuration

You can overwrite various configuration options in notes.
This allows you to customize LanguageTool for a specific note.
The following settings can be in the note's properties:

```md
---
lt-language: en-US     # language code or "auto"
lt-possibleLanguages:  # allowed detected languages; ignored with a static language
  - en
  - de
lt-picky: true         # provide more style suggestions
lt-autocheck: true     # check as you type
lt-dictionary:         # ignored words for this note
  - foo
  - bar
lt-disabledRules:      # ignored rules
  - ARROWS
lt-disabledCategories: # ignored categories
  - STYLE
---

# Some Note...
```

The existing `lt-autoCheck`, `lt_language`, and `lt_possibleLanguages` keys remain supported. Language pins also accept `language` or `lang`; `lt-language` takes precedence. Set `lt-language: auto` to override a globally fixed language. Allowed languages accept a YAML list or a comma-separated string.

To exclude a note from both manual and automatic checks, add the exact frontmatter tag `lt-ignore`:

```yaml
tags:
  - lt-ignore
```

Automatic-check delays are constrained by the endpoint: at least 3000 ms for public, 750 ms for premium, or 50 ms for custom servers.

## Premium Accounts

We support LanguageTool Premium.

> ⚠️ Please report any bugs, issues, or suggestions related to this plugin to us (this GitHub repository) directly and **_not_** to LanguageTool, as this is an unofficial community plugin.

You (obviously) need a premium account and an API key to use the premium features.
You can generate your API key at <https://languagetool.org/editor/settings/access-tokens>

Configure your email, API key, and the new URL (https://api.languagetoolplus.com) in the plugin settings

## Preferred languages

Under **Language → Preferred languages**, select multiple languages to favor during automatic detection. These are hints, not a restriction: other languages may still be detected. Static language selection takes precedence; regional spelling remains controlled by **Language varieties**. Detection bias depends on the server's language-detection setup (for example, fastText).

**Language → Allowed detected languages** instead filters suggestions after detection. Leave it empty to allow all languages. Regional codes with the same base language are accepted, and a static language bypasses the filter.

## Tests

- `bun test` and `bun run test` run unit tests and real-server integration tests together.
- `bun run test:unit` runs only unit tests, without Java or network access.
- `bun run test:integration` requires Java 21+, `curl`, and `unzip`. On the first run it downloads the latest LanguageTool snapshot (roughly 263 MB) into ignored `resources/`, then starts a temporary local server and shuts it down after testing. Later runs reuse the cached download. Delete `resources/LanguageTool-latest-snapshot.zip` and `resources/languagetool-integration-server/` to fetch a newer snapshot.

## Manually Installing the Plugin

- Run `bun install` and `bun run build` in the root directory of the repository.
- Copy over `main.js`, `styles.css`, `manifest.json` from the latest release to your vault `VaultFolder/.obsidian/plugins/languagetool/`.
