/**
 * 스테이지 배경 이미지 — 장면과 무관하게 표시·전환 (월드 설정 + 파일 픽커 그리드)
 */

const MODULE_ID = 'lichsoma-speaker-stage';

const LTW_MODULE_ID = 'lichsoma-time-and-weather';
/** lichsoma-daily-calendar — time-and-weather 배포 분기, 동일 `timeOfDay` 설정 키 */
const LDC_MODULE_ID = 'lichsoma-daily-calendar';
const LTW_SETTING_TIME_OF_DAY = 'timeOfDay';
const TIME_OF_DAY_KEYS = ['morning', 'afternoon', 'latenight'];

/**
 * 시간대 월드 설정을 제공하는 모듈 ID. Time & Weather 우선, 없으면 Daily Calendar.
 * @returns {string|null}
 */
function getActiveTimeOfDayModuleId() {
    if (game.modules.get(LTW_MODULE_ID)?.active) return LTW_MODULE_ID;
    if (game.modules.get(LDC_MODULE_ID)?.active) return LDC_MODULE_ID;
    return null;
}

const SETTINGS = {
    SLOTS: 'stageBackgroundSlots',
    ACTIVE_INDEX: 'stageBackgroundActiveIndex',
    MINI_MODE: 'stageBackgroundMiniMode',
    /** 월드 — Interface(Token 위)에서 배경을 그림 · 프레임/오버레이 포인터 차단(config에서 토글, 리로드 필요) */
    NARRATIVE_MODE: 'stageBackgroundNarrativeMode',
    /** 월드 — Time & Weather 또는 Daily Calendar 활성 + 본 설정 ON일 때 슬롯별 오전/오후/심야 이미지 사용 */
    LINK_TIME_BACKGROUNDS: 'stageBackgroundLinkTimeOfDay'
};

const MAX_SLOTS = 99;

/** 활성 배경 슬롯 전환 시 교차 페이드(ms) */
const STAGE_BG_CROSSFADE_MS = 480;

