import { exec } from 'child_process';
import {
    App,
    Editor,
    MarkdownView,
    Menu,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
} from 'obsidian';
import {
    Decoration,
    DecorationSet,
    EditorView,
    ViewPlugin,
    ViewUpdate,
    WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

// MARK: - Interfaces

interface TypedeckSettings {
    appName: string;
}

const DEFAULT_SETTINGS: TypedeckSettings = {
    appName: 'Typedeck',
};

// MARK: - Slide parsing

/**
 * Splits a Markdown document into slide strings on `---` delimiters.
 * Matches Typedeck's actual parser: a line of three-or-more hyphens
 * surrounded by blank lines (or file boundaries).
 */
function parseSlides(content: string): string[] {
    const normalized = content.replace(/\r\n/g, '\n');
    return normalized.split(/\n[ \t]*---+[ \t]*\n/);
}

function countSlides(content: string): number {
    if (!content || !content.trim()) return 0;
    return parseSlides(content).length;
}

/**
 * Strips YAML frontmatter from content if present, returning the body only.
 */
function stripFrontmatter(content: string): string {
    const normalized = content.replace(/\r\n/g, '\n');
    const match = normalized.match(/^---[ \t]*\n[\s\S]*?\n---[ \t]*\n?/);
    return match ? normalized.slice(match[0].length) : normalized;
}

/**
 * Converts Obsidian-specific Markdown syntax to standard Markdown that
 * Typedeck understands. Applied to the export file created by "Open in Typedeck".
 *
 * Conversions:
 *   Frontmatter     stripped entirely
 *   Callouts        > [!quote] Title   → header line removed, body kept as blockquote
 *   Highlights      ==text==            → text
 *   Wikilinks       [[Page|Label]]      → Label
 *                   [[Page]]            → Page
 *   Checkboxes      - [x] task          → - ✓ task
 *                   - [ ] task          → - task
 */
function prepareForTypedeck(content: string): string {
    let result = stripFrontmatter(content);

    // Callouts: remove the > [!type] Title header line; remaining > lines stay as blockquotes
    result = result.replace(/^>[ \t]*\[![\w-]+\][^\n]*\n?/gm, '');

    // Highlights: ==text== → text
    result = result.replace(/==([^=\n]+)==/g, '$1');

    // Wikilinks with display text: [[Page|Label]] → Label
    result = result.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');

    // Plain wikilinks: [[Page]] → Page
    result = result.replace(/\[\[([^\]]+)\]\]/g, '$1');

    // Checkboxes: - [x] → - ✓,  - [ ] → -
    result = result.replace(/^([ \t]*- )\[x\] /gm, '$1✓ ');
    result = result.replace(/^([ \t]*- )\[ \] /gm, '$1');

    return result;
}

// MARK: - Validation

interface ValidationWarning {
    slideIndex: number;
    message: string;
    severity: 'error' | 'warning';
}

