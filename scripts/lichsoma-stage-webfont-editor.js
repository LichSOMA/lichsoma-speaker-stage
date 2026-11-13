/** Both editors share one controller and preserve their existing setting keys. */
export function createStageWebfontEditors(SpeakerStage) {
    class SpeakerStageWebfontCSSEditor extends LichsomaSpeakerStageCompat.ApplicationV2 {
        static settingKey = '';
        static titleKey = '';
        static savedKey = '';
        static defaultId = 'lichsoma-speaker-stage-webfont-css-editor';
    
        static DEFAULT_OPTIONS = {
            id: 'lichsoma-speaker-stage-webfont-css-editor',
            classes: ['lichsoma-speaker-stage-css-editor'],
            tag: 'div',
            window: {
                frame: true,
                positioned: true,
                title: '',
                resizable: true,
                minimizable: false,
                contentClasses: []
            },
            position: { width: 800, height: 600 }
        };
    
        editor = null;
        _resizeObserver = null;
    
        constructor(options = {}) {
            const cls = new.target;
            const baseOptions = foundry.utils.mergeObject(cls.DEFAULT_OPTIONS, {
                id: cls.defaultId,
                window: { title: cls.titleKey }
            }, { inplace: false });
            super(foundry.utils.mergeObject(baseOptions, options, { inplace: false }));
        }
    
        async _prepareContext() {
            return { css: game.settings.get(SpeakerStage.MODULE_ID, this.constructor.settingKey) || '' };
        }
    
        async _renderHTML(context) {
            const form = document.createElement('form');
            form.className = 'lichsoma-speaker-stage-css-editor-form';
            form.innerHTML = `
                <div class="form-group lichsoma-speaker-stage-css-editor-main">
                    <label>${game.i18n.localize('SPEAKERSTAGE.Settings.WebfontCSS.CodeLabel')}</label>
                    <textarea name="css" rows="20" spellcheck="false"></textarea>
                </div>
                <div class="form-group lichsoma-speaker-stage-css-editor-actions">
                    <button type="button" class="save-css"><i class="fas fa-save"></i> ${game.i18n.localize('SPEAKERSTAGE.Settings.WebfontCSS.Save')}</button>
                    <button type="button" class="cancel-css"><i class="fas fa-times"></i> ${game.i18n.localize('SPEAKERSTAGE.Settings.WebfontCSS.Cancel')}</button>
                </div>`;
            form.querySelector('textarea').value = context.css;
            return form;
        }
    
        _replaceHTML(result, content) {
            content.replaceChildren(result);
        }
    
        async _onFirstRender() {
            const form = this.element.querySelector('form.lichsoma-speaker-stage-css-editor-form');
            const textarea = form?.querySelector('textarea[name="css"]');
            if (!form || !textarea) return;
    
            const CodeMirrorClass = window.CodeMirror || CONFIG.CM?.CodeMirror;
            if (CodeMirrorClass) {
                this.editor = CodeMirrorClass.fromTextArea(textarea, {
                    mode: 'css',
                    theme: 'foundry',
                    lineNumbers: true,
                    indentUnit: 2,
                    tabSize: 2,
                    lineWrapping: true,
                    autofocus: true,
                    extraKeys: {
                        'Ctrl-S': () => void this._onSave(),
                        'Cmd-S': () => void this._onSave()
                    }
                });
                this._resizeObserver = new ResizeObserver(() => setTimeout(() => this.editor?.refresh(), 100));
                this._resizeObserver.observe(this.element);
            }
    
            form.querySelector('.save-css')?.addEventListener('click', event => {
                event.preventDefault();
                void this._onSave();
            });
            form.querySelector('.cancel-css')?.addEventListener('click', event => {
                event.preventDefault();
                void this.close();
            });
            form.addEventListener('submit', event => {
                event.preventDefault();
                void this._onSave();
            });
        }
    
        async _onClose() {
            this._resizeObserver?.disconnect();
            this._resizeObserver = null;
            if (this.editor) {
                try { this.editor.toTextArea(); } catch (_error) { /* noop */ }
                this.editor = null;
            }
        }
    
        async _onSave() {
            try {
                const css = this.editor?.getValue() ?? this.element.querySelector('textarea[name="css"]')?.value ?? '';
                await game.settings.set(SpeakerStage.MODULE_ID, this.constructor.settingKey, css);
                ui.notifications.info(game.i18n.localize(this.constructor.savedKey));
                await this.close();
            } catch (error) {
                ui.notifications.error(`${game.i18n.localize('SPEAKERSTAGE.Settings.WebfontCSS.SaveError')}: ${error.message}`);
            }
        }
    }
    
    class CharacterNameWebfontCSSEditor extends SpeakerStageWebfontCSSEditor {
        static settingKey = SpeakerStage.SETTINGS.CHARACTER_NAME_WEBFONT_CSS;
        static titleKey = 'SPEAKERSTAGE.Settings.CharacterNameWebfontCSS.Name';
        static savedKey = 'SPEAKERSTAGE.Settings.CharacterNameWebfontCSS.Saved';
        static defaultId = 'lichsoma-stage-character-name-webfont-css-editor';
    }
    
    class DialogueWebfontCSSEditor extends SpeakerStageWebfontCSSEditor {
        static settingKey = SpeakerStage.SETTINGS.DIALOGUE_WEBFONT_CSS;
        static titleKey = 'SPEAKERSTAGE.Settings.DialogueWebfontCSS.Name';
        static savedKey = 'SPEAKERSTAGE.Settings.DialogueWebfontCSS.Saved';
        static defaultId = 'lichsoma-stage-dialogue-webfont-css-editor';
    }
    return { CharacterNameWebfontCSSEditor, DialogueWebfontCSSEditor };
}
