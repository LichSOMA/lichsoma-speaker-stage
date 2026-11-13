import './lichsoma-speaker-stage-compat.js';
import { createBackgroundSettingApp } from './lichsoma-stage-background-settings.js';

/**
 * 스테이지 배경 이미지 — 장면과 무관하게 표시·전환 (월드 설정 + 파일 픽커 그리드)
 */

const MODULE_ID = 'lichsoma-speaker-stage';

const DAILY_CALENDAR_MODULE_ID = 'lichsoma-daily-calendar';
const TIME_OF_DAY_SETTING = 'timeOfDay';
const TIME_OF_DAY_KEYS = ['morning', 'afternoon', 'latenight'];

/** 시간대 제공자는 Daily Calendar만 사용한다. */
function isDailyCalendarActive() {
    return game.modules.get(DAILY_CALENDAR_MODULE_ID)?.active === true;
}

const SETTINGS = {
    SLOTS: 'stageBackgroundSlots',
    ACTIVE_INDEX: 'stageBackgroundActiveIndex',
    MINI_MODE: 'stageBackgroundMiniMode',
    /** 월드 — Interface(Token 위)에서 배경을 그림 · 프레임/오버레이 포인터 차단(config에서 토글, 리로드 필요) */
    NARRATIVE_MODE: 'stageBackgroundNarrativeMode',
    /** 월드 — Daily Calendar 활성 + 본 설정 ON일 때 슬롯별 오전/오후/심야 이미지 사용 */
    LINK_TIME_BACKGROUNDS: 'stageBackgroundLinkTimeOfDay'
};

const MAX_SLOTS = 99;

/** 활성 배경 슬롯 전환 시 교차 페이드(ms) */
const STAGE_BG_CROSSFADE_MS = 480;

/** 진행 중 페이드를 끊고 새 장면으로 바꿀 때 CanvasAnimation 이름 */
const STAGE_BG_CROSSFADE_ANIM_NAME = 'lichsomaSpeakerStageBgCrossfade';

/** 스테이지 자체 ON/OFF 또는 없음↔있음 전환 시 이미지+검은 바탕을 함께 페이드 */
const STAGE_BG_STAGE_FADE_ANIM_NAME = 'lichsomaSpeakerStageBgStageFade';

/** 월드 단위 — 미세 좌표 흔들림마다 resize가 돌면 페이드 직후 알파처럼 보이는 깜빡임이 날 수 있음 */
const STAGE_BG_MESH_RESIZE_EPS = 3;

/** Interface에서 TokenLayer(zIndex 200)보다 위 · Tiles(300)보다 아래 */
const STAGE_BG_INTERFACE_LAYER_Z = 250;

/** 기본 표시 이름: 「슬롯 N」(로케일) */
function defaultSlotName(index) {
    return `${game.i18n.localize('SPEAKERSTAGE.Background.Dialog.SlotPrefix')} ${index + 1}`;
}

function emptyTimesMap() {
    return { morning: '', afternoon: '', latenight: '' };
}

/**
 * 저장 형식: `{ path, name, times?: { morning, afternoon, latenight } }[]` 또는 레거시 `string[]`(경로만).
 * 단일 이미지(시간대 연동 없음)와 `times.morning`을 동일하게 유지한다.
 * @returns {{ path: string, name: string, times: { morning: string, afternoon: string, latenight: string } }[]}
 */
function normalizeSlotRecords(raw) {
    const arr = Array.isArray(raw) ? [...raw] : [];
    const out = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
        const v = arr[i];
        const times = emptyTimesMap();
        let path = '';
        let name = defaultSlotName(i);

        if (typeof v === 'string') {
            path = v;
        } else if (v && typeof v === 'object') {
            path = typeof v.path === 'string' ? v.path : '';
            if (typeof v.name === 'string' && v.name.trim()) name = v.name.trim();
            const tm = v.times;
            if (tm && typeof tm === 'object') {
                for (const k of TIME_OF_DAY_KEYS) {
                    if (typeof tm[k] === 'string') times[k] = tm[k];
                }
            }
        }

        const mt = (times.morning || '').trim();
        const pt = (path || '').trim();
        if (mt) path = times.morning;
        else if (pt) times.morning = path;

        out.push({ path, name, times });
    }
    return out;
}

/** 슬롯이 셀렉트·배경에 나올 만한 이미지가 하나라도 있는지 */
function slotRecordHasAnyImage(rec) {
    if (!rec) return false;
    if (typeof rec.path === 'string' && rec.path.trim()) return true;
    if (!rec.times) return false;
    return TIME_OF_DAY_KEYS.some((k) => typeof rec.times[k] === 'string' && rec.times[k].trim());
}

/**
 * 현재 모드에서 실제로 불러올 이미지 경로(원본 · route 전)
 * @param {{ path?: string, times?: Record<string,string> }} rec
 */
function resolveStageBgSourcePath(rec) {
    if (!rec) return '';
    if (!StageBackground.isTimeVariantBackgroundActive()) {
        const m = typeof rec.times?.morning === 'string' ? rec.times.morning.trim() : '';
        if (m) return m;
        return typeof rec.path === 'string' ? rec.path.trim() : '';
    }
    let tod = 'morning';
    try {
        if (isDailyCalendarActive()) {
            const v = game.settings.get(DAILY_CALENDAR_MODULE_ID, TIME_OF_DAY_SETTING);
            if (TIME_OF_DAY_KEYS.includes(v)) tod = v;
        }
    } catch {
        /* noop */
    }
    const tp = rec.times?.[tod];
    if (typeof tp === 'string' && tp.trim()) return tp.trim();
    /* 오후·심야만 비었을 때 기본으로 오전 이미지 사용 */
    if (tod !== 'morning') {
        const am = rec.times?.morning;
        if (typeof am === 'string' && am.trim()) return am.trim();
    }
    /* 시간대 칸을 하나도 안 쓴 예전 단일 슬롯만 path로 표시(폴백 UI 없음) */
    const hasAnyTime = TIME_OF_DAY_KEYS.some((k) => typeof rec.times?.[k] === 'string' && rec.times[k].trim());
    if (!hasAnyTime && typeof rec.path === 'string' && rec.path.trim()) return rec.path.trim();
    return '';
}

function routePath(path) {
    if (!path) return '';
    return typeof foundry.utils?.getRoute === 'function' ? foundry.utils.getRoute(path) : path;
}

/**
 * Texture.from 직후에는 baseTexture가 아직 로드 중이라 valid가 false일 수 있다.
 * 그 상태에서 _syncStageBgVisibility가 메시를 숨기면 없음→슬롯 전환 시 한 번 깜빡인다.
 */
function whenStageBgTextureRenderable(tex) {
    if (!tex || tex === PIXI.Texture.EMPTY) return Promise.resolve(false);
    if (tex.valid) return Promise.resolve(true);
    return new Promise((resolve) => {
        let settled = false;
        const finish = (ok) => {
            if (settled) return;
            settled = true;
            tex.off('update', onUpdate);
            tex.baseTexture.off('loaded', onLoaded);
            resolve(ok);
        };
        const onUpdate = () => {
            if (tex.valid) finish(true);
        };
        const onLoaded = () => {
            if (tex.valid) finish(true);
        };
        tex.once('update', onUpdate);
        tex.baseTexture.once('loaded', onLoaded);
        window.setTimeout(() => finish(!!tex.valid), 8000);
    });
}

