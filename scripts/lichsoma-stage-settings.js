/** settings: methods are attached to SpeakerStage; this is the shared stage controller. */

export const stageSettingsMethods = {
    /**
     * `document.fonts` / 월드 설정에 들어간 패밀리 이름 앞뒤의 ASCII 따옴표 제거.
     * Speaker Selector(`lichsoma-speaker-selector`)와 동일한 규칙.
     */
    _normalizeFontFamilyName(name) {
        if (name == null || typeof name !== 'string') return '';
        let s = name.trim();
        while (s.length >= 2) {
            const open = s[0];
            const close = s[s.length - 1];
            if ((open === '"' && close === '"') || (open === "'" && close === "'")) {
                s = s.slice(1, -1).trim();
            } else {
                break;
            }
        }
        return s;
    },

    _stripCssComments(cssText) {
        return String(cssText ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ');
    },

    _extractPreferredWebfontBlock(cssText) {
        const css = this._stripCssComments(cssText);
        const marker = css.match(/\.(?:lichsoma-webfont-settings|lichsoma-webfont-family-marker)\s*\{([\s\S]*?)\}/i);
        return marker?.[1] || '';
    },

    _extractFirstFontDeclaration(cssText, propertyName) {
        const css = this._stripCssComments(cssText);
        const escapedProperty = String(propertyName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`${escapedProperty}\\s*:\\s*([^;}{]+)`, 'i');
        const preferredBlock = this._extractPreferredWebfontBlock(css);
        const match = (preferredBlock && preferredBlock.match(pattern)) || css.match(pattern);
        return String(match?.[1] ?? '').replace(/\s*!important\s*$/i, '').trim();
    },

    _extractFirstFontFamily(cssText) {
        const declaration = this._extractFirstFontDeclaration(cssText, 'font-family');
        if (!declaration) return '';
        return this._normalizeFontFamilyName(declaration.split(',')[0]?.trim() ?? '');
    },

    _normalizeFontWeight(value) {
        const text = String(value ?? '').trim();
        if (!text) return '';
        if (/^(?:normal|bold|bolder|lighter)$/i.test(text)) return text.toLowerCase();
        if (/^var\(.+\)$/i.test(text)) return text;
        if (/^\d{1,4}$/.test(text)) {
            const numeric = Number(text);
            return numeric >= 1 && numeric <= 1000 ? String(numeric) : '';
        }
        // @font-face의 가변 범위(예: 200 900)는 실제 요소에 적용할 단일 굵기가 아니다.
        return '';
    },

    _normalizeFontStyle(value) {
        const text = String(value ?? '').trim();
        if (!text) return '';
        if (/^(?:normal|italic)$/i.test(text)) return text.toLowerCase();
        if (/^oblique(?:\s+-?(?:\d+(?:\.\d+)?|\.\d+)(?:deg|grad|rad|turn))?$/i.test(text)) return text;
        if (/^var\(.+\)$/i.test(text)) return text;
        return '';
    },

    _normalizeFontVariationSettings(value) {
        const text = String(value ?? '').trim();
        if (!text) return '';
        if (/^normal$/i.test(text)) return 'normal';
        if (/^var\(.+\)$/i.test(text)) return text;
        if (/[{};]/.test(text)) return '';
        return text;
    },

    _extractWebfontPresentation(cssText) {
        return {
            family: this._extractFirstFontFamily(cssText),
            weight: this._normalizeFontWeight(this._extractFirstFontDeclaration(cssText, 'font-weight')),
            style: this._normalizeFontStyle(this._extractFirstFontDeclaration(cssText, 'font-style')),
            variationSettings: this._normalizeFontVariationSettings(
                this._extractFirstFontDeclaration(cssText, 'font-variation-settings')
            )
        };
    },

    _escapeCssString(value) {
        return String(value ?? '')
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, ' ');
    },

    _quoteFontFamily(font) {
        const normalized = this._normalizeFontFamilyName(font);
        return normalized ? `"${this._escapeCssString(normalized)}"` : '';
    },

    _buildWebfontOverrideCSS(selector, profile) {
        const declarations = [];
        if (profile?.family) declarations.push(`font-family: ${this._quoteFontFamily(profile.family)}, sans-serif !important`);
        if (profile?.weight) declarations.push(`font-weight: ${profile.weight} !important`);
        if (profile?.style) declarations.push(`font-style: ${profile.style} !important`);
        if (profile?.variationSettings) declarations.push(`font-variation-settings: ${profile.variationSettings} !important`);
        if (!declarations.length) return '';
        return `${selector} {\n    ${declarations.join(';\n    ')};\n}`;
    },

    _isOwnSettingDocument(setting) {
        if (!setting) return false;
        const namespace = setting.namespace ?? setting.parent?.namespace ?? '';
        const rawKey = String(setting.key ?? setting._id ?? setting.id ?? setting.name ?? '');
        return namespace === this.MODULE_ID || rawKey.startsWith(`${this.MODULE_ID}.`);
    },

    _getSettingDocumentKey(setting) {
        const rawKey = String(setting?.key ?? setting?._id ?? setting?.id ?? setting?.name ?? '');
        if (rawKey.startsWith(`${this.MODULE_ID}.`)) return rawKey.slice(this.MODULE_ID.length + 1);
        return rawKey;
    },

    /** 월드 설정 변경 (스테이지 중앙 제어) */
    _onWorldSettingChanged(setting) {
        if (!setting) return;
        const ns = setting.namespace ?? setting.parent?.namespace;
        const k = setting.key;
        if (ns !== this.MODULE_ID || k !== 'stageCentralControl') return;
        if (game.user?.isGM) return;
        if (game.settings.get(this.MODULE_ID, 'stageCentralControl')) {
            this._requestStageSync();
        }
        this._renderPlayerStageToggle($(document));
    },

    // 설정 등록
    registerSettings() {
        game.settings.registerMenu(this.MODULE_ID, 'characterNameWebfontCSSMenu', {
            name: game.i18n.localize('SPEAKERSTAGE.Settings.CharacterNameWebfontCSS.Name'),
            label: game.i18n.localize('SPEAKERSTAGE.Settings.CharacterNameWebfontCSS.EditButton'),
            hint: game.i18n.localize('SPEAKERSTAGE.Settings.CharacterNameWebfontCSS.Hint'),
            icon: 'fas fa-heading',
            type: this.applications.CharacterNameWebfontCSSEditor,
            restricted: true
        });

        game.settings.register(this.MODULE_ID, this.SETTINGS.CHARACTER_NAME_WEBFONT_CSS, {
            name: game.i18n.localize('SPEAKERSTAGE.Settings.CharacterNameWebfontCSS.Name'),
            hint: game.i18n.localize('SPEAKERSTAGE.Settings.CharacterNameWebfontCSS.Hint'),
            scope: 'world',
            config: false,
            restricted: true,
            type: String,
            default: '',
            onChange: value => this._updateCharacterNameWebfontCSS(value)
        });

        // 2. 캐릭터 이름 폰트 크기
        game.settings.register(this.MODULE_ID, 'characterNameFontSize', {
            name: '캐릭터 이름 폰트 크기',
            hint: '캐릭터 이름의 폰트 크기를 설정합니다. (GM만 설정 가능)',
            scope: 'world',
            config: true,
            restricted: true,
            type: Number,
            default: 36,
            range: {
                min: 32,
                max: 50,
                step: 1
            },
            onChange: value => {
                this._updateCharacterNameFontSize(value);
            }
        });

        game.settings.registerMenu(this.MODULE_ID, 'dialogueWebfontCSSMenu', {
            name: game.i18n.localize('SPEAKERSTAGE.Settings.DialogueWebfontCSS.Name'),
            label: game.i18n.localize('SPEAKERSTAGE.Settings.DialogueWebfontCSS.EditButton'),
            hint: game.i18n.localize('SPEAKERSTAGE.Settings.DialogueWebfontCSS.Hint'),
            icon: 'fas fa-comment-dots',
            type: this.applications.DialogueWebfontCSSEditor,
            restricted: true
        });

        game.settings.register(this.MODULE_ID, this.SETTINGS.DIALOGUE_WEBFONT_CSS, {
            name: game.i18n.localize('SPEAKERSTAGE.Settings.DialogueWebfontCSS.Name'),
            hint: game.i18n.localize('SPEAKERSTAGE.Settings.DialogueWebfontCSS.Hint'),
            scope: 'world',
            config: false,
            restricted: true,
            type: String,
            default: '',
            onChange: value => this._updateDialogueWebfontCSS(value)
        });

        // 4. 대화창 폰트 크기
        game.settings.register(this.MODULE_ID, 'dialogueFontSize', {
            name: '대화창 폰트 크기',
            hint: '대화창의 텍스트 폰트 크기를 설정합니다. (GM만 설정 가능)',
            scope: 'world',
            config: true,
            restricted: true,
            type: Number,
            default: 24,
            range: {
                min: 12,
                max: 36,
                step: 1
            },
            onChange: value => {
                this._updateDialogueFontSize(value);
            }
        });

        // 5. 대화창 타이핑 속도
        game.settings.register(this.MODULE_ID, 'typingSpeed', {
            name: '대화창 타이핑 속도',
            hint: '한 글자당 표시 시간 (밀리초). 낮을수록 빠릅니다. (GM만 설정 가능)',
            scope: 'world',
            config: true,
            restricted: true,
            type: Number,
            default: 100,
            range: {
                min: 50,
                max: 150,
                step: 10
            }
        });

        // 6. 대화창 텍스트 제거 딜레이
        game.settings.register(this.MODULE_ID, 'textClearDelay', {
            name: '대화창 텍스트 제거 딜레이',
            hint: '타이핑 완료 후 텍스트가 자동으로 제거되기까지의 시간(초). 0이면 자동 제거되지 않습니다. (GM만 설정 가능)',
            scope: 'world',
            config: true,
            restricted: true,
            type: Number,
            default: 0,
            range: {
                min: 0,
                max: 30,
                step: 1
            }
        });

        // 7. 타이핑 사운드
        game.settings.register(this.MODULE_ID, 'typingSoundPath', {
            name: '타이핑 사운드',
            hint: '글자가 입력될 때 재생할 사운드 파일을 선택합니다. 비워두면 사운드가 재생되지 않습니다. (GM만 설정 가능)',
            scope: 'world',
            config: true,
            restricted: true,
            type: String,
            filePicker: 'audio',
            default: ''
        });

        // 8. 타이핑 사운드 볼륨
        game.settings.register(this.MODULE_ID, 'typingSoundVolume', {
            name: '타이핑 사운드 볼륨',
            hint: '타이핑 사운드의 볼륨을 조절합니다. (GM만 설정 가능)',
            scope: 'world',
            config: true,
            restricted: true,
            type: Number,
            default: 0.5,
            range: {
                min: 0,
                max: 1,
                step: 0.1
            }
        });

        // 9. 스테이지 중앙 제어 (GM이 스테이지 표시를 켜면 모든 클라이언트에 표시)
        game.settings.register(this.MODULE_ID, 'stageCentralControl', {
            name: game.i18n.localize('SPEAKERSTAGE.Settings.StageCentralControl.Name'),
            hint: game.i18n.localize('SPEAKERSTAGE.Settings.StageCentralControl.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Boolean,
            default: false,
            onChange: () => {
                if (game.user?.isGM) {
                    this._broadcastGMStageState();
                }
            }
        });

        game.settings.register(this.MODULE_ID, 'disablePlayerStage', {
            name: game.i18n.localize('SPEAKERSTAGE.Settings.DisablePlayerStage.Name'),
            hint: game.i18n.localize('SPEAKERSTAGE.Settings.DisablePlayerStage.Hint'),
            scope: 'world',
            config: true,
            restricted: true,
            type: Boolean,
            default: false,
            onChange: () => this._refreshPlayerStagePolicy()
        });

        // 10. 스탠딩 모드
        game.settings.register(this.MODULE_ID, 'useStanding', {
            name: game.i18n.localize('SPEAKERSTAGE.Settings.UseStanding.Name') || '스탠딩 사용',
            hint: game.i18n.localize('SPEAKERSTAGE.Settings.UseStanding.Hint') || '켜면 액터별 스탠딩 이미지를 사용합니다. 끄거나 이미지가 없으면 포트레잇을 사용하며, GM/PL 배치와 진영별 공유 대화창은 동일하게 유지됩니다.',
            scope: 'world',
            config: true,
            restricted: true,
            type: Boolean,
            default: false,
            onChange: () => {
                this._refreshStandingMode();
            }
        });
    },

    /** 월드 설정 — GM 스테이지 표시가 모든 클라이언트에 강제 동기화 */
    isStageCentralControlEnabled() {
        try {
            return !!game.settings.get(this.MODULE_ID, 'stageCentralControl');
        } catch {
            return false;
        }
    },

    isPlayerStageDisabled() {
        try {
            return !!game.settings.get(this.MODULE_ID, 'disablePlayerStage');
        } catch {
            return false;
        }
    },

    _refreshPlayerStagePolicy() {
        if (this.isPlayerStageDisabled()) {
            for (const [actorId, data] of this._activeActors) {
                if (!this._isPlayerStandingActorData(data)) continue;
                const placementId = this._getStagePlacementId(actorId, data);
                this._rememberStageRetirement(actorId, placementId, data.userId);
                this._clearTypingEffectsForActor(actorId);
                this._clearStandingFocusForActor(actorId);
                this._activeActors.delete(actorId);
                this._pendingStageChat.delete(actorId);
                // Every client applies the world policy; only the primary GM
                // publishes retirements for clients still processing the setting.
                if (this._isPrimaryGM()) this._emitStagePacket({
                    action: 'removeStageActor', actorId, placementId, ownerUserId: data.userId
                });
            }
            this._pendingStageFocus.delete('player');
            $(document).find('.player-actor-toggle-btn').remove();
        }
        this._updateStageOverlay();
        this._syncStageRemovalControls();
        if (game.user?.isGM) this._renderBackstage($(document));
        else this._renderPlayerStageToggle($(document));
    },

    isStandingEnabled() {
        try {
            return !!game.settings.get(this.MODULE_ID, 'useStanding');
        } catch {
            return false;
        }
    },

    _updateDialogueWebfontCSS(cssText) {
        document.getElementById('lichsoma-stage-dialogue-webfont')?.remove();
        const css = String(cssText ?? '').trim();
        const profile = this._extractWebfontPresentation(css);
        const overrideCSS = this._buildWebfontOverrideCSS('#lichsoma-stage-overlay .dialogue-content', profile);
        if (!css && !overrideCSS) return;

        const style = document.createElement('style');
        style.id = 'lichsoma-stage-dialogue-webfont';
        style.textContent = [css, overrideCSS].filter(Boolean).join('\n\n');
        document.head.appendChild(style);
    },

    // 다이얼로그 폰트 크기 업데이트
    _updateDialogueFontSize(size) {
        document.getElementById('lichsoma-stage-dialogue-font-size')?.remove();
        const newStyle = document.createElement('style');
        newStyle.id = 'lichsoma-stage-dialogue-font-size';
        newStyle.textContent = `#lichsoma-stage-overlay .dialogue-content { font-size: ${size}px !important; }`;
        document.head.appendChild(newStyle);
    },

    _updateCharacterNameWebfontCSS(cssText) {
        document.getElementById('lichsoma-stage-character-name-webfont')?.remove();
        const css = String(cssText ?? '').trim();
        const profile = this._extractWebfontPresentation(css);
        const overrideCSS = this._buildWebfontOverrideCSS('#lichsoma-stage-overlay :is(.character-name, .stage-standing-dialogue-name)', profile);
        if (!css && !overrideCSS) return;

        const style = document.createElement('style');
        style.id = 'lichsoma-stage-character-name-webfont';
        style.textContent = [css, overrideCSS].filter(Boolean).join('\n\n');
        document.head.appendChild(style);
    },

    // 캐릭터 이름 폰트 크기 업데이트
    _updateCharacterNameFontSize(size) {
        document.getElementById('lichsoma-stage-character-name-font-size')?.remove();
        const newStyle = document.createElement('style');
        newStyle.id = 'lichsoma-stage-character-name-font-size';
        newStyle.textContent = `#lichsoma-stage-overlay :is(.character-name, .stage-standing-dialogue-name) { font-size: ${size}px !important; }`;
        document.head.appendChild(newStyle);
    },
};
