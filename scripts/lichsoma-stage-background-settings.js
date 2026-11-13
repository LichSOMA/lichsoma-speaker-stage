/** Background settings UI; the renderer is injected to avoid circular imports. */
export function createBackgroundSettingApp(StageBackground, { MODULE_ID, SETTINGS, MAX_SLOTS, TIME_OF_DAY_KEYS, defaultSlotName, emptyTimesMap, slotRecordHasAnyImage, routePath }) {
    /**
     * 배경 장면 그리드 설정 — Speaker Selector 액터 격자 설정과 유사한 ApplicationV2
     */
    class StageBackgroundSettingApp extends LichsomaSpeakerStageCompat.ApplicationV2 {
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
            const root = LichsomaSpeakerStageCompat.asElement(this)?.querySelector('.lichsoma-stage-bg-grid');
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
            const target = LichsomaSpeakerStageCompat.asElement(content) ?? content;
            if (target?.replaceChildren) target.replaceChildren(result);
        }
    
        _onClose(options) {
            void StageBackground.saveSlots(this._scratchRecords);
        }
    }
    return StageBackgroundSettingApp;
}