export class StageBackground {
    static _interfaceObserver = null;
    static _overlayWatchStarted = false;
    static _layerMountScheduled = false;
    /** @type {MutationObserver|null} */
    static _overlayAttrObserver = null;
    /** @type {Element|null} */
    static _overlayAttrObservedTarget = null;
    /** PrimaryCanvasGroup용 스테이지 배경 메시 2장 — 교차 페이드용(일반 모드) */
    static _stageBgMeshes = null;
    /** 내러티브 모드: `canvas.interface`에 붙는 루트 컨테이너 */
    static _stageBgInterfaceRoot = null;
    /** 내러티브 모드: 루트 안 교차 페이드용 스프라이트 2장 */
    static _stageBgInterfaceSprites = null;
    /** 비내러티브 모드: 배경 이미지와 검은 바탕을 함께 페이드시키는 Primary 루트 */
    static _stageBgPrimaryRoot = null;
    /** 비내러티브 모드: Primary 루트 안 일반 PIXI.Sprite 2장 — PrimarySpriteMesh의 Scene clipping 회피 */
    static _stageBgPrimarySprites = null;
    /** 풀 모드에서 레터박스·잘림 영역을 검게 덮는 Primary 레이어용 배경 */
    static _stageBgPrimaryBlackout = null;
    /** 풀 모드에서 레터박스·잘림 영역을 검게 덮는 Interface 레이어용 배경 */
    static _stageBgInterfaceBlackout = null;
    /** @type {number} 0 또는 1 — 페이드 종료 후 현재 이미지를 들고 있는 메시 */
    static _stageBgStableIdx = 0;
    /** 마지막으로 표시에 성공한 이미지 URL(route 후) — 동일 선택 시 페이드 생략 */
    static _stageBgDisplayedUrl = '';
    /** 슬롯↔슬롯 교차 페이드 중에는 두 메시 모두 그려야 함(_syncStageBgVisibility 분기용) */
    static _stageBgCrossfadeActive = false;
    /** 스테이지 ON/OFF 페이드 중에는 overlay.hidden이어도 drawable을 유지 */
    static _stageBgStageFadeActive = false;
    static _stageBgStageFadeRequestId = 0;
    static _stageBgCanvasHooksRegistered = false;
    /** 팬·줌 매 프레임 화면 정렬 — canvasPan만으로는 관성 중 한 박자 어긋남 → 떨림 */
    static _stageBgTickerCb = null;
    static _stageBgTickerApp = null;
    static _stageBgTickerAttached = false;
    /** @type {WeakSet<Element>} 셀렉트 DOM이 바뀌면(구조 마이그레이션) 새 요소에 다시 바인딩 */
    static _sceneSelectBoundSelects = new WeakSet();
    /** @type {WeakSet<Element>} 씬 바(미니 토글)가 새로 만들어질 때마다 재바인딩 */
    static _sceneBarMiniToggleBound = new WeakSet();
    /** 동시에 두 번 돌면 terminateAnimation으로 서로를 끊어 슬롯 전환 상태가 깨짐 → 한 줄로 직렬화 */
    static _refreshBgTail = Promise.resolve();
    static initialize() {
        Hooks.once('init', () => this.registerSettings());
        Hooks.once('ready', () => {
            Hooks.on('updateSetting', this._onUpdateSetting.bind(this));
            Hooks.on('canvasReady', () => {
                StageBackground._tryMountBackgroundLayers();
                /* tearDown 후 완성 분기에서는 refresh를 안 불러 텍스처가 비어 남음 */
                StageBackground.refreshBackgroundImage();
                StageBackground._syncStageBgNarrativeModeUI();
            });
            /* Interface 그룹 tearDown 시 커스텀 자식이 파괴됨 → 인터페이스 레이어 배경만 재부착 */
            Hooks.on('drawInterfaceCanvasGroup', () => {
                if (!canvas?.ready || !StageBackground._stageBgUsesInterfaceLayer()) return;
                StageBackground._ensureInterfaceStageBgSprites();
                StageBackground.refreshBackgroundImage();
            });
            Hooks.on('canvasTearDown', () => {
                StageBackground._destroyPixiStageBackgroundMesh();
                StageBackground._overlayAttrObservedTarget = null;
            });
            Hooks.on('lichsomaSpeakerStageLayout', () => {
                StageBackground._updateStageBgMeshLayout();
            });
            Hooks.on('lichsomaSpeakerStageVisibility', (visible) => {
                StageBackground._onStageOverlayVisibilityChanged(visible);
            });
            this._startLayerMountObservers();
            this._tryMountBackgroundLayers();
            if (canvas?.ready) {
                this._tryMountBackgroundLayers();
                this.refreshBackgroundImage();
            }
        });
    }

    static registerSettings() {
        game.settings.register(MODULE_ID, SETTINGS.SLOTS, {
            name: game.i18n.localize('SPEAKERSTAGE.Background.Settings.Slots.Name'),
            hint: game.i18n.localize('SPEAKERSTAGE.Background.Settings.Slots.Hint'),
            scope: 'world',
            config: false,
            type: Array,
            default: []
        });

        game.settings.register(MODULE_ID, SETTINGS.ACTIVE_INDEX, {
            name: game.i18n.localize('SPEAKERSTAGE.Background.Settings.Active.Name'),
            hint: game.i18n.localize('SPEAKERSTAGE.Background.Settings.Active.Hint'),
            scope: 'world',
            config: false,
            type: Number,
            default: -1
        });

        game.settings.register(MODULE_ID, SETTINGS.MINI_MODE, {
            name: game.i18n.localize('SPEAKERSTAGE.Background.Settings.MiniMode.Name'),
            hint: game.i18n.localize('SPEAKERSTAGE.Background.Settings.MiniMode.Hint'),
            scope: 'client',
            config: false,
            type: Boolean,
            default: false
        });

        game.settings.register(MODULE_ID, SETTINGS.NARRATIVE_MODE, {
            name: game.i18n.localize('SPEAKERSTAGE.Background.Settings.NarrativeMode.Name'),
            hint: game.i18n.localize('SPEAKERSTAGE.Background.Settings.NarrativeMode.Hint'),
            scope: 'world',
            config: true,
            requiresReload: true,
            type: Boolean,
            default: false
        });

        game.settings.register(MODULE_ID, SETTINGS.LINK_TIME_BACKGROUNDS, {
            name: game.i18n.localize('SPEAKERSTAGE.Background.Settings.LinkTimeOfDay.Name'),
            hint: game.i18n.localize('SPEAKERSTAGE.Background.Settings.LinkTimeOfDay.Hint'),
            scope: 'world',
            config: true,
            requiresReload: true,
            type: Boolean,
            default: false
        });

        game.settings.registerMenu(MODULE_ID, 'stageBackgroundGridMenu', {
            name: game.i18n.localize('SPEAKERSTAGE.Background.Menu.Name'),
            label: game.i18n.localize('SPEAKERSTAGE.Background.Menu.Label'),
            hint: game.i18n.localize('SPEAKERSTAGE.Background.Menu.Hint'),
            icon: 'fas fa-images',
            type: StageBackgroundSettingApp,
            restricted: true
        });
    }

    static getSlotRecordsNormalized() {
        return normalizeSlotRecords(game.settings.get(MODULE_ID, SETTINGS.SLOTS));
    }

    static async saveSlots(records) {
        await game.settings.set(MODULE_ID, SETTINGS.SLOTS, normalizeSlotRecords(records));
    }

    static async saveActiveIndex(idx) {
        const n = Number(idx);
        const clamped = Number.isFinite(n) ? Math.max(-1, Math.min(MAX_SLOTS - 1, Math.trunc(n))) : -1;
        await game.settings.set(MODULE_ID, SETTINGS.ACTIVE_INDEX, clamped);
    }

    /** Daily Calendar 활성 + 월드 설정 「시간대 연동」 ON */
    static isTimeVariantBackgroundActive() {
        try {
            return !!(isDailyCalendarActive() && game.settings.get(MODULE_ID, SETTINGS.LINK_TIME_BACKGROUNDS));
        } catch {
            return false;
        }
    }

    static _isSettingChange(setting, namespace, key) {
        if (!setting || !namespace || !key) return false;
        const rawKey = setting.key ?? '';
        const rawNamespace = setting.namespace ?? setting.parent?.namespace ?? '';
        return rawKey === `${namespace}.${key}` || (rawNamespace === namespace && rawKey === key);
    }

    static _resyncStageBgDisplayMode() {
        this._syncStageBgMiniModeShell();
        this._syncStageBgNarrativeModeUI();
        this._updateStageBgMeshLayout();
        this._syncStageBgVisibility();

        const syncAfterLayout = () => {
            StageBackground._syncStageBgMiniModeShell();
            StageBackground._syncStageBgNarrativeModeUI();
            StageBackground._updateStageBgMeshLayout();
            StageBackground._syncStageBgVisibility();
        };

        requestAnimationFrame(() => {
            syncAfterLayout();
            requestAnimationFrame(syncAfterLayout);
        });
    }

