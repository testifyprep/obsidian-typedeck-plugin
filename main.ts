import {
    App,
    Editor,
    MarkdownView,
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
 * Matches Typedeck's actual parser: a line of exactly three-or-more hyphens
 * surrounded by blank lines (or file boundaries).
 */
function parseSlides(content: string): string[] {
    const normalized = content.replace(/\r\n/g, '\n');
    // Split on: newline + optional whitespace + three-or-more hyphens + optional whitespace + newline
    return normalized.split(/\n[ \t]*---+[ \t]*\n/);
}

function countSlides(content: string): number {
    if (!content || !content.trim()) return 0;
    return parseSlides(content).length;
}

// MARK: - Validation

interface ValidationWarning {
    slideIndex: number;
    message: string;
    severity: 'error' | 'warning';
}

function validateTypedeck(content: string): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    // Frontmatter check: file starting with --- creates an empty first slide
    if (/^---[ \t]*\n/.test(content)) {
        warnings.push({
            slideIndex: 0,
            message:
                'File starts with frontmatter (---). Typedeck treats this as a slide delimiter, creating an empty first slide. Remove the frontmatter block.',
            severity: 'error',
        });
    }

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

        // H1 heading count
        const h1Lines = slideContent.match(/^# .+/gm) ?? [];
        if (h1Lines.length === 0) {
            warnings.push({
                slideIndex: index,
                message: `Slide ${slideNum}: Missing # H1 heading — every slide should have a title`,
                severity: 'warning',
            });
        } else if (h1Lines.length > 1) {
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
                message: `Slide ${slideNum}: Malformed speaker notes — the exact form is <!-- NOTES: ... -->  (capital NOTES, colon immediately after)`,
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
                .slice(0, -3); // strip opening and closing -->
            if (inner.includes('-->')) {
                warnings.push({
                    slideIndex: index,
                    message: `Slide ${slideNum}: Speaker notes contain "-->" which terminates the comment early — rephrase to avoid the sequence`,
                    severity: 'error',
                });
            }
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

        // Only lines that are exactly --- (three or more hyphens, optional whitespace)
        if (!/^\s*---+\s*$/.test(line.text)) continue;

        // Must be surrounded by blank lines (Typedeck's delimiter rule)
        const prevEmpty = lineNum === 1 || doc.line(lineNum - 1).text.trim() === '';
        const nextEmpty = lineNum === doc.lines || doc.line(lineNum + 1).text.trim() === '';
        if (!prevEmpty || !nextEmpty) continue;

        slideNumber++;

        // Badge widget placed before the --- text
        builder.add(
            line.from,
            line.from,
            Decoration.widget({
                widget: new SlideBreakWidget(slideNumber),
                side: -1,
            })
        );

        // Line highlight
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

/**
 * Reports the current document's slide count via a callback whenever
 * the document changes. Installed as a CodeMirror extension so it fires
 * on every keystroke without needing vault/workspace polling.
 */
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
        contentEl.createEl('h2', { text: `Typedeck: ${this.filename}` });

        if (this.warnings.length === 0) {
            const ok = contentEl.createDiv({ cls: 'typedeck-validation-ok' });
            ok.createEl('p', { text: '✓ No issues found. This file looks good for Typedeck.' });
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

        const list = contentEl.createEl('ul', { cls: 'typedeck-validation-list' });

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
        containerEl.createEl('h2', { text: 'Typedeck' });

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

        // CodeMirror extension 2: live slide count — fires on every doc change
        this.registerEditorExtension(
            makeSlideCountPlugin((count) => {
                // Only update the status bar when a Markdown view is active
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!activeView) return;
                this.setSlideCountLabel(count);
            })
        );

        // Also refresh the status bar when switching leaves (e.g. switching tabs)
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                this.refreshStatusBarFromActiveFile();
            })
        );

        // Command: Open current file in Typedeck
        this.addCommand({
            id: 'open-in-typedeck',
            name: 'Open in Typedeck',
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== 'md') return false;
                if (!checking) this.openInTypedeck(file);
                return true;
            },
        });

        // Command: Validate Typedeck format
        this.addCommand({
            id: 'validate-typedeck-format',
            name: 'Validate Typedeck format',
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== 'md') return false;
                if (!checking) this.validateCurrentFile(file);
                return true;
            },
        });

        // Command: Insert speaker notes template
        this.addCommand({
            id: 'insert-speaker-notes',
            name: 'Insert speaker notes',
            hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'n' }],
            editorCallback: (editor: Editor) => {
                this.insertSpeakerNotes(editor);
            },
        });

        this.addSettingTab(new TypedeckSettingTab(this.app, this));

        // Initial status bar state
        this.refreshStatusBarFromActiveFile();
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

    private openInTypedeck(file: TFile) {
        // Resolve the absolute file path from the vault's base path
        const adapter = this.app.vault.adapter as unknown as { basePath?: string };
        const basePath = adapter.basePath ?? '';
        const filePath = basePath ? `${basePath}/${file.path}` : file.path;

        // Single-quote-safe shell escaping
        const esc = (s: string) => s.replace(/'/g, "'\\''");
        const appName = esc(this.settings.appName);
        const absPath = esc(filePath);

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { exec } = require('child_process') as typeof import('child_process');
        exec(`open -a '${appName}' '${absPath}'`, (err) => {
            if (err) {
                new Notice(`Typedeck: failed to open file — ${err.message}`);
                console.error('[Typedeck] open error:', err);
            } else {
                new Notice(`Opened in ${this.settings.appName}`);
            }
        });
    }

    // MARK: Validate format

    private async validateCurrentFile(file: TFile) {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const content = activeView
            ? activeView.editor.getValue()
            : await this.app.vault.read(file);

        const warnings = validateTypedeck(content);
        new ValidationModal(this.app, warnings, file.name).open();
    }

    // MARK: Insert speaker notes

    private insertSpeakerNotes(editor: Editor) {
        const cursor = editor.getCursor();
        // Insert template with blank line above if not already at start of line
        const line = editor.getLine(cursor.line);
        const prefix = line.trim().length > 0 ? '\n' : '';
        const template = `${prefix}\n<!-- NOTES:\n\n-->`;

        editor.replaceRange(template, cursor);

        // Position the cursor on the blank line inside the notes block
        editor.setCursor({
            line: cursor.line + (prefix ? 3 : 2),
            ch: 0,
        });
    }
}