function validateTypedeck(content: string): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];
    const slides = parseSlides(content);

    slides.forEach((slideRaw, index) => {
        const slideNum = index + 1;

        // Strip speaker notes and build directives before content analysis
        const slideContent = slideRaw
            .replace(/<!--\s*NOTES:[\s\S]*?-->/g, '')
            .replace(/<!--\s*build:[^-]*-->/g, '')
            .trim();

        // Empty slide
        if (slideContent.length === 0) {
            warnings.push({
                slideIndex: index,
                message: `Slide ${slideNum}: Empty slide — Typedeck will warn about this`,
                severity: 'error',
            });
            return;
        }

        // Heading check — H1, H2, or H3 all count as a valid slide title
        const headingLines = slideContent.match(/^#{1,3} .+/gm) ?? [];
        if (headingLines.length === 0) {
            warnings.push({
                slideIndex: index,
                message: `Slide ${slideNum}: No heading — every slide should have a title (# H1, ## H2, or ### H3)`,
                severity: 'warning',
            });
        }
        // Still warn about multiple H1s
        const h1Lines = slideContent.match(/^# .+/gm) ?? [];
        if (h1Lines.length > 1) {
            warnings.push({
                slideIndex: index,
                message: `Slide ${slideNum}: ${h1Lines.length} # H1 headings — use only one per slide`,
                severity: 'error',
            });
        }

        // Bullet count (Typedeck warns above 5)
        const bullets = slideContent.match(/^[ \t]*[-*+] .+/gm) ?? [];
        if (bullets.length > 5) {
            warnings.push({
                slideIndex: index,
                message: `Slide ${slideNum}: ${bullets.length} bullet points — Typedeck warns above 5; consider splitting this slide`,
                severity: 'warning',
            });
        }

        // Code blocks without a language identifier
        const codeBlocks = [...slideContent.matchAll(/^```([^\n]*)\n/gm)];
        for (const match of codeBlocks) {
            if (!match[1] || !match[1].trim()) {
                warnings.push({
                    slideIndex: index,
                    message: `Slide ${slideNum}: Code block missing language identifier (e.g. \`\`\`swift)`,
                    severity: 'warning',
                });
            }
        }

        // Speaker notes: detect any <!-- ... NOTES ... --> variant
        const notesAnywhere = [...slideRaw.matchAll(/<!--[^>]*NOTES[^>]*-->/gis)];
        const correctNotes = [...slideRaw.matchAll(/<!--\s*NOTES:[\s\S]*?-->/g)];

        if (notesAnywhere.length > correctNotes.length) {
            warnings.push({
                slideIndex: index,
                message: `Slide ${slideNum}: Malformed speaker notes — the exact form is <!-- NOTES: ... --> (capital NOTES, colon immediately after)`,
                severity: 'error',
            });
        }

        if (correctNotes.length > 1) {
            warnings.push({
                slideIndex: index,
                message: `Slide ${slideNum}: ${correctNotes.length} speaker notes blocks — only the first is read by Typedeck`,
                severity: 'warning',
            });
        }

        // Speaker notes must not contain --> (would terminate the comment early)
        for (const match of correctNotes) {
            const inner = match[0]
                .replace(/^<!--\s*NOTES:\s*/, '')
                .slice(0, -3);
            if (inner.includes('-->')) {
                warnings.push({
                    slideIndex: index,
                    message: `Slide ${slideNum}: Speaker notes contain "-->" which terminates the comment early — rephrase to avoid the sequence`,
                    severity: 'error',
                });
            }
        }

        // LaTeX/math: $$ display blocks are unambiguous; $...$ inline avoids plain dollar amounts
        if (/\$\$[\s\S]*?\$\$|\$[^\d\s$][^$\n]*\$/.test(slideRaw)) {
            warnings.push({
                slideIndex: index,
                message: `Slide ${slideNum}: LaTeX equation syntax detected — Typedeck does not currently support math rendering`,
                severity: 'warning',
            });
        }
    });

    return warnings;
}

// MARK: - CodeMirror: slide-break badge widget

class SlideBreakWidget extends WidgetType {
    constructor(private readonly slideNumber: number) {
        super();
    }

    toDOM(_view: EditorView): HTMLElement {
        const el = document.createElement('span');
        el.className = 'typedeck-slide-break-badge';
        el.textContent = `Slide ${this.slideNumber}`;
        el.setAttribute('aria-label', `Slide ${this.slideNumber} starts after this delimiter`);
        return el;
    }

    eq(other: WidgetType): boolean {
        return other instanceof SlideBreakWidget && other.slideNumber === this.slideNumber;
    }

    ignoreEvent(): boolean {
        return true;
    }
}

function buildSlideDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = view.state.doc;

    let slideNumber = 1;

    for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
        const line = doc.line(lineNum);

        if (!/^\s*---+\s*$/.test(line.text)) continue;

        const prevEmpty = lineNum === 1 || doc.line(lineNum - 1).text.trim() === '';
        const nextEmpty = lineNum === doc.lines || doc.line(lineNum + 1).text.trim() === '';
        if (!prevEmpty || !nextEmpty) continue;

        slideNumber++;

        builder.add(
            line.from,
            line.from,
            Decoration.widget({
                widget: new SlideBreakWidget(slideNumber),
                side: -1,
            })
        );

        builder.add(
            line.from,
            line.from,
            Decoration.line({ class: 'typedeck-slide-delimiter-line' })
        );
    }

    return builder.finish();
}

const slideDecorationsPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = buildSlideDecorations(view);
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) {
                this.decorations = buildSlideDecorations(update.view);
            }
        }
    },
    { decorations: (v) => v.decorations }
);