    static _onUpdateSetting(setting) {
        if (
            this._isSettingChange(setting, MODULE_ID, SETTINGS.SLOTS) ||
            this._isSettingChange(setting, MODULE_ID, SETTINGS.ACTIVE_INDEX)
        ) {
            this.refreshBackgroundImage();
        }
        if (this._isSettingChange(setting, MODULE_ID, SETTINGS.LINK_TIME_BACKGROUNDS)) {
            this.refreshBackgroundImage();
        }
        if (
            this._isSettingChange(setting, DAILY_CALENDAR_MODULE_ID, TIME_OF_DAY_SETTING) &&
            this.isTimeVariantBackgroundActive()
        ) {
            this.refreshBackgroundImage();
        }
        if (this._isSettingChange(setting, MODULE_ID, SETTINGS.MINI_MODE)) {
            this._resyncStageBgDisplayMode();
        }
    }

    /** 클라이언트 미니 모드 ↔ 셸 클래스 + 토글 버튼 상태(PIX rect는 프레임 rect로 동기화) */
    static _syncStageBgMiniModeShell() {
        const ov = document.getElementById('lichsoma-stage-overlay');
        if (!ov) return;
        const shell = ov.querySelector(':scope > .lichsoma-stage-background-shell');
        if (!shell) return;
        const mini = !!game.settings.get(MODULE_ID, SETTINGS.MINI_MODE);
        shell.classList.toggle('lichsoma-stage-background-shell--mini', mini);

        const btn = ov.querySelector('#lichsoma-stage-bg-mini-toggle');
        if (!btn) return;
        btn.classList.toggle('is-active', mini);
        btn.setAttribute('aria-pressed', mini ? 'true' : 'false');
        const hint = game.i18n.localize(
            mini
                ? 'SPEAKERSTAGE.Background.Overlay.MiniModeDisableHint'
                : 'SPEAKERSTAGE.Background.Overlay.MiniModeEnableHint'
        );
        btn.title = hint;
        btn.setAttribute('aria-label', hint);
        let icon = btn.querySelector('i');
        if (!icon) {
            icon = document.createElement('i');
            btn.appendChild(icon);
        }
        icon.className = mini ? 'fas fa-expand' : 'fas fa-compress';
    }

    /** 오버레이 셸+셀렉트까지 준비된 뒤에는 무시 — syncOverlaySceneSelect의 replaceChildren() 무한 옵저버 방지 */
    static _isBackgroundLayersComplete() {
        const ov = document.getElementById('lichsoma-stage-overlay');
        if (!ov) return true;
        return !!ov.querySelector(':scope > .lichsoma-stage-background-shell .lichsoma-stage-bg-scene-select');
    }

    static _tryMountBackgroundLayers() {
        if (this._isBackgroundLayersComplete()) {
            const ov = document.getElementById('lichsoma-stage-overlay');
            if (ov) {
                this._ensureOverlaySceneShell(ov);
                this._ensureOverlayAttributeObserver(ov);
                this._syncStageBgMiniModeShell();
                this._syncStageBgNarrativeModeUI();
            }
            if (canvas?.ready) this._ensureStageBackgroundPixi();
            this._updateStageBgMeshLayout();
            this._syncStageBgVisibility();
            return;
        }

        const ov = document.getElementById('lichsoma-stage-overlay');
        if (ov) {
            this._removeLegacyOverlayBackground(ov);
            this._ensureOverlaySceneShell(ov);
            this._ensureOverlayAttributeObserver(ov);
            this._syncStageBgMiniModeShell();
            this._syncStageBgNarrativeModeUI();
        }

        if (canvas?.ready) this._ensureStageBackgroundPixi();
        this._syncStageBgVisibility();
        this.refreshBackgroundImage();
    }

    static _scheduleTryMountBackgroundLayers() {
        if (this._layerMountScheduled) return;
        this._layerMountScheduled = true;
        requestAnimationFrame(() => {
            this._layerMountScheduled = false;
            this._tryMountBackgroundLayers();
        });
    }

    static _mutationTouchesStageBackground(mutations) {
        const overlay = document.getElementById('lichsoma-stage-overlay');
        if (!overlay || !this._isBackgroundLayersComplete()) return true;

        const isRelevantNode = (node) => {
            if (!(node instanceof Element)) return false;
            return node.id === 'lichsoma-stage-overlay'
                || node.classList.contains('lichsoma-stage-background-shell')
                || node.classList.contains('lichsoma-stage-background-frame')
                || node.classList.contains('lichsoma-stage-bg-scene-select')
                || !!node.querySelector?.('#lichsoma-stage-overlay, .lichsoma-stage-background-shell, .lichsoma-stage-background-frame, .lichsoma-stage-bg-scene-select');
        };

        return mutations.some((mutation) => {
            if (isRelevantNode(mutation.target)) return true;
            for (const node of mutation.addedNodes || []) if (isRelevantNode(node)) return true;
            for (const node of mutation.removedNodes || []) if (isRelevantNode(node)) return true;
            return false;
        });
    }

    static _startLayerMountObservers() {
        const iface = document.getElementById('interface');
        if (!iface || this._overlayWatchStarted) return;
        this._overlayWatchStarted = true;
        this._interfaceObserver = new MutationObserver((mutations) => {
            if (!StageBackground._mutationTouchesStageBackground(mutations)) return;
            StageBackground._scheduleTryMountBackgroundLayers();
        });
        this._interfaceObserver.observe(iface, { childList: true, subtree: true });
    }

    /**
     * 씬 배경 메시는 Scene#_configureLevelTextures에서 level.elevation.bottom에 놓인다.
     * 스테이지 메시 elevation을 그와 맞춰야 같은 레벨 안에서 sortLayer(SCENE→타일→토큰) 순서가 적용된다.
     */
    static _syncStageBgMeshesElevation() {
        const meshes = this._stageBgMeshes;
        if (!meshes?.length || !canvas?.ready) return;
        const PCG = foundry.canvas.groups.PrimaryCanvasGroup;
        const bottom = canvas.level?.elevation?.bottom;
        const elev =
            typeof bottom === 'number' && Number.isFinite(bottom) ? bottom : PCG.BACKGROUND_ELEVATION;
        for (const m of meshes) {
            if (!m || m.destroyed) continue;
            m.elevation = elev;
        }
    }

    /** Primary 메시만 — 항상 TOKENS−1( 씬·타일 위 · 토큰 스프라이트 아래) */
    static _syncPrimaryStageBgSortLayer() {
        const meshes = this._stageBgMeshes;
        if (!meshes?.length || !canvas?.ready) return;
        const SORT = foundry.canvas.groups.PrimaryCanvasGroup.SORT_LAYERS;
        const layer = SORT.TOKENS - 1;
        for (const m of meshes) {
            if (!m || m.destroyed) continue;
            m.sortLayer = layer;
        }
        try {
            const prim = canvas.primary;
            if (prim?.sortDirty !== undefined) prim.sortDirty = true;
        } catch {
            /* noop */
        }
    }

    static _stageBgUsesInterfaceLayer() {
        return !!game.settings.get(MODULE_ID, SETTINGS.NARRATIVE_MODE);
    }

    /** @returns {unknown[]|null} 교차 페이드 대상 2개(메시 또는 스프라이트) */
    static _stageBgDrawablePair() {
        return this._stageBgUsesInterfaceLayer() ? this._stageBgInterfaceSprites : this._stageBgPrimarySprites;
    }

    static _stageBgUsesSpriteLayer() {
        return this._stageBgUsesInterfaceLayer() || !!this._stageBgPrimarySprites;
    }

    static _stageBgBlackoutDrawable() {
        return this._stageBgUsesInterfaceLayer() ? this._stageBgInterfaceBlackout : this._stageBgPrimaryBlackout;
    }

    static _stageBgRootDrawable() {
        return this._stageBgUsesInterfaceLayer() ? this._stageBgInterfaceRoot : this._stageBgPrimaryRoot;
    }

    static _stageBgHasRenderableTexture() {
        const drawables = this._stageBgDrawablePair();
        return !!drawables?.some(
            (d) => d && !d.destroyed && d.texture && d.texture !== PIXI.Texture.EMPTY && d.texture.valid
        );
    }

    static _prepareStageBgRootFade(showing) {
        if (!canvas?.ready) return;
        this._ensureStageBackgroundPixi();
        const root = this._stageBgRootDrawable();
        if (!root || root.destroyed || !this._stageBgHasRenderableTexture()) return;

        LichsomaSpeakerStageCompat.CanvasAnimation?.terminateAnimation?.(STAGE_BG_STAGE_FADE_ANIM_NAME);
        this._stageBgStageFadeActive = true;
        if (showing && root.alpha >= 0.999) root.alpha = 0;
        this._updateStageBgMeshLayout();
        this._syncStageBgVisibility();
    }

