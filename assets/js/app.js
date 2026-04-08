const GOOGLE_SHEETS_ID = '1hgfQc8dkvFAEuFU9a9walmsq_wj7FQQQwYW9oXzYWPY';
const WHATSAPP_NUMBER = '5491138587614';

const SHEET_NAMES = {
    categories: 'categories',
    ingredients: 'ingredients',
    sandwiches: 'sandwiches',
    sandwichesIngredients: 'sandwiches_ingredients',
    calendar: 'calendar'
};

function landingApp() {
    return {
        menu: [],
        presets: [],
        calendar: [],
        current: { pan: null },
        activePreset: null,
        pendingOrder: null,
        upsellOpen: false,
        upsellSelection: {},
        checkoutSweetOpen: false,
        checkoutSweetSelection: {},
        sheetRowsCache: {},
        cart: [],
        cartOpen: false,
        priceBump: false,

        async init() {
            try {
                const [menu, presets, calendar] = await Promise.all([
                    this.loadMenu(),
                    this.loadPresets(),
                    this.loadCalendar()
                ]);
                this.menu = menu;
                this.presets = presets;
                this.calendar = calendar;
                this.current = this.createCurrentState(this.menu);
                this.refreshIcons();
                this.$watch('cartOpen', () => this.refreshIcons());
            } catch (error) {
                throw new Error(`No se pudieron cargar datos desde Google Sheets: ${error.message}`);
            }
        },

        async loadMenu() {
            const [categoryRows, ingredientRows] = await Promise.all([
                this.getSheetRows(SHEET_NAMES.categories),
                this.getSheetRows(SHEET_NAMES.ingredients)
            ]);
            return this.buildMenuFromSheets(categoryRows, ingredientRows);
        },

        async loadPresets() {
            const [sandwichRows, sandwichIngredientRows, ingredientRows] = await Promise.all([
                this.getSheetRows(SHEET_NAMES.sandwiches),
                this.getSheetRows(SHEET_NAMES.sandwichesIngredients),
                this.getSheetRows(SHEET_NAMES.ingredients)
            ]);
            return this.buildPresetsFromSheets(sandwichRows, sandwichIngredientRows, ingredientRows);
        },

        async loadCalendar() {
            const calendarRows = await this.getSheetRows(SHEET_NAMES.calendar);
            return this.buildCalendarFromSheets(calendarRows);
        },

        async getSheetRows(sheetName) {
            if (this.sheetRowsCache[sheetName]) {
                return this.sheetRowsCache[sheetName];
            }

            const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_ID}/gviz/tq?sheet=${encodeURIComponent(sheetName)}&headers=1&tq=${encodeURIComponent('select *')}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`No se pudo leer la hoja ${sheetName}`);
            }

            const rawText = await response.text();
            const jsonStart = rawText.indexOf('{');
            const jsonEnd = rawText.lastIndexOf('}');
            if (jsonStart < 0 || jsonEnd < 0) {
                throw new Error(`Respuesta invalida para la hoja ${sheetName}`);
            }

            const parsed = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1));
            const table = parsed.table;
            const headers = (table?.cols || []).map((col, idx) => (col?.label || col?.id || `col_${idx}`).trim());

            const rows = (table?.rows || []).map((row) => {
                const obj = {};
                headers.forEach((header, idx) => {
                    obj[header] = this.getSheetCellValue(row?.c?.[idx]);
                });
                return obj;
            });

            this.sheetRowsCache[sheetName] = rows;
            return rows;
        },

        getSheetCellValue(cell) {
            if (!cell) {
                return null;
            }
            return cell.v;
        },

        asText(value) {
            if (value === null || value === undefined) {
                return '';
            }
            return String(value).trim();
        },

        asNumber(value, fallback = 0) {
            const number = Number(value);
            return Number.isFinite(number) ? number : fallback;
        },

        asBoolean(value) {
            if (typeof value === 'boolean') {
                return value;
            }
            if (value === null || value === undefined || value === '') {
                return false;
            }
            const normalized = String(value).trim().toLowerCase();
            return ['true', '1', 'yes', 'si', 'y'].includes(normalized);
        },

        rowIsActive(row) {
            if (!Object.prototype.hasOwnProperty.call(row, 'active')) {
                return true;
            }
            return this.asBoolean(row.active);
        },

        buildMenuFromSheets(categoryRows, ingredientRows) {
            const sortedCategories = [...categoryRows]
                .filter((row) => this.rowIsActive(row) && this.asText(row.id))
                .sort((a, b) => this.asNumber(a.sort_order, 999) - this.asNumber(b.sort_order, 999));

            return sortedCategories.map((categoryRow) => {
                const categoryId = this.asText(categoryRow.id);
                const items = ingredientRows
                    .filter((row) => this.rowIsActive(row) && this.asText(row.category_id) === categoryId && this.asText(row.id))
                    .sort((a, b) => this.asNumber(a.sort_order, 999) - this.asNumber(b.sort_order, 999))
                    .map((itemRow) => {
                        const item = {
                            id: this.asText(itemRow.id),
                            name: this.asText(itemRow.name),
                            price: this.asNumber(itemRow.price, 0),
                            emoji: this.asText(itemRow.emoji)
                        };
                        const portion = this.asText(itemRow.portion);
                        if (portion) {
                            item.portion = portion;
                        }
                        return item;
                    });

                return {
                    id: categoryId,
                    label: this.asText(categoryRow.label),
                    emoji: this.asText(categoryRow.emoji),
                    rule: this.asText(categoryRow.rule) || 'multiple',
                    items
                };
            });
        },

        buildPresetsFromSheets(sandwichRows, sandwichIngredientRows, ingredientRows) {
            const ingredientMap = ingredientRows.reduce((acc, row) => {
                const id = this.asText(row.id);
                if (id) {
                    acc[id] = row;
                }
                return acc;
            }, {});

            const sortedSandwiches = [...sandwichRows]
                .filter((row) => this.rowIsActive(row) && this.asText(row.id))
                .sort((a, b) => this.asNumber(a.sort_order, 999) - this.asNumber(b.sort_order, 999));

            return sortedSandwiches.map((sandwichRow) => {
                const sandwichId = this.asText(sandwichRow.id);
                const links = sandwichIngredientRows
                    .filter((row) => {
                        const linkedId = this.asText(row.preset_id || row.sandwich_id);
                        return linkedId === sandwichId;
                    })
                    .sort((a, b) => this.asNumber(a.sort_order, 999) - this.asNumber(b.sort_order, 999));

                const ingredients = {
                    pan: null,
                    fiambres: [],
                    proteinas: [],
                    vegetales: [],
                    aderezos: []
                };

                links.forEach((linkRow) => {
                    const itemId = this.asText(linkRow.item_id);
                    const qty = Math.max(1, this.asNumber(linkRow.qty, 1));
                    const linkedIngredient = ingredientMap[itemId];
                    const categoryId = this.asText(linkRow.category_id || linkedIngredient?.category_id);
                    if (!itemId || !categoryId) {
                        return;
                    }

                    if (categoryId === 'pan') {
                        ingredients.pan = itemId;
                        return;
                    }

                    if (!Object.prototype.hasOwnProperty.call(ingredients, categoryId)) {
                        return;
                    }

                    ingredients[categoryId].push({ id: itemId, qty });
                });

                return {
                    id: sandwichId,
                    name: this.asText(sandwichRow.name),
                    description: this.asText(sandwichRow.description),
                    price: this.asNumber(sandwichRow.price, 0),
                    image: this.asText(sandwichRow.image),
                    ingredients
                };
            });
        },

        buildCalendarFromSheets(calendarRows) {
            return [...calendarRows]
                .filter((row) => this.rowIsActive(row))
                .sort((a, b) => this.asNumber(a.sort_order, 999) - this.asNumber(b.sort_order, 999))
                .map((row) => ({
                    day: this.asText(row.day || row.dia),
                    name: this.asText(row.name || row.sandwich),
                    badge: this.asText(row.badge || row.tag)
                }))
                .filter((row) => row.day || row.name || row.badge);
        },

        createCurrentState(menu) {
            const state = {};
            menu.forEach((cat) => {
                state[cat.id] = cat.rule === 'single' ? null : [];
            });
            if (!Object.prototype.hasOwnProperty.call(state, 'pan')) {
                state.pan = null;
            }
            return state;
        },

        refreshIcons() {
            this.$nextTick(() => window.lucide?.createIcons());
        },

        iconForCategory(catId) {
            return {
                pan: 'wheat',
                fiambres: 'beef',
                proteinas: 'drumstick',
                vegetales: 'leaf',
                aderezos: 'droplets',
                bebidas: 'cup-soda',
                acompanamientos: 'package-open'
            }[catId] || 'circle';
        },

        requiresPan(catId) {
            return !['pan', 'bebidas', 'acompanamientos'].includes(catId);
        },

        selectedItems() {
            return this.menu.flatMap((cat) => {
                if (cat.id === 'pan') return [];
                return Array.isArray(this.current[cat.id]) ? this.current[cat.id] : [];
            });
        },

        builderCategories() {
            return this.menu.filter((cat) => !['bebidas', 'acompanamientos'].includes(cat.id));
        },

        maxQtyForCategory(catId) {
            if (catId === 'bebidas') return 6;
            if (catId === 'acompanamientos') return 4;
            return 2;
        },

        upsellCatalog() {
            return this.menu
                .filter((cat) => ['bebidas', 'acompanamientos'].includes(cat.id))
                .flatMap((cat) => cat.items.map((item) => ({ ...item, categoryId: cat.id })))
                .filter((item) => !this.isSweetUpsell(item));
        },

        isSweetUpsell(item) {
            return ['brownie'].includes(item.id);
        },

        checkoutSweetCatalog() {
            return this.menu
                .filter((cat) => cat.id === 'acompanamientos')
                .flatMap((cat) => cat.items.map((item) => ({ ...item, categoryId: cat.id })))
                .filter((item) => this.isSweetUpsell(item));
        },

        getCheckoutSweetQty(itemId) {
            return this.checkoutSweetSelection[itemId]?.qty || 0;
        },

        toggleCheckoutSweet(item) {
            const currentQty = this.getCheckoutSweetQty(item.id);
            const maxQty = this.maxQtyForCategory(item.categoryId);
            if (currentQty === 0) {
                this.checkoutSweetSelection[item.id] = { ...item, qty: 1 };
            } else if (currentQty < maxQty) {
                this.checkoutSweetSelection[item.id].qty += 1;
            } else {
                delete this.checkoutSweetSelection[item.id];
            }
        },

        checkoutSweetItems() {
            return Object.values(this.checkoutSweetSelection);
        },

        checkoutSweetTotal() {
            return this.checkoutSweetItems().reduce((sum, item) => sum + (item.price * (item.qty || 1)), 0);
        },

        getUpsellQty(itemId) {
            return this.upsellSelection[itemId]?.qty || 0;
        },

        toggleUpsell(item) {
            const currentQty = this.getUpsellQty(item.id);
            const maxQty = this.maxQtyForCategory(item.categoryId);
            if (currentQty === 0) {
                this.upsellSelection[item.id] = { ...item, qty: 1 };
            } else if (currentQty < maxQty) {
                this.upsellSelection[item.id].qty += 1;
            } else {
                delete this.upsellSelection[item.id];
            }
        },

        upsellItems() {
            return Object.values(this.upsellSelection);
        },

        upsellTotal() {
            return this.upsellItems().reduce((sum, item) => sum + (item.price * (item.qty || 1)), 0);
        },

        composeOrderFromState() {
            if (!this.canAddToCart()) {
                return null;
            }

            const isDrinkOnly = !this.activePreset && !this.current.pan && (this.current.bebidas?.length || 0) > 0 && (this.current.acompanamientos?.length || 0) === 0;
            const isSideOnly = !this.activePreset && !this.current.pan && (this.current.acompanamientos?.length || 0) > 0 && (this.current.bebidas?.length || 0) === 0;
            const isExtrasOnly = !this.activePreset && !this.current.pan;

            return {
                title: isDrinkOnly ? 'Bebidas' : (isSideOnly ? 'Extras' : (isExtrasOnly ? 'Extras' : (this.activePreset?.name || `Sanguche ${this.current.pan?.name || 'Personalizado'}`))),
                description: this.selectedDetails(),
                price: this.currentPrice()
            };
        },

        resetUpsell() {
            this.pendingOrder = null;
            this.upsellSelection = {};
            this.upsellOpen = false;
        },

        resetCheckoutSweet() {
            this.checkoutSweetSelection = {};
            this.checkoutSweetOpen = false;
        },

        resetCurrentOrder() {
            this.current = this.createCurrentState(this.menu);
            this.activePreset = null;
        },

        openUpsell(order) {
            this.pendingOrder = order;
            this.upsellSelection = {};
            this.upsellOpen = true;
            this.refreshIcons();
        },

        finalizeOrder(order) {
            this.cart.push(order);
            this.cartOpen = true;
            this.refreshIcons();
        },

        beginPresetOrder(preset) {
            this.activePreset = null;
            this.openUpsell({
                title: preset.name,
                description: preset.description,
                price: preset.price
            });
        },

        beginBuilderOrder() {
            const order = this.composeOrderFromState();
            if (!order) {
                return;
            }

            const hasSandwichBase = !!this.activePreset || (!!this.current.pan && ((this.current.fiambres?.length || 0) > 0 || (this.current.proteinas?.length || 0) > 0));
            if (!hasSandwichBase) {
                this.finalizeOrder(order);
                this.resetCurrentOrder();
                return;
            }

            this.openUpsell(order);
        },

        skipUpsell() {
            if (!this.pendingOrder) {
                return;
            }
            this.finalizeOrder(this.pendingOrder);
            this.resetUpsell();
            this.resetCurrentOrder();
        },

        confirmUpsell() {
            if (!this.pendingOrder) {
                return;
            }

            const extraDetails = this.upsellItems().map((item) => {
                const qty = item.qty || 1;
                const qtyText = qty > 1 ? ` x${qty}` : '';
                const portionText = item.portion ? ` (${item.portion})` : '';
                return `${item.name}${qtyText}${portionText}`;
            }).join(', ');

            const finalOrder = {
                ...this.pendingOrder,
                description: extraDetails
                    ? (this.pendingOrder.description ? `${this.pendingOrder.description} · ${extraDetails}` : extraDetails)
                    : this.pendingOrder.description,
                price: this.pendingOrder.price + this.upsellTotal()
            };

            this.finalizeOrder(finalOrder);
            this.resetUpsell();
            this.resetCurrentOrder();
        },

        itemIcon(item) {
            return item?.emoji || '';
        },

        findItemById(catId, itemId) {
            const category = this.menu.find((cat) => cat.id === catId);
            return category?.items.find((item) => item.id === itemId) || null;
        },

        materializePresetItems(catId, items) {
            return (items || []).map((entry) => {
                const item = this.findItemById(catId, entry.id);
                if (!item) return null;
                return {
                    ...item,
                    qty: Math.min(2, Math.max(1, entry.qty || 1))
                };
            }).filter(Boolean);
        },

        getItemQty(catId, itemId) {
            if (catId === 'pan') {
                return this.current.pan?.id === itemId ? 1 : 0;
            }
            const found = this.current[catId].find((x) => x.id === itemId);
            return found?.qty || 0;
        },

        itemMeta(item, catId) {
            const qty = this.getItemQty(catId, item.id);
            const portion = item.portion ? ` · ${item.portion}` : '';
            const extra = qty > 1 ? ` · x${qty}` : '';
            return `+$${item.price}${portion}${extra}`;
        },

        formatLayerName(item) {
            const qty = item.qty || 1;
            return qty > 1 ? `${item.name} x${qty}` : item.name;
        },

        selectedDetails() {
            const details = this.selectedItems().map((item) => {
                const qty = item.qty || 1;
                const qtyText = qty > 1 ? ` x${qty}` : '';
                const portionText = item.portion ? ` (${qty > 1 ? `${item.portion} c/u` : item.portion})` : '';
                return `${item.name}${qtyText}${portionText}`;
            });

            if (this.activePreset) {
                if (details.length === 0) {
                    return this.activePreset.description;
                }
                return `${this.activePreset.description} · ${details.join(', ')}`;
            }

            return details.join(', ');
        },

        isSelected(catId, itemId) {
            if (catId === 'pan') return this.current.pan?.id === itemId;
            return this.current[catId].some((x) => x.id === itemId);
        },

        toggleItem(cat, item) {
            if (this.requiresPan(cat.id) && !this.current.pan) {
                return;
            }

            if (cat.rule === 'single') {
                this.current[cat.id] = this.current[cat.id]?.id === item.id ? null : item;
            } else {
                const idx = this.current[cat.id].findIndex((x) => x.id === item.id);
                const maxQty = this.maxQtyForCategory(cat.id);
                if (idx < 0) {
                    this.current[cat.id].push({ ...item, qty: 1 });
                } else if ((this.current[cat.id][idx].qty || 1) < maxQty) {
                    this.current[cat.id][idx].qty += 1;
                } else {
                    this.current[cat.id].splice(idx, 1);
                }
            }

            this.priceBump = true;
            setTimeout(() => {
                this.priceBump = false;
            }, 300);
            this.refreshIcons();
        },

        currentPrice() {
            let total = this.activePreset?.price || this.current.pan?.price || 0;
            this.selectedItems().forEach((item) => {
                total += item.price * (item.qty || 1);
            });
            return total;
        },

        getLayers() {
            if (!this.current.pan) return [];
            return [
                this.current.pan,
                ...this.current.fiambres,
                ...this.current.proteinas,
                ...this.current.vegetales,
                ...this.current.aderezos
            ];
        },

        canAddToCart() {
            const hasPreset = !!this.activePreset;
            const hasSandwich = !!this.current.pan && ((this.current.fiambres?.length || 0) > 0 || (this.current.proteinas?.length || 0) > 0);
            const hasDrinks = (this.current.bebidas?.length || 0) > 0;
            const hasSides = (this.current.acompanamientos?.length || 0) > 0;
            return hasPreset || hasSandwich || hasDrinks || hasSides;
        },

        addToCart() {
            if (!this.canAddToCart()) {
                return;
            }

            const isDrinkOnly = !this.activePreset && !this.current.pan && (this.current.bebidas?.length || 0) > 0;
            this.cart.push({
                title: isDrinkOnly ? 'Bebidas' : (this.activePreset?.name || `Sanguche ${this.current.pan?.name || 'Personalizado'}`),
                description: this.selectedDetails(),
                price: this.currentPrice()
            });
            this.current = this.createCurrentState(this.menu);
            this.activePreset = null;
            this.refreshIcons();
        },

        applyPreset(preset) {
            const nextState = this.createCurrentState(this.menu);
            nextState.pan = this.findItemById('pan', preset.ingredients?.pan) || null;
            nextState.fiambres = this.materializePresetItems('fiambres', preset.ingredients?.fiambres);
            nextState.proteinas = this.materializePresetItems('proteinas', preset.ingredients?.proteinas);
            nextState.vegetales = this.materializePresetItems('vegetales', preset.ingredients?.vegetales);
            nextState.aderezos = this.materializePresetItems('aderezos', preset.ingredients?.aderezos);
            this.current = nextState;
            this.activePreset = null;
            this.priceBump = true;
            setTimeout(() => {
                this.priceBump = false;
            }, 300);
            this.refreshIcons();
            document.getElementById('builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },

        addPresetToCart(preset) {
            this.cart.push({
                title: preset.name,
                description: preset.description,
                price: preset.price
            });
            this.cartOpen = true;
            this.refreshIcons();
        },

        finalizePurchase() {
            if (this.cart.length === 0) {
                return;
            }

            if (this.checkoutSweetCatalog().length > 0) {
                this.checkoutSweetOpen = true;
                this.refreshIcons();
                return;
            }

            this.completePurchase();
        },

        skipCheckoutSweet() {
            this.resetCheckoutSweet();
            this.completePurchase();
        },

        confirmCheckoutSweet() {
            const sweetItems = this.checkoutSweetItems();
            if (sweetItems.length > 0) {
                const sweetDetails = sweetItems.map((item) => {
                    const qty = item.qty || 1;
                    const qtyText = qty > 1 ? ` x${qty}` : '';
                    const portionText = item.portion ? ` (${item.portion})` : '';
                    return `${item.name}${qtyText}${portionText}`;
                }).join(', ');

                this.cart.push({
                    title: 'Algo dulce',
                    description: sweetDetails,
                    price: this.checkoutSweetTotal()
                });
            }

            this.resetCheckoutSweet();
            this.completePurchase();
        },

        completePurchase() {
            if (this.cart.length === 0) {
                return;
            }

            this.sendOrderToWhatsApp();
            this.cart = [];
            this.cartOpen = false;
            this.refreshIcons();
        },

        removeCartItem(index) {
            if (index < 0 || index >= this.cart.length) {
                return;
            }

            this.cart.splice(index, 1);
            this.refreshIcons();
        },

        cartTotal() {
            return this.cart.reduce((sum, item) => sum + item.price, 0);
        },

        formatPrice(value) {
            return `$${this.asNumber(value, 0)}`;
        },

        buildWhatsAppMessage() {
            const sandwichEmoji = '\uD83E\uDD6A';
            const clipboardEmoji = '\uD83D\uDCCB';
            const moneyEmoji = '\uD83D\uDCB5';
            const thanksEmoji = '\uD83D\uDE4C';

            const lines = [
                `Hola! Quiero hacer un pedido ${sandwichEmoji}`,
                '',
                `${clipboardEmoji} *Detalle del pedido:*`
            ];

            this.cart.forEach((item, index) => {
                lines.push(`${index + 1}. *${item.title}* - ${this.formatPrice(item.price)}`);
                if (item.description) {
                    lines.push(`   ${item.description}`);
                }
            });

            lines.push('');
            lines.push(`${moneyEmoji} *Total:* ${this.formatPrice(this.cartTotal())}`);
            lines.push('');
            lines.push(`Gracias! ${thanksEmoji}`);

            return lines.join('\n');
        },

        sendOrderToWhatsApp() {
            const sanitizedNumber = String(WHATSAPP_NUMBER).replace(/\D/g, '');
            if (!sanitizedNumber || this.cart.length === 0) {
                return;
            }

            const message = this.buildWhatsAppMessage();
            const whatsappUrl = `https://wa.me/${sanitizedNumber}?text=${encodeURIComponent(message)}`;
            window.open(whatsappUrl, '_blank');
        }
    };
}