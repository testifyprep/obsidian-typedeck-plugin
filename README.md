# Typedeck for Obsidian

An Obsidian community plugin for writing [Typedeck](https://typedeck.app)-compatible Markdown presentations. Write your deck in Obsidian, open it in Typedeck with one command.

## Features

### Slide delimiter visualization

`---` delimiters that separate Typedeck slides are highlighted in the editor. A small **Slide N** badge appears before each delimiter so you can see at a glance where each slide begins while writing.

The badge only fires on delimiters that follow Typedeck's rules: three hyphens on their own line, surrounded by blank lines. A horizontal rule inside a slide (which Typedeck doesn't support anyway) won't be decorated.

### Slide count in status bar

The current file's slide count is shown in Obsidian's status bar (e.g., **12 slides**). It updates live as you type — no need to count `---` delimiters by hand.

### Open in Typedeck

**Command palette → "Typedeck: Open in Typedeck"**

Opens the active Markdown file directly in Typedeck via `open -a Typedeck`. Typedeck launches (or comes to the front) and opens the file for immediate preview and presentation.

Only available when the active file is a `.md` file.

### Typedeck format validation

**Command palette → "Typedeck: Validate Typedeck format"**

Checks the active file against Typedeck's format rules and shows a modal with any issues:

| Check | Severity |
|---|---|
| File starts with frontmatter (`---`) | Error |
| Empty slide | Error |
| Multiple `# H1` headings on one slide | Error |
| Malformed `<!-- NOTES: ... -->` block | Error |
| Speaker notes containing `-->` (early termination) | Error |
| Missing `# H1` on a slide | Warning |
| More than 5 bullet points on a slide | Warning |
| Multiple speaker notes blocks on one slide | Warning |
| Code block missing language identifier | Warning |

A clean file shows a single "No issues found" message.

### Insert speaker notes

**Command palette → "Typedeck: Insert speaker notes"**  
**Default shortcut: Cmd+Shift+N (Mac) / Ctrl+Shift+N (Windows/Linux)**

Inserts the `<!-- NOTES: -->` template at the cursor, with the cursor positioned on the blank line inside the block ready to type:

```
<!-- NOTES:

-->
```

## Installation

### From the community plugin store (when published)

Search for "Typedeck" in Obsidian → Settings → Community plugins.

### Manual installation for development

```bash
# From the repo root
cd obsidian-typedeck-plugin
npm install
npm run build

# Symlink or copy into your vault's plugin folder
cp -r . ~/.obsidian/plugins/typedeck
```

Then enable the plugin in Obsidian → Settings → Community plugins.

## Building

```bash
npm install
npm run build      # production build → main.js
npm run dev        # watch mode for development
```

The build uses esbuild. All CodeMirror and Obsidian packages are marked external — they're provided by Obsidian at runtime and not bundled.

## Requirements

- **Obsidian 0.15.0+**
- **macOS** (the "Open in Typedeck" command uses `open -a`; the plugin is marked `isDesktopOnly`)
- **Typedeck** installed in `/Applications` or accessible by its app name

## Settings

**App name** — The name passed to `open -a <name>` when opening files. Defaults to `Typedeck`. Change this if your Typedeck installation has a different name (e.g., during beta testing with a renamed build).

## Typedeck Markdown format quick reference

For full details, see `docs/LLM-MARKDOWN-IMPORT-PROMPT.md` in the Typedeck repo.

```markdown
# Slide title

Slide body — paragraphs, bullets, a code block, a table, or an image.

<!-- NOTES:
Speaker notes here. Only visible in Typedeck's Presenter View.
-->

---

# Next slide

- Up to 5 bullets recommended
- Typedeck auto-detects the layout from the content

<!-- build: bullets -->
```

**Key rules:**
- No YAML frontmatter (the leading `---` becomes a slide delimiter)
- One `# H1` per slide — it becomes the slide title
- Slide delimiter: blank line · `---` · blank line
- Speaker notes: `<!-- NOTES: ... -->` at the end of the slide, one block per slide