    static _onStageOverlayVisibilityChanged(showing) {
        const requestId = ++this._stageBgStageFadeRequestId;
        this._prepareStageBgRootFade(!!showing);
        this._refreshBgTail = this._refreshBgTail
            .catch(() => {})
            .then(() => this._fadeStageBgRootVisibility(!!showing, requestId));
    }

    static async _fadeStageBgRootVisibility(showing, requestId) {
        if (!canvas?.ready) return;
        this._ensureStageBackgroundPixi();

        const root = this._stageBgRootDrawable();
        const CanvasAnimation = LichsomaSpeakerStageCompat.CanvasAnimation;
        if (!root || root.destroyed || !CanvasAnimation || !this._stageBgHasRenderableTexture()) {
            if (requestId === this._stageBgStageFadeRequestId) this._stageBgStageFadeActive = false;
            if (root && !root.destroyed) root.alpha = 1;
            this._syncStageBgVisibility();
            return;
        }

        CanvasAnimation.terminateAnimation(STAGE_BG_STAGE_FADE_ANIM_NAME);
        this._stageBgStageFadeActive = true;
        this._syncStageBgVisibility();

        let completed = true;
        try {
            completed = await CanvasAnimation.animate(
                [{ parent: root, attribute: 'alpha', from: root.alpha, to: showing ? 1 : 0 }],
                {
                    duration: STAGE_BG_CROSSFADE_MS,
                    easing: 'easeInOutCosine',
                    name: STAGE_BG_STAGE_FADE_ANIM_NAME
                }
            );
        } catch {
            completed = false;
        }

        if (!completed) {
            if (requestId === this._stageBgStageFadeRequestId) {
                this._stageBgStageFadeActive = false;
                if (root && !root.destroyed) root.alpha = 1;
                this._syncStageBgVisibility();
            }
            return;
        }
        if (requestId !== this._stageBgStageFadeRequestId) return;
        root.alpha = showing ? 1 : 0;
        this._stageBgStageFadeActive = false;
        this._syncStageBgVisibility();
    }

    static _destroyPrimaryStageBgBlackout() {
        const g = this._stageBgPrimaryBlackout;
        this._stageBgPrimaryBlackout = null;
        if (!g || g.destroyed) return;
        try {
            g.parent?.removeChild(g);
        } catch {
            /* noop */
        }
        try {
            g.destroy({ children: true });
        } catch {
            /* noop */
        }
    }

    /** 풀 모드 배경은 DOM 오버레이가 아니라 PIXI 레이어에서 검은 바탕을 그려야 실제 이미지·토큰을 가리지 않는다. */
    static _updateStageBgBlackoutLayout() {
        const g = this._stageBgBlackoutDrawable();
        if (!g || g.destroyed || !canvas?.ready) return;
        const mini = !!game.settings.get(MODULE_ID, SETTINGS.MINI_MODE);
        if (mini) {
            g.visible = false;
            return;
        }

        const width = Math.max(1, window.innerWidth || document.documentElement?.clientWidth || 1);
        const height = Math.max(1, window.innerHeight || document.documentElement?.clientHeight || 1);
        const tl = canvas.canvasCoordinatesFromClient({ x: 0, y: 0 });
        const br = canvas.canvasCoordinatesFromClient({ x: width, y: height });
        const x = Math.min(tl.x, br.x);
        const y = Math.min(tl.y, br.y);
        const w = Math.max(1, Math.abs(br.x - tl.x));
        const h = Math.max(1, Math.abs(br.y - tl.y));

        g.clear();
        g.beginFill(0x000000, 1);
        g.drawRect(x, y, w, h);
        g.endFill();
    }

    static _destroyPrimaryStageBgSprites() {
        const root = this._stageBgPrimaryRoot;
        this._stageBgPrimaryRoot = null;
        const sprites = this._stageBgPrimarySprites;
        this._stageBgPrimarySprites = null;
        if (root && !root.destroyed) {
            this._stageBgPrimaryBlackout = null;
            try {
                canvas?.primary?.removeChild(root);
            } catch {
                /* noop */
            }
            try {
                root.destroy({ children: true });
            } catch {
                /* noop */
            }
            return;
        }

        this._destroyPrimaryStageBgBlackout();
        if (!sprites?.length) return;

        for (const s of sprites) {
            if (!s || s.destroyed) continue;
            try {
                s.parent?.removeChild(s);
            } catch {
                /* noop */
            }
            try {
                s.destroy({ children: true });
            } catch {
                /* noop */
            }
        }
    }

    static _getPrimaryStageBgSortLayer() {
        try {
            const SORT = foundry.canvas.groups.PrimaryCanvasGroup.SORT_LAYERS;
            if (typeof SORT?.TOKENS === 'number') return SORT.TOKENS - 1;
        } catch {
            /* noop */
        }
        return 699;
    }

    static _ensurePrimaryStageBgSprites() {
        if (!canvas?.ready || !canvas.primary) return;

        const sprites = this._stageBgPrimarySprites;
        const root = this._stageBgPrimaryRoot;
        const healthy =
            sprites?.[0] &&
            !sprites[0].destroyed &&
            sprites?.[1] &&
            !sprites[1].destroyed &&
            root &&
            !root.destroyed &&
            root.parent === canvas.primary &&
            sprites[0].parent === root &&
            sprites[1].parent === root &&
            this._stageBgPrimaryBlackout &&
            !this._stageBgPrimaryBlackout.destroyed &&
            this._stageBgPrimaryBlackout.parent === root;

        if (healthy) {
            const sortLayer = this._getPrimaryStageBgSortLayer();
            root.sortLayer = sortLayer;
            root.sort = -999999;
            this._stageBgPrimaryBlackout.sort = -999999;
            for (const s of sprites) {
                s.sort = s === sprites[0] ? -999998 : -999997;
            }
            try {
                if (canvas.primary.sortDirty !== undefined) canvas.primary.sortDirty = true;
            } catch {
                /* noop */
            }
            return;
        }

        if (this._stageBgMeshes?.length) {
            for (const m of this._stageBgMeshes) {
                if (!m || m.destroyed) continue;
                try {
                    canvas.primary?.removeChild(m);
                } catch {
                    /* noop */
                }
                try {
                    m.destroy({ children: true });
                } catch {
                    /* noop */
                }
            }
            this._stageBgMeshes = null;
        }

        this._destroyInterfaceStageBgSprites();
        this._destroyPrimaryStageBgSprites();

        const sortLayer = this._getPrimaryStageBgSortLayer();
        const rootContainer = new PIXI.Container();
        rootContainer.name = 'lichsoma-speaker-stage-bg-primary-root';
        rootContainer.eventMode = 'none';
        rootContainer.interactiveChildren = false;
        rootContainer.sortableChildren = true;
        rootContainer.sortLayer = sortLayer;
        rootContainer.sort = -999999;
        rootContainer.alpha = 1;

        const blackout = new PIXI.Graphics();
        blackout.name = 'lichsoma-speaker-stage-bg-blackout-primary';
        blackout.eventMode = 'none';
        blackout.sort = -999999;
        blackout.visible = false;

        const mkSprite = (sort) => {
            const s = new PIXI.Sprite(PIXI.Texture.EMPTY);
            s.name = 'lichsoma-speaker-stage-bg-primary-sprite';
            s.eventMode = 'none';
            s.anchor?.set(0, 0);
            s.sort = sort;
            s.alpha = 1;
            s.visible = false;
            return s;
        };

        const sUnder = mkSprite(-999998);
        const sOver = mkSprite(-999997);

        rootContainer.addChild(blackout);
        rootContainer.addChild(sUnder);
        rootContainer.addChild(sOver);
        canvas.primary.addChild(rootContainer);

        try {
            if (canvas.primary.sortDirty !== undefined) canvas.primary.sortDirty = true;
        } catch {
            /* noop */
        }

        this._stageBgPrimaryRoot = rootContainer;
        this._stageBgPrimaryBlackout = blackout;
        this._stageBgPrimarySprites = [sUnder, sOver];
        this._stageBgStableIdx = 0;
    }

    static _destroyInterfaceStageBgSprites() {
        const root = this._stageBgInterfaceRoot;
        this._stageBgInterfaceRoot = null;
        this._stageBgInterfaceSprites = null;
        this._stageBgInterfaceBlackout = null;
        if (!root || root.destroyed) return;
        try {
            canvas?.interface?.removeChild(root);
        } catch {
            /* noop */
        }
        try {
            root.destroy({ children: true });
        } catch {
            /* noop */
        }
    }

