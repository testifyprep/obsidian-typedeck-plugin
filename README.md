# Typedeck for Obsidian

Write your presentations in Obsidian. Open them in Typedeck. Come back to tweak anytime. Nothing is lost. The plugin handles the translation between Obsidian's formatting conventions and Typedeck's Markdown format automatically — in both directions — so you can stay in your writing environment without giving up any of what Typedeck offers.

## Features

### Slide count in status bar

The current file's slide count is shown in Obsidian's status bar (e.g., **12 slides**). It updates live as you type, so you always know where you stand without counting `---` delimiters by hand.

### Slide break visualization

Each `---` slide delimiter is highlighted in the editor with a small **Slide N** badge, making it easy to see where one slide ends and the next begins while you're writing. The badge only appears on delimiters that follow Typedeck's rules — three hyphens on their own line surrounded by blank lines — so a horizontal rule inside a slide won't be decorated.

### Validate Typedeck format

**Ribbon icon · Command palette: "Typedeck: Validate Typedeck format"**

Checks the active file against Typedeck's format rules and shows a modal listing any errors and warnings. Useful before a presentation or whenever you want a quick sanity check.

### Open in Typedeck

**Ribbon icon · Command palette: "Typedeck: Open in Typedeck"**

Exports the active file as a clean `.typedeck.md` sidecar, converts Obsidian-specific syntax to standard Markdown, and opens the result directly in Typedeck. Your original `.md` file is untouched.

### Sync from Typedeck

**Ribbon icon · Command palette: "Typedeck: Sync from Typedeck"**

Pulls changes you've made in Typedeck back into your Obsidian source file, restoring Obsidian syntax (callouts, highlights, wikilinks, checkboxes) from the converted form. Content and speaker notes round-trip completely.

### Insert speaker notes

**Right-click context menu · Command palette: "Typedeck: Insert speaker notes"**  
**Default shortcut: Cmd+Shift+N (Mac) / Ctrl+Shift+N (Windows/Linux)**

Inserts a `<!-- NOTES: -->` block at the cursor with the insertion point already inside, ready to type. Only visible in Typedeck's Presenter View — never shown to your audience.

### Obsidian syntax conversion

When you export to Typedeck, the plugin automatically converts Obsidian-specific formatting to standard Markdown that Typedeck understands:

| Obsidian syntax | Converted to |
|---|---|
| YAML frontmatter | Stripped entirely |
| Callout `> [!quote] Title` | Header line removed; body kept as a blockquote |
| Highlight `==text==` | `text` |
| Wikilink `[[Page\|Label]]` | `Label` |
| Wikilink `[[Page]]` | `Page` |
| Checkbox `- [x] task` | `- ✓ task` |
| Checkbox `- [ ] task` | `- task` |

On sync, these conversions are reversed so your Obsidian file stays exactly as you wrote it.

## The Round-Trip Workflow

1. **Write in Obsidian** using any Obsidian features you want — wikilinks, callouts, highlights, frontmatter, checkboxes. The plugin's live validation and slide count work as you type.

2. **Click "Open in Typedeck"** — the plugin creates a sibling export file (`filename.typedeck.md`) in the same vault folder, converts Obsidian syntax to clean Markdown, and opens it in Typedeck. Your original file is not modified.

3. **Present or edit in Typedeck** — adjust content, add speaker notes, reorder slides, configure build animations. Typedeck saves back to the `.typedeck.md` file.

4. **Click "Sync from Typedeck"** — the plugin reads the updated `.typedeck.md`, pulls content changes back into your Obsidian source file, and restores Obsidian formatting.

**What round-trips perfectly:** slide content, speaker notes, build animations (`<!-- build: bullets -->`, `<!-- build: steps -->`), code blocks, tables, images, blockquotes.

**What lives only in Typedeck:** theme, slide transitions, layout overrides, and anything stored in Typedeck's `.typedeck` project format rather than in the Markdown file.

## Typedeck Markdown Format

Quick reference for writing slides in the format Typedeck expects.

````markdown
# Slide title

Slide body — paragraphs, bullets, a code block, a table, or an image.

<!-- NOTES:
Speaker notes here. Only visible in Typedeck's Presenter View.
-->

---

## Second slide

- Up to 5 bullets recommended
- Typedeck auto-detects the layout from the content

<!-- build: bullets -->

---

### Third slide

```swift
let greeting = "Hello, world"
```
````

**Key rules:**

- **Slide breaks:** `---` on its own line with a blank line above and below
- **Slide titles:** `# H1`, `## H2`, or `### H3` — one heading per slide
- **Speaker notes:** `<!-- NOTES: ... -->` at the end of the slide, one block per slide
- **Build animations:** `<!-- build: bullets -->` or `<!-- build: steps -->`
- **Code blocks:** always include a language identifier (e.g., ` ```swift `)
- **Bullets:** 5 per slide is the recommended maximum
- **No YAML frontmatter:** the leading `---` becomes a slide delimiter in Typedeck; the plugin strips it automatically on export

## Validation Rules

The validator checks the following and reports errors and warnings in a modal:

| Check | Severity |
|---|---|
| YAML frontmatter present (Typedeck reads the closing `---` as a slide delimiter) | Warning |
| Empty slide | Error |
| Multiple `# H1` headings on one slide | Error |
| Malformed `<!-- NOTES: ... -->` block | Error |
| Speaker notes containing `-->` (terminates the comment early) | Error |
| No heading on a slide (`#`, `##`, or `###`) | Warning |
| More than 5 bullet points on a slide | Warning |
| Multiple speaker notes blocks on one slide | Warning |
| Code block missing language identifier | Warning |
| Obsidian callout syntax (`[!quote]`, `[!note]`, etc.) | Warning |
| Obsidian highlight syntax (`==text==`) | Warning |
| Obsidian wikilinks (`[[...]]`) | Warning |
| Obsidian checkbox syntax (`- [ ]` / `- [x]`) | Warning |
| LaTeX math syntax (`$...$`, `$$...$$`) | Warning |

The last five are flagged as warnings but handled automatically when you use "Open in Typedeck." A clean file shows a single "No issues found" message.

## Installation

### From Obsidian Community Plugins (coming soon)

Search for "Typedeck" in Settings → Community Plugins → Browse.

### Manual Installation

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/testifyprep/obsidian-typedeck-plugin/releases). Copy them to your vault's `.obsidian/plugins/typedeck/` folder. Enable the plugin in Settings → Community Plugins.

## Settings

**App name** — The name passed to `open -a <name>` when opening files in Typedeck. Defaults to `Typedeck`. Change this if your installation uses a different name (for example, during beta testing with a renamed build).

## Requirements

- macOS — the "Open in Typedeck" command uses the macOS `open` command
- Typedeck installed from the Mac App Store or accessible by its app name

## Links

- Typedeck: https://typedeck.app
- GitHub: https://github.com/testifyprep/obsidian-typedeck-plugin
