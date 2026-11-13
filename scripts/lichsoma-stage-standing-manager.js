/** Inject the shared controller without importing the entry point back. */
export function createStandingManagerApp(SpeakerStage) {
    class LichsomaStandingManagerApp extends LichsomaSpeakerStageCompat.ApplicationV2 {
        static DEFAULT_OPTIONS = {
            id: 'lichsoma-standing-manager',
            classes: ['lichsoma-standing-manager-app'],
            tag: 'div',
            position: {
                width: 680,
                height: 560
            },
            window: {
                frame: true,
                positioned: true,
                title: '스탠딩 관리',
                resizable: true,
                minimizable: false,
                contentClasses: ['lichsoma-standing-manager-window-content']
            }
        };
    
        constructor(options = {}) {
            const actor = options.actor;
            if (!actor) throw new Error('LichsomaStandingManagerApp requires an actor');
            const { actor: _actor, ...rest } = options;
            const manageLabel = game.i18n.localize('SPEAKERSTAGE.Standing.Manage') || '스탠딩 관리';
            const base = foundry.utils.mergeObject(LichsomaStandingManagerApp.DEFAULT_OPTIONS, rest);
            base.window = foundry.utils.mergeObject(base.window, {
                title: `${actor.name} — ${manageLabel}`
            });
            super(base);
            this.actor = actor;
        }
    
        async _prepareContext(options) {
            return {};
        }
    
        async _renderHTML(context, options) {
            const esc = foundry.utils.escapeHTML;
            const actor = this.actor;
            const standings = SpeakerStage._getActorStandings(actor);
            const emotions = SpeakerStage._getSelectorActorEmotions(actor);
            const emotionList = Object.entries(emotions).map(([id, data]) => ({
                id,
                name: data?.name || '',
                portrait: data?.portrait || ''
            }));
    
            const wrap = document.createElement('div');
            wrap.className = 'lichsoma-standing-manager-app-inner';
            wrap.innerHTML = `
                <div class="lichsoma-standing-manager-container">
                    <section class="lichsoma-standing-default-section">
                        <h3>${esc(game.i18n.localize('SPEAKERSTAGE.Standing.Default') || '기본 스탠딩')}</h3>
                        <div class="lichsoma-standing-manager-item lichsoma-standing-default-item" data-standing-kind="default">
                            <img src="${esc(standings.default || actor.img || 'icons/svg/mystery-man.svg')}" alt="${esc(actor.name)}" />
                            <div class="lichsoma-standing-manager-item-info">
                                <label>${esc(game.i18n.localize('SPEAKERSTAGE.Standing.DefaultPath') || '기본 스탠딩 경로')}</label>
                                <input type="text" class="lichsoma-standing-default-input" value="${esc(standings.default || '')}" placeholder="스탠딩 이미지 경로" />
                            </div>
                            <div class="lichsoma-standing-manager-item-actions">
                                <button type="button" class="lichsoma-standing-edit-image" title="이미지 선택">
                                    <i class="fa-solid fa-image"></i>
                                </button>
                                <button type="button" class="lichsoma-standing-clear-image" title="비우기">
                                    <i class="fa-solid fa-eraser"></i>
                                </button>
                            </div>
                        </div>
                    </section>
                    <section class="lichsoma-standing-emotion-section">
                        <h3>${esc(game.i18n.localize('SPEAKERSTAGE.Standing.EmotionStandings') || '감정별 스탠딩')}</h3>
                        <p class="lichsoma-standing-hint">${esc(game.i18n.localize('SPEAKERSTAGE.Standing.EmotionHint') || '감정별 스탠딩을 비워두면 기본 스탠딩을 사용합니다.')}</p>
                        <div class="lichsoma-standing-manager-list">
                            ${emotionList.length ? emotionList.map((emotion) => {
                                const value = standings.emotions?.[emotion.id] || '';
                                const preview = value || standings.default || emotion.portrait || actor.img || 'icons/svg/mystery-man.svg';
                                return `
                                    <div class="lichsoma-standing-manager-item" data-emotion-id="${esc(emotion.id)}">
                                        <img src="${esc(preview)}" alt="${esc(emotion.name)}" />
                                        <div class="lichsoma-standing-manager-item-info">
                                            <label>${esc(emotion.name || '감정')}</label>
                                            <input type="text" class="lichsoma-standing-emotion-input" value="${esc(value)}" placeholder="감정별 스탠딩 경로" />
                                        </div>
                                        <div class="lichsoma-standing-manager-item-actions">
                                            <button type="button" class="lichsoma-standing-edit-image" title="이미지 선택">
                                                <i class="fa-solid fa-image"></i>
                                            </button>
                                            <button type="button" class="lichsoma-standing-clear-image" title="비우기">
                                                <i class="fa-solid fa-eraser"></i>
                                            </button>
                                        </div>
                                    </div>
                                `;
                            }).join('') : `<div class="lichsoma-standing-manager-empty">${esc(game.i18n.localize('SPEAKERSTAGE.Standing.NoEmotions') || '등록된 감정이 없습니다. 감정별 스탠딩은 감정을 추가한 뒤 설정할 수 있습니다.')}</div>`}
                        </div>
                    </section>
                    <div class="lichsoma-standing-manager-actions">
                        <button type="button" class="lichsoma-standing-save-action">${esc(game.i18n.localize('SPEAKERSTAGE.Standing.Save') || '저장')}</button>
                        <button type="button" class="lichsoma-standing-cancel-action">${esc(game.i18n.localize('SPEAKERSTAGE.Standing.Cancel') || '취소')}</button>
                    </div>
                </div>
            `;
            return wrap;
        }
    
        _replaceHTML(result, content, options) {
            const target = LichsomaSpeakerStageCompat.asElement(content) ?? content;
            if (target?.replaceChildren) target.replaceChildren(result);
        }
    
        async _onFirstRender(context, options) {
            SpeakerStage._standingManagerApp = this;
            const root = LichsomaSpeakerStageCompat.asElement(this)?.querySelector('.lichsoma-standing-manager-app-inner');
            if (!root) return;
    
            root.querySelectorAll('.lichsoma-standing-edit-image').forEach((btn) => {
                btn.addEventListener('click', (ev) => {
                    const item = ev.currentTarget.closest('.lichsoma-standing-manager-item');
                    const input = item?.querySelector('input');
                    const preview = item?.querySelector('img');
                    if (!input) return;
    
                    SpeakerStage._openImageFilePicker({
                        current: input.value || preview?.getAttribute('src') || this.actor.img || '',
                        callback: (path) => {
                            input.value = path;
                            if (preview && path) preview.src = path;
                        }
                    });
                });
            });
    
            root.querySelectorAll('.lichsoma-standing-clear-image').forEach((btn) => {
                btn.addEventListener('click', (ev) => {
                    const item = ev.currentTarget.closest('.lichsoma-standing-manager-item');
                    const input = item?.querySelector('input');
                    const preview = item?.querySelector('img');
                    if (input) input.value = '';
                    if (preview) preview.src = this.actor.img || 'icons/svg/mystery-man.svg';
                });
            });
    
            root.querySelectorAll('input').forEach((input) => {
                input.addEventListener('input', () => {
                    const item = input.closest('.lichsoma-standing-manager-item');
                    const preview = item?.querySelector('img');
                    if (preview && input.value.trim()) preview.src = input.value.trim();
                });
            });
    
            root.querySelector('.lichsoma-standing-save-action')?.addEventListener('click', async () => {
                await this._saveStandings();
                await this.close({ animate: true });
            });
    
            root.querySelector('.lichsoma-standing-cancel-action')?.addEventListener('click', () => {
                void this.close({ animate: true });
            });
        }
    
        async _saveStandings() {
            const root = LichsomaSpeakerStageCompat.asElement(this)?.querySelector('.lichsoma-standing-manager-app-inner');
            if (!root) return;
    
            const defaultPath = root.querySelector('.lichsoma-standing-default-input')?.value?.trim() || '';
            const currentEmotions = SpeakerStage._getSelectorActorEmotions(this.actor);
            const validEmotionIds = new Set(Object.keys(currentEmotions || {}).map((id) => String(id)));
            const emotions = {};
            root.querySelectorAll('.lichsoma-standing-manager-item[data-emotion-id]').forEach((item) => {
                const emotionId = item.getAttribute('data-emotion-id');
                const value = item.querySelector('.lichsoma-standing-emotion-input')?.value?.trim() || '';
                if (emotionId && validEmotionIds.has(String(emotionId)) && value) emotions[emotionId] = value;
            });
    
            try {
                await this.actor.unsetFlag(SpeakerStage.MODULE_ID, SpeakerStage.STANDING_FLAG);
                if (defaultPath || Object.keys(emotions).length > 0) {
                    await this.actor.setFlag(SpeakerStage.MODULE_ID, SpeakerStage.STANDING_FLAG, {
                        default: defaultPath,
                        emotions
                    });
                }
                Hooks.callAll('lichsomaSpeakerStageStandingsUpdated', this.actor);
            } catch (error) {
                console.error('LichSOMA Speaker Stage | 스탠딩 저장 실패:', error);
                ui.notifications.error(game.i18n.localize('SPEAKERSTAGE.Standing.SaveError') || '스탠딩 저장 중 오류가 발생했습니다.');
            }
        }
    
        _onClose(options) {
            if (SpeakerStage._standingManagerApp === this) {
                SpeakerStage._standingManagerApp = null;
            }
        }
    }
    return LichsomaStandingManagerApp;
}