    static _ensureInterfaceStageBgSprites() {
        if (!canvas?.ready || !canvas.interface) return;

        const sprites = this._stageBgInterfaceSprites;
        const root = this._stageBgInterfaceRoot;
        const healthy =
            sprites?.[0] &&
            !sprites[0].destroyed &&
            sprites?.[1] &&
            !sprites[1].destroyed &&
            root &&
            !root.destroyed &&
            root.parent === canvas.interface &&
            this._stageBgInterfaceBlackout &&
            !this._stageBgInterfaceBlackout.destroyed &&
            this._stageBgInterfaceBlackout.parent === root;

        if (healthy) return;

        if (this._stageBgMeshes?.length) {
            for (const m of this._stageBgMeshes) {
                if (!m || m.destroyed) continue;
                try {
                    canvas.primary?.removeChild(m);
                } catch {
                    /* noop */
                }
                try {
                    m.destroy({ children: true });
                } catch {
                    /* noop */
                }
            }
            this._stageBgMeshes = null;
        }

        this._destroyPrimaryStageBgSprites();
        this._destroyInterfaceStageBgSprites();

        const mkSprite = (sort) => {
            const s = new PIXI.Sprite(PIXI.Texture.EMPTY);
            s.eventMode = 'none';
            s.anchor?.set(0, 0);
            s.sort = sort;
            s.alpha = 1;
            s.visible = false;
            return s;
        };

        const r = new PIXI.Container();
        r.eventMode = 'none';
        r.interactiveChildren = false;
        r.sortableChildren = true;
        r.zIndex = STAGE_BG_INTERFACE_LAYER_Z;
        r.alpha = 1;

        const blackout = new PIXI.Graphics();
        blackout.name = 'lichsoma-speaker-stage-bg-blackout-interface';
        blackout.eventMode = 'none';
        blackout.sort = -999999;
        blackout.visible = false;

        const sUnder = mkSprite(-999998);
        const sOver = mkSprite(-999997);
        r.addChild(blackout);
        r.addChild(sUnder);
        r.addChild(sOver);

        canvas.interface.addChild(r);
        canvas.interface.sortChildren?.();

        this._stageBgInterfaceRoot = r;
        this._stageBgInterfaceBlackout = blackout;
        this._stageBgInterfaceSprites = [sUnder, sOver];
        this._stageBgStableIdx = 0;
    }

    /** PrimarySpriteMesh와 동일한 box 안에서 texture cover 정렬 */
    static _applySpriteTextureCover(sprite, tex, boxX, boxY, boxW, boxH) {
        if (!sprite || sprite.destroyed) return;
        sprite.texture = tex;
        if (!tex?.valid || tex === PIXI.Texture.EMPTY) return;
        const tw = tex.width || tex.baseTexture?.width;
        const th = tex.height || tex.baseTexture?.height;
        if (!tw || !th) return;
        const scale = Math.max(boxW / tw, boxH / th);
        const nw = tw * scale;
        const nh = th * scale;
        sprite.scale.set(scale);
        sprite.position.set(boxX + (boxW - nw) / 2, boxY + (boxH - nh) / 2);
    }

    /**
     * 내러티브 + 미니: 16:9 프레임 블로커만.
     * 내러티브 + 풀: 스테이지 오버레이(사이드바 제외 폭) 전체 포인터 차단 — 셸은 블로커보다 위(z-index).
     */
    static _syncStageBgNarrativeModeUI() {
        const ov = document.getElementById('lichsoma-stage-overlay');
        if (!ov) return;
        this._ensureOverlayNarrativeFullBlocker(ov);

        const narrative = !!game.settings.get(MODULE_ID, SETTINGS.NARRATIVE_MODE);
        const mini = !!game.settings.get(MODULE_ID, SETTINGS.MINI_MODE);

        const frame = ov.querySelector('.lichsoma-stage-background-frame');
        const shell = ov.querySelector(':scope > .lichsoma-stage-background-shell');

        const miniFramePointerBlock = narrative && mini;
        const fullOverlayPointerBlock = narrative && !mini;

        frame?.classList.toggle('lichsoma-stage-background-frame--narrative', miniFramePointerBlock);
        ov.classList.toggle('lichsoma-stage-overlay--narrative-full-pointer-block', fullOverlayPointerBlock);
        shell?.classList.toggle('lichsoma-stage-background-shell--above-narrative-pointer-floor', fullOverlayPointerBlock);
    }

    /** 풀 모드 내러티브 포인터 차단 — `.stage-characters-container`(z-index 100)보다 아래 */
    static _ensureOverlayNarrativeFullBlocker(overlayEl) {
        let blocker = overlayEl.querySelector(':scope > .lichsoma-stage-bg-narrative-full-blocker');
        if (blocker) return;
        blocker = document.createElement('div');
        blocker.className = 'lichsoma-stage-bg-narrative-full-blocker';
        blocker.setAttribute('aria-hidden', 'true');
        const chars = overlayEl.querySelector(':scope > .stage-characters-container');
        if (chars) overlayEl.insertBefore(blocker, chars);
        else overlayEl.appendChild(blocker);
    }

    /** 일반 모드: canvas.primary 일반 스프라이트 · 내러티브: Interface 스프라이트(settings 변경 시 리로드 가정) */
    static _ensureStageBackgroundPixi() {
        if (!canvas?.ready) return;
        if (this._stageBgUsesInterfaceLayer()) {
            this._ensureInterfaceStageBgSprites();
        } else {
            this._ensurePrimaryStageBgSprites();
        }
        this._registerStageBgCanvasHooks();
        this._attachStageBgTicker();
    }

    /** Primary Canvas — SCENE·타일 위, 토큰 스프라이트 아래(sortLayer 699) */
    static _ensurePrimaryStageBgMeshes() {
        if (!canvas?.ready || !canvas.primary) return;

        const meshes = this._stageBgMeshes;
        const primary = canvas.primary;
        const healthy =
            meshes?.[0] &&
            !meshes[0].destroyed &&
            meshes?.[1] &&
            !meshes[1].destroyed &&
            meshes[0].parent === primary &&
            meshes[1].parent === primary;

        if (healthy) {
            this._syncStageBgMeshesElevation();
            this._syncPrimaryStageBgSortLayer();
            return;
        }

        if (meshes?.length) {
            for (const m of meshes) {
                if (!m || m.destroyed) continue;
                try {
                    canvas.primary?.removeChild(m);
                } catch {
                    /* noop */
                }
                try {
                    m.destroy({ children: true });
                } catch {
                    /* noop */
                }
            }
            this._stageBgMeshes = null;
        }

        this._destroyInterfaceStageBgSprites();

        const PrimarySpriteMesh = LichsomaSpeakerStageCompat.PrimarySpriteMesh;
        if (!PrimarySpriteMesh) return;
        const SORT = foundry.canvas.groups.PrimaryCanvasGroup.SORT_LAYERS;
        const mkMesh = (sortOrder) => {
            const m = new PrimarySpriteMesh({
                texture: PIXI.Texture.EMPTY,
                name: 'lichsoma-speaker-stage-bg',
                object: canvas.primary
            });
            m.sortLayer = SORT.TOKENS - 1;
            m.sort = sortOrder;
            m.eventMode = 'none';
            m.alpha = 1;
            m.visible = false;
            return m;
        };
        const mUnder = mkMesh(-999998);
        const mOver = mkMesh(-999997);
        canvas.primary.addChild(mUnder);
        canvas.primary.addChild(mOver);
        this._stageBgMeshes = [mUnder, mOver];
        this._stageBgStableIdx = 0;
        this._syncStageBgMeshesElevation();
        this._syncPrimaryStageBgSortLayer();
    }

    static _registerStageBgCanvasHooks() {
        if (this._stageBgCanvasHooksRegistered) return;
        this._stageBgCanvasHooksRegistered = true;
        Hooks.on('canvasPan', () => StageBackground._updateStageBgMeshLayout());
        window.addEventListener('resize', () => StageBackground._updateStageBgMeshLayout());
    }

    static _stageBgOverlayVisibleForTicker() {
        const ov = document.getElementById('lichsoma-stage-overlay');
        return !!(ov && !ov.classList.contains('hidden'));
    }