// MARK: - Slide count ViewPlugin

function makeSlideCountPlugin(onCount: (count: number) => void) {
    return ViewPlugin.fromClass(
        class {
            constructor(view: EditorView) {
                onCount(countSlides(view.state.doc.toString()));
            }

            update(update: ViewUpdate) {
                if (update.docChanged) {
                    onCount(countSlides(update.view.state.doc.toString()));
                }
            }
        }
    );
}

// MARK: - Validation modal

class ValidationModal extends Modal {
    constructor(
        app: App,
        private readonly warnings: ValidationWarning[],
        private readonly filename: string
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: `Validation: ${this.filename}` });

        if (this.warnings.length === 0) {
            const ok = contentEl.createDiv({ cls: 'typedeck-validation-ok' });
            ok.createEl('p', { text: '✓ No issues found, and the file looks good.' });
            return;
        }

        const errorCount = this.warnings.filter((w) => w.severity === 'error').length;
        const warnCount = this.warnings.filter((w) => w.severity === 'warning').length;
        const parts: string[] = [];
        if (errorCount > 0) parts.push(`${errorCount} error${errorCount !== 1 ? 's' : ''}`);
        if (warnCount > 0) parts.push(`${warnCount} warning${warnCount !== 1 ? 's' : ''}`);

        contentEl.createEl('p', {
            cls: 'typedeck-validation-summary',
            text: parts.join(', '),
        });

        // Scrollable wrapper so long lists don't overflow the modal
        const scrollWrap = contentEl.createDiv({ cls: 'typedeck-validation-scroll' });
        const list = scrollWrap.createEl('ul', { cls: 'typedeck-validation-list' });

        for (const warning of this.warnings) {
            const li = list.createEl('li', {
                cls: `typedeck-validation-item typedeck-${warning.severity}`,
            });
            li.createEl('span', {
                cls: 'typedeck-validation-icon',
                text: warning.severity === 'error' ? '✕' : '⚠',
            });
            li.createEl('span', {
                cls: 'typedeck-validation-message',
                text: warning.message,
            });
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

// MARK: - Settings tab

class TypedeckSettingTab extends PluginSettingTab {
    constructor(app: App, private readonly plugin: TypedeckPlugin) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        new Setting(containerEl)
            .setName('App name')
            .setDesc(
                'The macOS application name passed to "open -a <name>" when opening files in Typedeck. Change this if Typedeck is installed under a different name.'
            )
            .addText((text) =>
                text
                    .setPlaceholder('Typedeck')
                    .setValue(this.plugin.settings.appName)
                    .onChange(async (value) => {
                        this.plugin.settings.appName = value.trim() || 'Typedeck';
                        await this.plugin.saveSettings();
                    })
            );
    }
}

// MARK: - Main plugin

export default class TypedeckPlugin extends Plugin {
    settings!: TypedeckSettings;
    private statusBarItem!: HTMLElement;

    async onload() {
        await this.loadSettings();

        // Status bar element
        this.statusBarItem = this.addStatusBarItem();
        this.statusBarItem.addClass('typedeck-status-bar');

        // CodeMirror extension 1: slide-break visualization
        this.registerEditorExtension(slideDecorationsPlugin);

        // CodeMirror extension 2: live slide count
        this.registerEditorExtension(
            makeSlideCountPlugin((count) => {
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!activeView) return;
                this.setSlideCountLabel(count);
            })
        );