/** 진행 중 페이드를 끊고 새 장면으로 바꿀 때 CanvasAnimation 이름 */
const STAGE_BG_CROSSFADE_ANIM_NAME = 'lichsomaSpeakerStageBgCrossfade';

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
        const modId = getActiveTimeOfDayModuleId();
        if (modId) {
            const v = game.settings.get(modId, LTW_SETTING_TIME_OF_DAY);
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
    /** @type {number} 0 또는 1 — 페이드 종료 후 현재 이미지를 들고 있는 메시 */
    static _stageBgStableIdx = 0;
    /** 마지막으로 표시에 성공한 이미지 URL(route 후) — 동일 선택 시 페이드 생략 */
    static _stageBgDisplayedUrl = '';
    /** 슬롯↔슬롯 교차 페이드 중에는 두 메시 모두 그려야 함(_syncStageBgVisibility 분기용) */
    static _stageBgCrossfadeActive = false;
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
            this._startLayerMountObservers();
            this._tryMountBackgroundLayers();
            if (game.canvas?.ready) {
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

    /** Time & Weather 또는 Daily Calendar 활성 + 월드 설정 「시간대 연동」 ON */
    static isTimeVariantBackgroundActive() {
        try {
            return !!(getActiveTimeOfDayModuleId() && game.settings.get(MODULE_ID, SETTINGS.LINK_TIME_BACKGROUNDS));
        } catch {
            return false;
        }
    }

    static _onUpdateSetting(setting) {
        const k = setting?.key ?? '';
        if (k === `${MODULE_ID}.${SETTINGS.SLOTS}` || k === `${MODULE_ID}.${SETTINGS.ACTIVE_INDEX}`) {
            this.refreshBackgroundImage();
        }
        if (k === `${MODULE_ID}.${SETTINGS.LINK_TIME_BACKGROUNDS}`) {
            this.refreshBackgroundImage();
        }
        if (
            (k === `${LTW_MODULE_ID}.${LTW_SETTING_TIME_OF_DAY}` || k === `${LDC_MODULE_ID}.${LTW_SETTING_TIME_OF_DAY}`) &&
            this.isTimeVariantBackgroundActive()
        ) {
            this.refreshBackgroundImage();
        }
        if (k === `${MODULE_ID}.${SETTINGS.MINI_MODE}`) {
            this._syncStageBgMiniModeShell();
            this._updateStageBgMeshLayout();
            this._syncStageBgNarrativeModeUI();
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

    static _startLayerMountObservers() {
        const iface = document.getElementById('interface');
        if (!iface || this._overlayWatchStarted) return;
        this._overlayWatchStarted = true;
        this._interfaceObserver = new MutationObserver(() => this._tryMountBackgroundLayers());
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
        return this._stageBgUsesInterfaceLayer() ? this._stageBgInterfaceSprites : this._stageBgMeshes;
    }

    static _destroyInterfaceStageBgSprites() {
        const root = this._stageBgInterfaceRoot;
        this._stageBgInterfaceRoot = null;
        this._stageBgInterfaceSprites = null;
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
            root.parent === canvas.interface;

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

        const sUnder = mkSprite(-999998);
        const sOver = mkSprite(-999997);
        r.addChild(sUnder);
        r.addChild(sOver);

        canvas.interface.addChild(r);
        canvas.interface.sortChildren?.();

        this._stageBgInterfaceRoot = r;
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

    /** 일반 모드: Primary 메시만 유지 · 내러티브: Interface 스프라이트만 유지(settings 변경 시 리로드 가정) */
    static _ensureStageBackgroundPixi() {
        if (!canvas?.ready) return;
        if (this._stageBgUsesInterfaceLayer()) {
            this._ensureInterfaceStageBgSprites();
        } else {
            this._ensurePrimaryStageBgMeshes();
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

        const PrimarySpriteMesh = foundry.canvas.primary.PrimarySpriteMesh;
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

    static _attachStageBgTicker() {
        const app = canvas?.app;
        if (!app?.ticker) return;
        if (this._stageBgTickerAttached && this._stageBgTickerApp !== app) {
            this._detachStageBgTicker();
        }
        if (this._stageBgTickerAttached) return;

        this._stageBgTickerCb = () => {
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
        foundry.canvas.animation.CanvasAnimation.terminateAnimation(STAGE_BG_CROSSFADE_ANIM_NAME);
        this._stageBgCrossfadeActive = false;
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

        const useIface = this._stageBgUsesInterfaceLayer();
        if (!useIface) this._syncStageBgMeshesElevation();

        const frame = document.querySelector('#lichsoma-stage-overlay .lichsoma-stage-background-frame');
        if (!frame) {
            for (const d of drawables) {
                if (d && !d.destroyed) d.visible = false;
            }
            return;
        }

        const r = frame.getBoundingClientRect();
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

            if (!useIface) {
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
                 * Interface 그룹은 팬·줌 시 스테이지 변환을 따라가므로,
                 * x/y(월드 좌표)가 계속 변한다. w/h가 동일해도 항상 cover 배치를 갱신해야 화면 고정 rect를 유지한다.
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

    /** 장면 셀렉트만 오버레이에 두고, 레이아웃은 보드 쪽 셸과 동일 클래스로 맞춤 */
    static _ensureOverlaySceneShell(overlayEl) {
        let shell = overlayEl.querySelector(':scope > .lichsoma-stage-background-shell');
        if (!shell) {
            shell = document.createElement('div');
            shell.className = 'lichsoma-stage-background-shell lichsoma-stage-background-shell--overlay-ui';
            shell.innerHTML = `
                <div class="lichsoma-stage-background-shell-inner">
                    <div class="lichsoma-stage-background-frame lichsoma-stage-background-frame--overlay-ui">
                        <div class="lichsoma-stage-bg-narrative-blocker" aria-hidden="true"></div>
                        <div class="lichsoma-stage-bg-scene-bar">
                            <button type="button" id="lichsoma-stage-bg-mini-toggle" class="lichsoma-stage-bg-mini-toggle"></button>
                            <select id="lichsoma-stage-bg-overlay-select" class="lichsoma-stage-bg-scene-select" aria-label=""></select>
                        </div>
                    </div>
                </div>
            `;
            const sel = shell.querySelector('.lichsoma-stage-bg-scene-select');
            if (sel) sel.setAttribute('aria-label', game.i18n.localize('SPEAKERSTAGE.Background.Overlay.SceneAria'));
            overlayEl.insertBefore(shell, overlayEl.firstChild);
        } else {
            const frame = shell.querySelector('.lichsoma-stage-background-frame');
            const bar = frame?.querySelector('.lichsoma-stage-bg-scene-bar');
            if (frame && !bar) {
                const wrap = document.createElement('div');
                wrap.className = 'lichsoma-stage-bg-scene-bar';
                wrap.innerHTML =
                    '<button type="button" id="lichsoma-stage-bg-mini-toggle" class="lichsoma-stage-bg-mini-toggle"></button>' +
                    '<select id="lichsoma-stage-bg-overlay-select" class="lichsoma-stage-bg-scene-select" aria-label=""></select>';
                const sel = wrap.querySelector('.lichsoma-stage-bg-scene-select');
                if (sel) sel.setAttribute('aria-label', game.i18n.localize('SPEAKERSTAGE.Background.Overlay.SceneAria'));
                frame.appendChild(wrap);
            }
            const barFinal = frame?.querySelector('.lichsoma-stage-bg-scene-bar');
            if (barFinal && !barFinal.querySelector('#lichsoma-stage-bg-mini-toggle')) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.id = 'lichsoma-stage-bg-mini-toggle';
                btn.className = 'lichsoma-stage-bg-mini-toggle';
                barFinal.insertBefore(btn, barFinal.firstChild);
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
        });
    }

    static _ensureOverlayAttributeObserver(overlayEl) {
        if (overlayEl === this._overlayAttrObservedTarget) return;
        if (this._overlayAttrObserver) this._overlayAttrObserver.disconnect();
        this._overlayAttrObserver = new MutationObserver(() => {
            StageBackground._updateStageBgMeshLayout();
            StageBackground._syncStageBgVisibility();
            StageBackground._syncStageBgNarrativeModeUI();
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
        const meshes = this._stageBgDrawablePair();
        if (!meshes?.length) return;
        const ov = document.getElementById('lichsoma-stage-overlay');
        const overlayHidden = !ov || ov.classList.contains('hidden');
        const frameOk = this._stageBgOverlayFrameRenderable();

        for (let i = 0; i < meshes.length; i++) {
            const mesh = meshes[i];
            if (!mesh || mesh.destroyed) continue;
            const hasTex = !!(mesh.texture && mesh.texture !== PIXI.Texture.EMPTY && mesh.texture.valid);
            const eligible =
                hasTex && (this._stageBgCrossfadeActive || i === this._stageBgStableIdx);
            mesh.visible = !overlayHidden && frameOk && eligible;
        }
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

        const CanvasAnimation = foundry.canvas.animation.CanvasAnimation;
        CanvasAnimation.terminateAnimation(STAGE_BG_CROSSFADE_ANIM_NAME);
        this._snapStageBgMeshesAfterInterrupt();

        const stable = meshes[this._stageBgStableIdx];
        const incoming = meshes[1 - this._stageBgStableIdx];

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

            holder.visible = true;
            let completed = true;
            try {
                completed = await CanvasAnimation.animate(
                    [{ parent: holder, attribute: 'alpha', from: holder.alpha, to: 0 }],
                    {
                        duration: Math.round(STAGE_BG_CROSSFADE_MS * 0.85),
                        easing: 'easeInOutCosine',
                        name: STAGE_BG_CROSSFADE_ANIM_NAME
                    }
                );
            } catch {
                completed = false;
            }

            if (!completed) {
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
            stable.alpha = 0;
            stable.visible = true;
            stable._lichsomaLayoutW = undefined;
            stable._lichsomaLayoutH = undefined;

            this._updateStageBgMeshLayout();
            this._syncStageBgVisibility();

            let fadeInDone = true;
            try {
                fadeInDone = await CanvasAnimation.animate(
                    [{ parent: stable, attribute: 'alpha', from: 0, to: 1 }],
                    {
                        duration: STAGE_BG_CROSSFADE_MS,
                        easing: 'easeInOutCosine',
                        name: STAGE_BG_CROSSFADE_ANIM_NAME
                    }
                );
            } catch {
                fadeInDone = false;
            }

            if (!fadeInDone) {
                this._snapStageBgMeshesAfterInterrupt();
                this.syncOverlaySceneSelect();
                return;
            }

            stable.alpha = 1;
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
        const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
        new FilePickerImpl({
            type: 'image',
            current: current || '',
            callback
        }).render(true);
    }
}

/**
 * 배경 장면 그리드 설정 — Speaker Selector 액터 격자 설정과 유사한 ApplicationV2
 */
class StageBackgroundSettingApp extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: 'lichsoma-stage-background-setting',
        classes: ['lichsoma-stage-background-setting-app'],
        tag: 'div',
        window: {
            frame: true,
            positioned: true,
            title: 'SPEAKERSTAGE.Background.Dialog.Title',
            resizable: true,
            minimizable: false,
            contentClasses: ['lichsoma-stage-background-setting-content']
        },
        position: {
            width: 720,
            height: 620
        }
    };

    /** @type {{ path: string, name: string, times: { morning: string, afternoon: string, latenight: string } }[]} */
    _scratchRecords = [];

    async _prepareContext(options) {
        return {};
    }

    async _renderHTML(context, options) {
        this._scratchRecords = StageBackground.getSlotRecordsNormalized().map((r) => ({
            path: r.path ?? '',
            name: r.name ?? '',
            times: {
                morning: r.times?.morning ?? '',
                afternoon: r.times?.afternoon ?? '',
                latenight: r.times?.latenight ?? ''
            }
        }));

        const wrap = document.createElement('div');
        wrap.className = 'lichsoma-stage-bg-app-inner';

        const toolbar = document.createElement('div');
        toolbar.className = 'lichsoma-stage-bg-setting-toolbar';
        const label = document.createElement('label');
        label.textContent = game.i18n.localize('SPEAKERSTAGE.Background.Dialog.ActiveLabel');
        label.setAttribute('for', 'lichsoma-stage-bg-active-select');
        const select = document.createElement('select');
        select.id = 'lichsoma-stage-bg-active-select';

        toolbar.append(label, select);

        const scroll = document.createElement('div');
        scroll.className = 'lichsoma-stage-bg-setting-scroll';
        const grid = document.createElement('div');
        grid.className = 'lichsoma-stage-bg-grid';

        const activeIdx = game.settings.get(MODULE_ID, SETTINGS.ACTIVE_INDEX);

        for (let i = 0; i < MAX_SLOTS; i++) {
            grid.appendChild(this._createSlotEl(i, activeIdx));
        }

        this._populateActiveSelect(select, activeIdx);

        select.addEventListener('change', async () => {
            const v = parseInt(select.value, 10);
            const active = Number.isNaN(v) ? -1 : v;
            await StageBackground.saveActiveIndex(active);
            StageBackground.refreshBackgroundImage();
            this._highlightActiveSlots(active);
        });

        grid.addEventListener('click', (ev) => {
            if (ev.target.closest('.lichsoma-stage-bg-slot-name')) return;

            const slot = ev.target.closest('.lichsoma-stage-bg-slot');
            if (!slot) return;
            const idx = parseInt(slot.dataset.slotIndex, 10);
            if (Number.isNaN(idx)) return;

            const tri = StageBackground.isTimeVariantBackgroundActive();

            if (tri) {
                const timeClear = ev.target.closest('.lichsoma-stage-bg-time-clear');
                const timeCell = ev.target.closest('.lichsoma-stage-bg-time-cell');

                const persistAndRedraw = async () => {
                    this._redrawSlot(slot, idx);
                    await StageBackground.saveSlots(this._scratchRecords);
                    this._populateActiveSelect(select, game.settings.get(MODULE_ID, SETTINGS.ACTIVE_INDEX));
                    StageBackground.refreshBackgroundImage();
                };

                if (timeClear) {
                    ev.stopPropagation();
                    const key = timeClear.dataset.timeOfDay;
                    if (!TIME_OF_DAY_KEYS.includes(key)) return;
                    this._scratchRecords[idx].times[key] = '';
                    if (key === 'morning') this._scratchRecords[idx].path = '';
                    void persistAndRedraw();
                    return;
                }
                if (timeCell && !ev.target.closest('.lichsoma-stage-bg-time-clear')) {
                    ev.stopPropagation();
                    const key = timeCell.dataset.timeOfDay;
                    if (!TIME_OF_DAY_KEYS.includes(key)) return;
                    const current = this._scratchRecords[idx].times[key] || '';
                    StageBackground._openImageFilePicker({
                        current,
                        callback: async (path) => {
                            if (typeof path !== 'string') return;
                            this._scratchRecords[idx].times[key] = path;
                            await persistAndRedraw();
                        }
                    });
                    return;
                }
                return;
            }

            const clearBtn = ev.target.closest('.lichsoma-stage-bg-slot-clear');
            if (clearBtn) {
                ev.stopPropagation();
                if (!this._scratchRecords[idx].times) this._scratchRecords[idx].times = emptyTimesMap();
                this._scratchRecords[idx].path = '';
                this._scratchRecords[idx].times.morning = '';
                this._redrawSlot(slot, idx);
                void StageBackground.saveSlots(this._scratchRecords);
                this._populateActiveSelect(select, game.settings.get(MODULE_ID, SETTINGS.ACTIVE_INDEX));
                StageBackground.refreshBackgroundImage();
                return;
            }

            const rec = this._scratchRecords[idx];
            const current = (rec.times?.morning || '').trim() || (rec.path || '').trim();
            StageBackground._openImageFilePicker({
                current,
                callback: async (path) => {
                    if (typeof path !== 'string') return;
                    if (!rec.times) rec.times = emptyTimesMap();
                    rec.times.morning = path;
                    rec.path = path;
                    this._redrawSlot(slot, idx);
                    await StageBackground.saveSlots(this._scratchRecords);
                    this._populateActiveSelect(select, game.settings.get(MODULE_ID, SETTINGS.ACTIVE_INDEX));
                    StageBackground.refreshBackgroundImage();
                }
            });
        });

        grid.addEventListener('change', (ev) => {
            const inp = ev.target.closest('.lichsoma-stage-bg-slot-name');
            if (!inp || inp.tagName !== 'INPUT') return;
            const idx = parseInt(inp.dataset.slotIndex, 10);
            if (Number.isNaN(idx)) return;
            const trimmed = inp.value.trim();
            this._scratchRecords[idx].name = trimmed || defaultSlotName(idx);
            inp.value = this._scratchRecords[idx].name;
            void StageBackground.saveSlots(this._scratchRecords);
            this._populateActiveSelect(select, game.settings.get(MODULE_ID, SETTINGS.ACTIVE_INDEX));
        });

        grid.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' || !ev.target.classList.contains('lichsoma-stage-bg-slot-name')) return;
            ev.preventDefault();
            ev.target.blur();
        });

        grid.addEventListener('dragstart', (e) => {
            const slot = e.target.closest('.lichsoma-stage-bg-slot');
            if (!slot || !grid.contains(slot)) return;
            if (StageBackground.isTimeVariantBackgroundActive()) {
                if (
                    e.target.closest('.lichsoma-stage-bg-time-clear') ||
                    e.target.closest('.lichsoma-stage-bg-time-placeholder-inner') ||
                    e.target.closest('.lichsoma-stage-bg-slot-name-row')
                ) {
                    e.preventDefault();
                    return;
                }
            } else if (
                e.target.closest('.lichsoma-stage-bg-slot-clear') ||
                e.target.closest('.lichsoma-stage-bg-slot-name-row')
            ) {
                e.preventDefault();
                return;
            }
            const from = parseInt(slot.dataset.slotIndex, 10);
            if (Number.isNaN(from)) return;
            e.dataTransfer.setData('text/plain', String(from));
            e.dataTransfer.effectAllowed = 'move';
            slot.classList.add('lichsoma-stage-bg-slot--dragging');
        });

        grid.addEventListener('dragend', () => {
            grid.querySelectorAll('.lichsoma-stage-bg-slot--dragging').forEach((el) =>
                el.classList.remove('lichsoma-stage-bg-slot--dragging')
            );
            grid.querySelectorAll('.lichsoma-stage-bg-slot--drag-over').forEach((el) =>
                el.classList.remove('lichsoma-stage-bg-slot--drag-over')
            );
        });

        grid.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const slot = e.target.closest('.lichsoma-stage-bg-slot');
            grid.querySelectorAll('.lichsoma-stage-bg-slot--drag-over').forEach((el) =>
                el.classList.remove('lichsoma-stage-bg-slot--drag-over')
            );
            if (slot && grid.contains(slot)) slot.classList.add('lichsoma-stage-bg-slot--drag-over');
        });

        grid.addEventListener('drop', async (e) => {
            e.preventDefault();
            const slot = e.target.closest('.lichsoma-stage-bg-slot');
            grid.querySelectorAll('.lichsoma-stage-bg-slot--drag-over').forEach((el) =>
                el.classList.remove('lichsoma-stage-bg-slot--drag-over')
            );
            if (!slot || !grid.contains(slot)) return;

            const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
            const to = parseInt(slot.dataset.slotIndex, 10);
            if (Number.isNaN(from) || Number.isNaN(to) || from === to) return;
            if (!this._reorderScratchRecords(from, to)) return;

            const curActive = game.settings.get(MODULE_ID, SETTINGS.ACTIVE_INDEX);
            const n = typeof curActive === 'number' ? curActive : -1;
            const newActive = this._mapActiveIndexAfterSlotReorder(n, from, to);

            await StageBackground.saveSlots(this._scratchRecords);
            if (newActive !== n) await StageBackground.saveActiveIndex(newActive);

            this._rebuildSlotGrid(grid, select);
            StageBackground.refreshBackgroundImage();
        });

        scroll.appendChild(grid);
        wrap.append(toolbar, scroll);

        return wrap;
    }

    /** 슬롯 레코드 한 칸을 from → to 위치로 옮김 */
    _reorderScratchRecords(fromIdx, toIdx) {
        const from = Number(fromIdx);
        const to = Number(toIdx);
        if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return false;
        if (from < 0 || from >= MAX_SLOTS || to < 0 || to >= MAX_SLOTS) return false;
        const rec = this._scratchRecords[from];
        this._scratchRecords.splice(from, 1);
        this._scratchRecords.splice(to, 0, rec);
        return true;
    }

    /**
     * 배열에서 한 요소를 옮긴 뒤 월드 설정의 활성 슬롯 인덱스 보정.
     * @param {number} active
     * @param {number} from
     * @param {number} to
     */
    _mapActiveIndexAfterSlotReorder(active, from, to) {
        if (typeof active !== 'number' || active < 0) return active;
        if (active === from) return to;
        if (from < to) {
            if (active > from && active <= to) return active - 1;
        } else if (from > to) {
            if (active >= to && active < from) return active + 1;
        }
        return active;
    }

    _rebuildSlotGrid(gridEl, selectEl) {
        const activeIdx = game.settings.get(MODULE_ID, SETTINGS.ACTIVE_INDEX);
        const a = typeof activeIdx === 'number' ? activeIdx : -1;
        gridEl.replaceChildren();
        for (let i = 0; i < MAX_SLOTS; i++) {
            gridEl.appendChild(this._createSlotEl(i, a));
        }
        this._populateActiveSelect(selectEl, a);
        this._highlightActiveSlots(a);
    }

    _populateActiveSelect(select, currentActive) {
        const prev = select.value;
        select.replaceChildren();

        const none = document.createElement('option');
        none.value = '-1';
        none.textContent = game.i18n.localize('SPEAKERSTAGE.Background.Dialog.None');
        select.appendChild(none);

        const records = this._scratchRecords;
        for (let i = 0; i < MAX_SLOTS; i++) {
            if (!slotRecordHasAnyImage(records[i])) continue;
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = records[i]?.name?.trim() || defaultSlotName(i);
            select.appendChild(opt);
        }

        const target = String(currentActive);
        if ([...select.options].some((o) => o.value === target)) {
            select.value = target;
        } else if (prev && [...select.options].some((o) => o.value === prev)) {
            select.value = prev;
        } else {
            select.value = '-1';
        }
    }

    _highlightActiveSlots(activeIdx) {
        const root = this.element?.querySelector('.lichsoma-stage-bg-grid');
        if (!root) return;
        root.querySelectorAll('.lichsoma-stage-bg-slot').forEach((el) => {
            const i = parseInt(el.dataset.slotIndex, 10);
            el.classList.toggle('is-active-slot', i === activeIdx);
        });
    }

    /**
     * @param {number} index
     * @param {number} activeIdx
     */
    _createSlotEl(index, activeIdx) {
        const slot = document.createElement('div');
        slot.className = 'lichsoma-stage-bg-slot';
        if (index === activeIdx) slot.classList.add('is-active-slot');
        slot.dataset.slotIndex = String(index);

        const rec = this._scratchRecords[index] ?? {
            path: '',
            name: defaultSlotName(index),
            times: emptyTimesMap()
        };
        if (!rec.times) rec.times = emptyTimesMap();

        const displayName = rec.name?.trim() || defaultSlotName(index);

        const tri = StageBackground.isTimeVariantBackgroundActive();

        if (tri) {
            slot.classList.add('lichsoma-stage-bg-slot--time-variant');
            slot.draggable = true;
            slot.title = game.i18n.localize('SPEAKERSTAGE.Background.Dialog.SlotDragReorderHint');

            const previewStack = document.createElement('div');
            previewStack.className = 'lichsoma-stage-bg-slot-time-stack';

            const timeStrip = document.createElement('div');
            timeStrip.className = 'lichsoma-stage-bg-slot-time-strip';
            for (const key of TIME_OF_DAY_KEYS) {
                const cell = document.createElement('div');
                cell.className = 'lichsoma-stage-bg-time-cell';
                cell.dataset.timeOfDay = key;

                const lab = document.createElement('span');
                lab.className = 'lichsoma-stage-bg-time-label';
                lab.textContent = game.i18n.localize(`SPEAKERSTAGE.Background.Dialog.Time.${key}`);

                const tpath = (rec.times[key] || '').trim();
                const mediaWrap = document.createElement('div');
                const sliceMod =
                    key === 'morning'
                        ? 'lichsoma-stage-bg-time-slice--left'
                        : key === 'afternoon'
                          ? 'lichsoma-stage-bg-time-slice--center'
                          : 'lichsoma-stage-bg-time-slice--right';

                const placeholderHtml =
                    '<span class="lichsoma-stage-bg-time-add-btn"><i class="fas fa-plus"></i></span>';

                const tc = document.createElement('button');
                tc.type = 'button';
                tc.className = 'lichsoma-stage-bg-time-clear';
                tc.title = game.i18n.localize('SPEAKERSTAGE.Background.Dialog.Clear');
                tc.dataset.timeOfDay = key;
                tc.innerHTML = '<i class="fas fa-times"></i>';

                const addPlaceholder = () => {
                    mediaWrap.replaceChildren();
                    mediaWrap.style.backgroundImage = '';
                    mediaWrap.className = 'lichsoma-stage-bg-time-media';
                    mediaWrap.removeAttribute('role');
                    mediaWrap.setAttribute('aria-label', lab.textContent);
                    const ph = document.createElement('div');
                    ph.className = 'lichsoma-stage-bg-time-placeholder-inner';
                    ph.innerHTML = placeholderHtml;
                    mediaWrap.appendChild(ph);
                };

                if (!tpath) {
                    addPlaceholder();
                    cell.append(lab, mediaWrap);
                } else {
                    mediaWrap.className = `lichsoma-stage-bg-time-media lichsoma-stage-bg-time-slice ${sliceMod}`;
                    mediaWrap.setAttribute('role', 'img');
                    mediaWrap.setAttribute('aria-label', lab.textContent);
                    const u = routePath(tpath);
                    const probe = new Image();
                    probe.onload = () => {
                        mediaWrap.style.backgroundImage = `url(${JSON.stringify(u)})`;
                        cell.appendChild(tc);
                    };
                    probe.onerror = () => {
                        addPlaceholder();
                    };
                    probe.src = u;
                    cell.append(lab, mediaWrap);
                }

                timeStrip.appendChild(cell);
            }

            previewStack.append(timeStrip);
            slot.append(previewStack);
        } else {
            slot.draggable = true;
            slot.title = game.i18n.localize('SPEAKERSTAGE.Background.Dialog.SlotDragReorderHint');

            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'lichsoma-stage-bg-slot-clear';
            clearBtn.title = game.i18n.localize('SPEAKERSTAGE.Background.Dialog.Clear');
            clearBtn.innerHTML = '<i class="fas fa-times"></i>';

            const singleSrc = (rec.times?.morning || '').trim() || (rec.path || '').trim();
            if (singleSrc) {
                const img = document.createElement('img');
                img.className = 'lichsoma-stage-bg-slot-preview';
                img.alt = displayName;
                img.draggable = false;
                img.src = routePath(singleSrc);
                slot.append(clearBtn, img);
            } else {
                const ph = document.createElement('div');
                ph.className = 'lichsoma-stage-bg-slot-placeholder';
                ph.innerHTML = `<i class="fas fa-plus"></i><span>${game.i18n.localize('SPEAKERSTAGE.Background.Dialog.AddImage')}</span>`;
                slot.append(clearBtn, ph);
            }
        }

        const nameRow = document.createElement('div');
        nameRow.className = 'lichsoma-stage-bg-slot-name-row';
        const nameInp = document.createElement('input');
        nameInp.type = 'text';
        nameInp.className = 'lichsoma-stage-bg-slot-name';
        nameInp.dataset.slotIndex = String(index);
        nameInp.value = displayName;
        nameInp.setAttribute('aria-label', game.i18n.localize('SPEAKERSTAGE.Background.Dialog.NameAria'));
        nameInp.placeholder = game.i18n.localize('SPEAKERSTAGE.Background.Dialog.NamePlaceholder');
        nameInp.addEventListener('mousedown', (e) => e.stopPropagation());
        nameInp.addEventListener('click', (e) => e.stopPropagation());
        nameRow.appendChild(nameInp);
        slot.appendChild(nameRow);

        return slot;
    }

    _redrawSlot(slotEl, index) {
        const activeIdx = game.settings.get(MODULE_ID, SETTINGS.ACTIVE_INDEX);
        const newEl = this._createSlotEl(index, activeIdx);
        slotEl.replaceWith(newEl);
        this._highlightActiveSlots(activeIdx);
    }

    _replaceHTML(result, content, options) {
        content.replaceChildren(result);
    }

    _onClose(options) {
        void StageBackground.saveSlots(this._scratchRecords);
    }
}

StageBackground.initialize();