    static _attachStageBgTicker() {
        const app = canvas?.app;
        if (!app?.ticker) return;
        if (this._stageBgTickerAttached && this._stageBgTickerApp !== app) {
            this._detachStageBgTicker();
        }
        if (this._stageBgTickerAttached) return;

        this._stageBgTickerCb = () => {
            if (!StageBackground._stageBgOverlayVisibleForTicker()
                && !StageBackground._stageBgCrossfadeActive
                && !StageBackground._stageBgStageFadeActive) return;
            const drawables = StageBackground._stageBgDrawablePair();
            if (!drawables || !canvas?.ready) return;
            const hasRenderableTex = drawables.some(
                (d) =>
                    d &&
                    !d.destroyed &&
                    d.texture &&
                    d.texture !== PIXI.Texture.EMPTY &&
                    d.texture.valid
            );
            if (!hasRenderableTex) return;
            StageBackground._applyStageBgMeshLayoutFromDom({ syncVisibility: false });
            StageBackground._syncStageBgVisibility();
        };
        this._stageBgTickerApp = app;
        app.ticker.add(this._stageBgTickerCb);
        this._stageBgTickerAttached = true;
    }

    static _detachStageBgTicker() {
        const cb = this._stageBgTickerCb;
        const ap = this._stageBgTickerApp;
        this._stageBgTickerCb = null;
        this._stageBgTickerApp = null;
        this._stageBgTickerAttached = false;
        if (cb && ap?.ticker) {
            try {
                ap.ticker.remove(cb);
            } catch {
                /* noop */
            }
        }
    }

    static _destroyPixiStageBackgroundMesh() {
        this._detachStageBgTicker();
        this._refreshBgTail = Promise.resolve();
        LichsomaSpeakerStageCompat.CanvasAnimation?.terminateAnimation?.(STAGE_BG_CROSSFADE_ANIM_NAME);
        LichsomaSpeakerStageCompat.CanvasAnimation?.terminateAnimation?.(STAGE_BG_STAGE_FADE_ANIM_NAME);
        this._stageBgCrossfadeActive = false;
        this._stageBgStageFadeActive = false;
        const meshes = this._stageBgMeshes;
        this._stageBgMeshes = null;
        this._stageBgDisplayedUrl = '';
        if (meshes?.length) {
            for (const m of meshes) {
                if (!m || m.destroyed) continue;
                try {
                    canvas?.primary?.removeChild(m);
                } catch {
                    /* noop */
                }
                try {
                    m.destroy({ children: true });
                } catch {
                    /* noop */
                }
            }
        }
        this._destroyPrimaryStageBgSprites();
        this._destroyInterfaceStageBgSprites();
    }

    /** 진행 중 페이드가 끊기면 알파·텍스처 상태를 한쪽 메시로 정리 */
    static _snapStageBgMeshesAfterInterrupt() {
        const meshes = this._stageBgDrawablePair();
        if (!meshes?.[0] || meshes[0].destroyed || !meshes?.[1] || meshes[1].destroyed) return;

        const [m0, m1] = meshes;
        const t0 = m0.texture?.valid && m0.texture !== PIXI.Texture.EMPTY;
        const t1 = m1.texture?.valid && m1.texture !== PIXI.Texture.EMPTY;
        if (!t0 && !t1) {
            this._stageBgDisplayedUrl = '';
            return;
        }

        const winner = !t1 || (t0 && m0.alpha >= m1.alpha) ? m0 : m1;
        const loser = winner === m0 ? m1 : m0;

        loser.texture = PIXI.Texture.EMPTY;
        loser.alpha = 1;
        loser.visible = false;
        loser._lichsomaLayoutW = undefined;
        loser._lichsomaLayoutH = undefined;

        winner.alpha = 1;
        winner.visible = true;
        this._stageBgStableIdx = winner === m0 ? 0 : 1;

        try {
            const src = winner.texture?.baseTexture?.resource?.src;
            this._stageBgDisplayedUrl = typeof src === 'string' ? src : '';
        } catch {
            this._stageBgDisplayedUrl = '';
        }
    }

    /** 오버레이 16:9 프레임과 동일한 화면 직사각형을 캔버스 좌표로 옮겨 메시 크기·위치 설정 */
    static _updateStageBgMeshLayout() {
        this._applyStageBgMeshLayoutFromDom({ syncVisibility: true });
    }

    /**
     * 화면에 고정된 UI 프레임 ↔ 월드 좌표 변환은 매 프레임 갱신해야 팬 시 흔들림이 없음.
     * @param {{ syncVisibility?: boolean }} opts
     */
    static _applyStageBgMeshLayoutFromDom(opts = {}) {
        const syncVisibility = opts.syncVisibility !== false;
        const drawables = this._stageBgDrawablePair();
        if (!drawables?.length || !canvas?.ready) return;

        const useSpriteLayer = this._stageBgUsesSpriteLayer();
        if (!useSpriteLayer) this._syncStageBgMeshesElevation();

        const frame = document.querySelector('#lichsoma-stage-overlay .lichsoma-stage-background-frame');
        if (!frame) {
            for (const d of drawables) {
                if (d && !d.destroyed) d.visible = false;
            }
            return;
        }

        const r = frame.getBoundingClientRect();
        this._updateStageBgBlackoutLayout();
        if (r.width < 2 || r.height < 2) {
            for (const d of drawables) {
                if (d && !d.destroyed) d.visible = false;
            }
            return;
        }

        const tl = canvas.canvasCoordinatesFromClient({ x: r.left, y: r.top });
        const br = canvas.canvasCoordinatesFromClient({ x: r.right, y: r.bottom });
        const w = Math.max(1, Math.abs(br.x - tl.x));
        const h = Math.max(1, Math.abs(br.y - tl.y));
        const x = Math.min(tl.x, br.x);
        const y = Math.min(tl.y, br.y);

        for (const drawable of drawables) {
            if (!drawable || drawable.destroyed) continue;

            const texReady = drawable.texture?.valid && drawable.texture !== PIXI.Texture.EMPTY;

            if (!useSpriteLayer) {
                if (drawable.anchor) drawable.anchor.set(0, 0);
                drawable.position.set(x, y);
                if (!texReady) continue;
                const pw = drawable._lichsomaLayoutW;
                const ph = drawable._lichsomaLayoutH;
                if (
                    pw === undefined ||
                    ph === undefined ||
                    Math.abs(pw - w) > STAGE_BG_MESH_RESIZE_EPS ||
                    Math.abs(ph - h) > STAGE_BG_MESH_RESIZE_EPS
                ) {
                    drawable.resize(w, h, { fit: 'cover' });
                    drawable._lichsomaLayoutW = w;
                    drawable._lichsomaLayoutH = h;
                }
            } else {
                if (!texReady) continue;
                /**
                 * 일반 PIXI.Sprite는 PrimarySpriteMesh의 Scene clipping을 피하면서도
                 * canvas.primary의 sortLayer로 토큰 바로 아래에 정렬된다.
                 * Interface 스프라이트도 같은 cover 배치를 사용한다.
                 */
                this._applySpriteTextureCover(drawable, drawable.texture, x, y, w, h);
                drawable._lichsomaLayoutW = w;
                drawable._lichsomaLayoutH = h;
            }
        }

        if (syncVisibility) this._syncStageBgVisibility();
    }

    /** 예전 오버레이 안에만 있던 배경 루트(이미지+바) 제거 */
    static _removeLegacyOverlayBackground(overlayEl) {
        overlayEl.querySelectorAll(':scope > .lichsoma-stage-background-root').forEach((el) => el.remove());
    }