        // Refresh status bar when switching tabs
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                void this.refreshStatusBarFromActiveFile();
            })
        );

        // Ribbon icon: Export and open in Typedeck
        this.addRibbonIcon('monitor-play', 'Export and open in app', () => {
            const file = this.app.workspace.getActiveFile();
            if (!file || file.extension !== 'md') {
                new Notice('Open a Markdown file first');
                return;
            }
            void this.openInTypedeck(file);
        });

        // Ribbon icon: Validate slide format
        this.addRibbonIcon('check-circle', 'Validate slide format', () => {
            const file = this.app.workspace.getActiveFile();
            if (!file || file.extension !== 'md') {
                new Notice('Open a Markdown file first');
                return;
            }
            void this.validateCurrentFile(file);
        });

        // Editor right-click context menu: Insert speaker notes
        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
                menu.addItem((item) =>
                    item
                        .setTitle('Insert speaker notes')
                        .setIcon('message-square')
                        .onClick(() => this.insertSpeakerNotes(editor))
                );
            })
        );

        // Command: Open current file in Typedeck
        this.addCommand({
            id: 'export-and-open',
            name: 'Export and open in app',
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== 'md') return false;
                if (!checking) { void this.openInTypedeck(file); }
                return true;
            },
        });

        // Command: Validate slide format
        this.addCommand({
            id: 'validate-format',
            name: 'Validate slide format',
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== 'md') return false;
                if (!checking) { void this.validateCurrentFile(file); }
                return true;
            },
        });

        // Command: Insert speaker notes template
        this.addCommand({
            id: 'insert-speaker-notes',
            name: 'Insert speaker notes',
            editorCallback: (editor: Editor) => {
                this.insertSpeakerNotes(editor);
            },
        });

        this.addSettingTab(new TypedeckSettingTab(this.app, this));

        void this.refreshStatusBarFromActiveFile();
    }

    onunload() {
        // Obsidian handles cleanup of registered events and extensions
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // MARK: Status bar

    private setSlideCountLabel(count: number) {
        const label = count === 1 ? '1 slide' : `${count} slides`;
        this.statusBarItem.setText(label);
        this.statusBarItem.setAttribute('title', `${label} (Typedeck)`);
    }

    private async refreshStatusBarFromActiveFile() {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') {
            this.statusBarItem.setText('');
            return;
        }

        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const content = activeView
            ? activeView.editor.getValue()
            : await this.app.vault.read(file);

        this.setSlideCountLabel(countSlides(content));
    }

    // MARK: Open in Typedeck

    private async openInTypedeck(file: TFile) {
        const adapter = this.app.vault.adapter as unknown as { basePath?: string };
        const basePath = adapter.basePath ?? '';

        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const content = activeView
            ? activeView.editor.getValue()
            : await this.app.vault.read(file);

        // Convert Obsidian-specific syntax to plain Markdown Typedeck understands
        const converted = prepareForTypedeck(content);

        // Write a sibling export file (<basename>.typedeck.md) in the same vault
        // directory. This keeps the file inside the vault so Obsidian indexes it
        // and Typedeck can save back to a real path.
        const dir = file.parent ? file.parent.path : '';
        const baseName = file.name.replace(/\.md$/, '');
        const exportVaultPath = dir ? `${dir}/${baseName}.typedeck.md` : `${baseName}.typedeck.md`;

        const existingExport = this.app.vault.getAbstractFileByPath(exportVaultPath);
        if (existingExport instanceof TFile) {
            await this.app.vault.modify(existingExport, converted);
        } else {
            await this.app.vault.create(exportVaultPath, converted);
        }

        const absExportPath = basePath ? `${basePath}/${exportVaultPath}` : exportVaultPath;

        const esc = (s: string) => s.replace(/'/g, "'\\''");
        exec(`open -a '${esc(this.settings.appName)}' '${esc(absExportPath)}'`, (err) => {
            if (err) {
                new Notice(`Failed to open file — ${err.message}`);
                console.error('[Typedeck] open error:', err);
            } else {
                new Notice(`Opened ${baseName}.typedeck.md in ${this.settings.appName}`);
            }
        });
    }

    // MARK: Validate format

    private async validateCurrentFile(file: TFile) {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const rawContent = activeView
            ? activeView.editor.getValue()
            : await this.app.vault.read(file);

        // Validate what Typedeck will actually receive after Obsidian-specific
        // syntax is converted — frontmatter stripped, callouts → blockquotes, etc.
        const content = prepareForTypedeck(rawContent);
        const warnings = validateTypedeck(content);
        new ValidationModal(this.app, warnings, file.name).open();
    }

    // MARK: Insert speaker notes

    private insertSpeakerNotes(editor: Editor) {
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        const prefix = line.trim().length > 0 ? '\n' : '';
        const template = `${prefix}\n<!-- NOTES:\n\n-->`;

        editor.replaceRange(template, cursor);

        editor.setCursor({
            line: cursor.line + (prefix ? 3 : 2),
            ch: 0,
        });
    }
}