    /** 배경 측정 프레임과 장면 컨트롤을 오버레이에 둔다. 컨트롤은 미니 모드 기준 좌표를 항상 유지한다. */
    static _ensureOverlaySceneShell(overlayEl) {
        let shell = overlayEl.querySelector(':scope > .lichsoma-stage-background-shell');
        if (!shell) {
            shell = document.createElement('div');
            shell.className = 'lichsoma-stage-background-shell lichsoma-stage-background-shell--overlay-ui';
            shell.innerHTML = `
                <div class="lichsoma-stage-background-shell-inner">
                    <div class="lichsoma-stage-background-frame lichsoma-stage-background-frame--overlay-ui">
                        <div class="lichsoma-stage-bg-narrative-blocker" aria-hidden="true"></div>
                    </div>
                </div>
                <div class="lichsoma-stage-bg-scene-bar">
                    <button type="button" id="lichsoma-stage-bg-mini-toggle" class="lichsoma-stage-bg-mini-toggle"></button>
                    <select id="lichsoma-stage-bg-overlay-select" class="lichsoma-stage-bg-scene-select" aria-label=""></select>
                </div>
            `;
            const sel = shell.querySelector('.lichsoma-stage-bg-scene-select');
            if (sel) sel.setAttribute('aria-label', game.i18n.localize('SPEAKERSTAGE.Background.Overlay.SceneAria'));
            overlayEl.insertBefore(shell, overlayEl.firstChild);
        } else {
            const frame = shell.querySelector('.lichsoma-stage-background-frame');
            let bar = shell.querySelector(':scope > .lichsoma-stage-bg-scene-bar');
            const legacyBar = frame?.querySelector('.lichsoma-stage-bg-scene-bar');
            if (!bar && legacyBar) {
                bar = legacyBar;
                shell.appendChild(bar);
            }
            if (!bar) {
                bar = document.createElement('div');
                bar.className = 'lichsoma-stage-bg-scene-bar';
                bar.innerHTML =
                    '<button type="button" id="lichsoma-stage-bg-mini-toggle" class="lichsoma-stage-bg-mini-toggle"></button>' +
                    '<select id="lichsoma-stage-bg-overlay-select" class="lichsoma-stage-bg-scene-select" aria-label=""></select>';
                shell.appendChild(bar);
            }
            const sel = bar.querySelector('.lichsoma-stage-bg-scene-select');
            if (sel) sel.setAttribute('aria-label', game.i18n.localize('SPEAKERSTAGE.Background.Overlay.SceneAria'));
            if (!bar.querySelector('#lichsoma-stage-bg-mini-toggle')) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.id = 'lichsoma-stage-bg-mini-toggle';
                btn.className = 'lichsoma-stage-bg-mini-toggle';
                bar.insertBefore(btn, bar.firstChild);
            }
            if (frame && !frame.querySelector('.lichsoma-stage-bg-narrative-blocker')) {
                const block = document.createElement('div');
                block.className = 'lichsoma-stage-bg-narrative-blocker';
                block.setAttribute('aria-hidden', 'true');
                const barEl = frame.querySelector('.lichsoma-stage-bg-scene-bar');
                if (barEl) frame.insertBefore(block, barEl);
                else frame.insertBefore(block, frame.firstChild);
            }
        }

        shell = overlayEl.querySelector(':scope > .lichsoma-stage-background-shell');
        if (shell) {
            const barBind = shell.querySelector('.lichsoma-stage-bg-scene-bar');
            if (barBind) this._bindOverlayMiniToggle(barBind);
            this._bindOverlaySceneSelect(shell);
        }
        /* syncOverlaySceneSelect는 호출하지 않음 — replaceChildren()이 #interface MutationObserver를
         * 다시 돌려 _tryMountBackgroundLayers → 무한 루프·로딩 멈춤 유발 */
    }

    static _bindOverlayMiniToggle(bar) {
        if (!bar || this._sceneBarMiniToggleBound.has(bar)) return;
        this._sceneBarMiniToggleBound.add(bar);
        const btn = bar.querySelector('#lichsoma-stage-bg-mini-toggle');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            const cur = !!game.settings.get(MODULE_ID, SETTINGS.MINI_MODE);
            await game.settings.set(MODULE_ID, SETTINGS.MINI_MODE, !cur);
            /* 일부 Foundry 버전/환경에서는 클라이언트 설정 updateSetting 훅 전달 형태가 달라
             * 즉시 레이아웃 재동기화가 누락될 수 있으므로 클릭한 클라이언트는 직접 한 번 더 맞춘다. */
            StageBackground._resyncStageBgDisplayMode();
        });
    }

    static _ensureOverlayAttributeObserver(overlayEl) {
        if (overlayEl === this._overlayAttrObservedTarget) return;
        if (this._overlayAttrObserver) this._overlayAttrObserver.disconnect();
        let scheduled = false;
        this._overlayAttrObserver = new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                StageBackground._updateStageBgMeshLayout();
                StageBackground._syncStageBgVisibility();
                StageBackground._syncStageBgNarrativeModeUI();
            });
        });
        this._overlayAttrObserver.observe(overlayEl, { attributes: true, attributeFilter: ['class'] });
        this._overlayAttrObservedTarget = overlayEl;
    }

    /** 오버레이 프레임이 측정 가능한 크기일 때만 배경을 그린다 — 작은 rect에서 sync가 visible을 켜면 깜빡임 */
    static _stageBgOverlayFrameRenderable() {
        const frame = document.querySelector('#lichsoma-stage-overlay .lichsoma-stage-background-frame');
        if (!frame) return false;
        const r = frame.getBoundingClientRect();
        return r.width >= 2 && r.height >= 2;
    }

    static _syncStageBgVisibility() {
        const ov = document.getElementById('lichsoma-stage-overlay');
        const meshes = this._stageBgDrawablePair();
        const blackout = this._stageBgBlackoutDrawable();
        if (!meshes?.length) {
            if (blackout && !blackout.destroyed) blackout.visible = false;
            ov?.classList.remove('lichsoma-stage-overlay--stage-bg-backdrop');
            return;
        }
        const overlayHidden = !ov || ov.classList.contains('hidden');
        const stageDrawableVisible = !overlayHidden || this._stageBgStageFadeActive;
        const frameOk = this._stageBgOverlayFrameRenderable();
        const mini = !!game.settings.get(MODULE_ID, SETTINGS.MINI_MODE);
        let anyVisibleBackground = false;

        for (let i = 0; i < meshes.length; i++) {
            const mesh = meshes[i];
            if (!mesh || mesh.destroyed) continue;
            const hasTex = !!(mesh.texture && mesh.texture !== PIXI.Texture.EMPTY && mesh.texture.valid);
            const eligible =
                hasTex && (this._stageBgCrossfadeActive || i === this._stageBgStableIdx);
            const visible = stageDrawableVisible && frameOk && eligible;
            mesh.visible = visible;
            if (visible) anyVisibleBackground = true;
        }

        if (blackout && !blackout.destroyed) {
            blackout.visible = !mini && stageDrawableVisible && frameOk && anyVisibleBackground;
        }

        ov?.classList.toggle('lichsoma-stage-overlay--stage-bg-backdrop', anyVisibleBackground);
    }

    /** 오버레이 우측 상단 장면 셀렉트 옵션·값·GM만 편집 */
    static syncOverlaySceneSelect() {
        const sel = document.querySelector('#lichsoma-stage-bg-overlay-select');
        if (!sel) return;

        const records = this.getSlotRecordsNormalized();
        const active = game.settings.get(MODULE_ID, SETTINGS.ACTIVE_INDEX);
        const currentActive = typeof active === 'number' ? active : -1;

        const prev = sel.value;
        sel.replaceChildren();

        const none = document.createElement('option');
        none.value = '-1';
        none.textContent = game.i18n.localize('SPEAKERSTAGE.Background.Dialog.None');
        sel.appendChild(none);

        for (let i = 0; i < MAX_SLOTS; i++) {
            if (!slotRecordHasAnyImage(records[i])) continue;
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = records[i]?.name?.trim() || defaultSlotName(i);
            sel.appendChild(opt);
        }

        const target = String(currentActive);
        if ([...sel.options].some((o) => o.value === target)) {
            sel.value = target;
        } else if (prev && [...sel.options].some((o) => o.value === prev)) {
            sel.value = prev;
        } else {
            sel.value = '-1';
        }

        const isGm = !!game.user?.isGM;
        sel.disabled = !isGm;
        sel.classList.toggle('lichsoma-stage-bg-scene-select--players-hidden', !isGm);
        if (isGm) sel.removeAttribute('aria-hidden');
        else sel.setAttribute('aria-hidden', 'true');
    }

    static _bindOverlaySceneSelect(shell) {
        const sel = shell.querySelector('.lichsoma-stage-bg-scene-select');
        if (!sel || this._sceneSelectBoundSelects.has(sel)) return;
        this._sceneSelectBoundSelects.add(sel);
        sel.addEventListener('change', async (ev) => {
            if (!game.user?.isGM) return;
            const v = parseInt(ev.target.value, 10);
            const idx = Number.isNaN(v) ? -1 : v;
            await this.saveActiveIndex(idx);
            /* updateSetting에서도 호출되지만, 직렬화된 큐로 줄 세워두므로 동시 두 번 실행되지 않음 */
            this.refreshBackgroundImage();
        });
    }

    static refreshBackgroundImage() {
        this._refreshBgTail = this._refreshBgTail.catch(() => {}).then(() => this._refreshBackgroundImageAsync());
    }

    static async _refreshBackgroundImageAsync() {
        const records = this.getSlotRecordsNormalized();
        const active = game.settings.get(MODULE_ID, SETTINGS.ACTIVE_INDEX);
        const idx = typeof active === 'number' ? active : -1;
        const rec = idx >= 0 && idx < MAX_SLOTS ? records[idx] : null;
        const path = resolveStageBgSourcePath(rec);

        if (!canvas?.ready) {
            this.syncOverlaySceneSelect();
            return;
        }

        this._ensureStageBackgroundPixi();
        const meshes = this._stageBgDrawablePair();
        if (!meshes?.[0] || meshes[0].destroyed || !meshes?.[1] || meshes[1].destroyed) {
            this.syncOverlaySceneSelect();
            return;
        }

        const targetUrl = path?.trim() ? routePath(path.trim()) : '';

        /* 훅+셀렉트 등으로 같은 장면으로 두 번 들어오면 snap/sync가 또 돌며 페이드 직후 미세 페이드처럼 보임 → 조기 종료 */
        if (targetUrl && targetUrl === this._stageBgDisplayedUrl) {
            const holder = meshes[this._stageBgStableIdx];
            const ok = holder.texture?.valid && holder.texture !== PIXI.Texture.EMPTY;
            if (ok) return;
        }

        const CanvasAnimation = LichsomaSpeakerStageCompat.CanvasAnimation;
        if (!CanvasAnimation) return;
        CanvasAnimation.terminateAnimation(STAGE_BG_CROSSFADE_ANIM_NAME);
        this._snapStageBgMeshesAfterInterrupt();

        const stable = meshes[this._stageBgStableIdx];
        const incoming = meshes[1 - this._stageBgStableIdx];
        const root = this._stageBgRootDrawable();

        if (!targetUrl) {
            const holder = meshes[this._stageBgStableIdx];
            const hadTex = holder.texture?.valid && holder.texture !== PIXI.Texture.EMPTY;
            if (!hadTex) {
                incoming.texture = PIXI.Texture.EMPTY;
                incoming.visible = false;
                this._stageBgDisplayedUrl = '';
                this._syncStageBgVisibility();
                this.syncOverlaySceneSelect();
                return;
            }

            if (root) CanvasAnimation.terminateAnimation(STAGE_BG_STAGE_FADE_ANIM_NAME);
            if (root) {
                this._stageBgStageFadeRequestId++;
                this._stageBgStageFadeActive = false;
            }
            if (root && !root.destroyed) root.alpha = 1;
            holder.alpha = 1;
            holder.visible = true;
            this._updateStageBgMeshLayout();
            this._syncStageBgVisibility();

            let completed = true;
            try {
                completed = await CanvasAnimation.animate(
                    [{ parent: root ?? holder, attribute: 'alpha', from: root?.alpha ?? holder.alpha, to: 0 }],
                    {
                        duration: Math.round(STAGE_BG_CROSSFADE_MS * 0.85),
                        easing: 'easeInOutCosine',
                        name: root ? STAGE_BG_STAGE_FADE_ANIM_NAME : STAGE_BG_CROSSFADE_ANIM_NAME
                    }
                );
            } catch {
                completed = false;
            }

            if (!completed) {
                if (root && !root.destroyed) root.alpha = 1;
                this._snapStageBgMeshesAfterInterrupt();
                this.syncOverlaySceneSelect();
                return;
            }

            holder.texture = PIXI.Texture.EMPTY;
            holder.alpha = 1;
            holder._lichsomaLayoutW = undefined;
            holder._lichsomaLayoutH = undefined;
            incoming.texture = PIXI.Texture.EMPTY;
            incoming.alpha = 1;
            incoming.visible = false;
            if (root && !root.destroyed) root.alpha = 1;
            this._stageBgDisplayedUrl = '';
            this._syncStageBgVisibility();
            this._updateStageBgMeshLayout();
            this.syncOverlaySceneSelect();
            return;
        }

        try {
            await PIXI.Assets.load(targetUrl);
        } catch {
            /* 로드 실패 시 EMPTY 유지 */
        }

        const newTex = PIXI.Texture.from(targetUrl);
        const texRenderable = await whenStageBgTextureRenderable(newTex);
        if (!texRenderable) {
            this.syncOverlaySceneSelect();
            return;
        }

        const stableHasTex = stable.texture?.valid && stable.texture !== PIXI.Texture.EMPTY;

        if (!stableHasTex) {
            incoming.texture = PIXI.Texture.EMPTY;
            incoming.alpha = 1;
            incoming.visible = false;

            stable.texture = newTex;
            stable.alpha = 1;
            stable.visible = true;
            stable._lichsomaLayoutW = undefined;
            stable._lichsomaLayoutH = undefined;
            if (root) CanvasAnimation.terminateAnimation(STAGE_BG_STAGE_FADE_ANIM_NAME);
            if (root) {
                this._stageBgStageFadeRequestId++;
                this._stageBgStageFadeActive = false;
            }
            if (root && !root.destroyed) root.alpha = 0;

            this._updateStageBgMeshLayout();
            this._syncStageBgVisibility();

            let fadeInDone = true;
            try {
                fadeInDone = await CanvasAnimation.animate(
                    [{ parent: root ?? stable, attribute: 'alpha', from: root?.alpha ?? 0, to: 1 }],
                    {
                        duration: STAGE_BG_CROSSFADE_MS,
                        easing: 'easeInOutCosine',
                        name: root ? STAGE_BG_STAGE_FADE_ANIM_NAME : STAGE_BG_CROSSFADE_ANIM_NAME
                    }
                );
            } catch {
                fadeInDone = false;
            }

            if (!fadeInDone) {
                if (root && !root.destroyed) root.alpha = 1;
                this._snapStageBgMeshesAfterInterrupt();
                this.syncOverlaySceneSelect();
                return;
            }

            stable.alpha = 1;
            if (root && !root.destroyed) root.alpha = 1;
            this._stageBgDisplayedUrl = targetUrl;
            this._updateStageBgMeshLayout();
            this._syncStageBgVisibility();
            this.syncOverlaySceneSelect();
            return;
        }

        this._stageBgCrossfadeActive = true;
        let completed = true;
        try {
            incoming.texture = newTex;
            incoming.alpha = 0;
            incoming.visible = true;
            stable.alpha = 1;
            stable.visible = true;
            incoming._lichsomaLayoutW = undefined;
            incoming._lichsomaLayoutH = undefined;

            stable.sort = -999998;
            incoming.sort = -999997;

            this._updateStageBgMeshLayout();
            this._syncStageBgVisibility();

            completed = await CanvasAnimation.animate(
                [
                    { parent: stable, attribute: 'alpha', from: stable.alpha, to: 0 },
                    { parent: incoming, attribute: 'alpha', from: 0, to: 1 }
                ],
                {
                    duration: STAGE_BG_CROSSFADE_MS,
                    easing: 'easeInOutCosine',
                    name: STAGE_BG_CROSSFADE_ANIM_NAME
                }
            );
        } catch {
            completed = false;
        }

        if (!completed) {
            this._stageBgCrossfadeActive = false;
            this._snapStageBgMeshesAfterInterrupt();
            this.syncOverlaySceneSelect();
            return;
        }

        stable.visible = false;
        stable.alpha = 0;

        incoming.alpha = 1;
        incoming.visible = true;
        this._stageBgStableIdx = 1 - this._stageBgStableIdx;
        this._stageBgDisplayedUrl = targetUrl;
        this._stageBgCrossfadeActive = false;

        this._updateStageBgMeshLayout();
        this._syncStageBgVisibility();
        this.syncOverlaySceneSelect();
    }

    static _openImageFilePicker({ current, callback }) {
        const FilePickerImpl = LichsomaSpeakerStageCompat.FilePicker || globalThis.FilePicker;
        if (!FilePickerImpl) return;
        new FilePickerImpl({
            type: 'image',
            current: current || '',
            callback
        }).render(true);
    }
}

const StageBackgroundSettingApp = createBackgroundSettingApp(StageBackground, {
    MODULE_ID, SETTINGS, MAX_SLOTS, TIME_OF_DAY_KEYS, defaultSlotName, emptyTimesMap, slotRecordHasAnyImage, routePath
});

StageBackground.initialize();
