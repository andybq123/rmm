import type { JsonValue } from "./server-contract";
/** `error_code` the daemon sets when the invocation doesn't act for the owner. */
export declare const SAVED_PRODUCT_LISTS_OWNER_ONLY_CODE: "saved_product_lists_owner_only";
/** Blob keys the daemon may name for product photos; the worker refuses others. */
export declare const SAVED_PRODUCT_IMAGE_KEY_PREFIX: "saved-products/";
export declare const SAVED_PRODUCT_LISTS_UNAVAILABLE_BRAND: "@hatch/space-sdk/SavedProductListsUnavailableError/v1";
/**
 * Thrown by `ctx.tool.saved_product_lists` when live lists can't be read for
 * this invocation: anyone but the Space's owner, and every shared or published
 * copy. Serve the page's saved copy then. Any other error is a real failure.
 *
 * Check with `SavedProductListsUnavailableError.is(e)`, not `instanceof`: the
 * worker and the Space's `actions.js` bundle separate SDK copies.
 */
export declare class SavedProductListsUnavailableError extends Error {
    /** @internal — branded property; check via `SavedProductListsUnavailableError.is(e)`. */
    readonly __brand: typeof SAVED_PRODUCT_LISTS_UNAVAILABLE_BRAND;
    readonly code: typeof SAVED_PRODUCT_LISTS_OWNER_ONLY_CODE;
    constructor(message?: string, options?: ErrorOptions);
    static is(value: unknown): value is SavedProductListsUnavailableError;
}
/**
 * `current`: refreshed from the catalog by this read. `saved`: the price as
 * saved, because the product isn't a catalog product or its refresh failed.
 * `refreshing`: a catalog price as saved, not refreshed by this read.
 * `cached`: only from {@link mergeSavedProductListsCache}, the last price an
 * earlier read checked, kept because this read couldn't check it; show it as
 * the last checked price, not as current.
 */
export type SavedProductPrice = "current" | "saved" | "refreshing" | "cached";
/**
 * One saved product: the card the daemon resolved, the shape of a shopping
 * results card. Pass it unchanged to `museShopping` to open its details.
 * `image_url` is the remote catalog photo; render the item's `image` instead.
 */
export interface SavedProductRecord {
    readonly type: "catalog" | "marketplace" | "browser";
    readonly url: string;
    readonly name: string;
    readonly citation_id?: string;
    readonly product_id?: string;
    readonly provider?: string;
    readonly retailer_name?: string;
    readonly brand?: string;
    readonly price?: string;
    readonly sale_price?: string;
    readonly currency?: string;
    readonly image_url?: string | null;
    readonly [field: string]: JsonValue | undefined;
}
export interface SavedProductListItem {
    readonly product: SavedProductRecord;
    /**
     * Own-origin URL of the product's photo in this Space's blobs, or null for
     * none. It carries `imageVersion`, so a changed photo is fetched again.
     */
    readonly image: string | null;
    /**
     * The photo's `ctx.blobs` key, the same for the product on every read, for
     * a saved copy that renders it later; null for none.
     */
    readonly imageKey: string | null;
    /**
     * The photo's content version, which changes only when its bytes do.
     * Compare `imageKey` and `imageVersion`, never `image`, to tell whether a
     * card's photo changed. A read may leave a photo out of its download budget;
     * the item then keeps the photo an earlier read stored.
     */
    readonly imageVersion: string | null;
    /**
     * When the product was saved to the list, as the list records it; saving it
     * again changes it. Null when the list records no time.
     */
    readonly savedAt: string | null;
    readonly price: SavedProductPrice;
}
export interface SavedProductList {
    /** The list name as requested. */
    readonly list: string;
    /** True when no list has this name; `items` is then empty. */
    readonly missing: boolean;
    /** The list's products in its saved order, newest first. */
    readonly items: readonly SavedProductListItem[];
}
/** The requested lists, in request order. */
export interface SavedProductLists {
    readonly lists: readonly SavedProductList[];
}
/**
 * The cache an action keeps of its last read, updated with a new read `next`.
 * A catalog product whose price `next` couldn't check (`saved` or
 * `refreshing`) keeps the price, sale price and currency an earlier read
 * checked (`current` or `cached`), marked `cached`, so a page doesn't flip
 * between the checked and the saved price as refreshes succeed and fail. A
 * product saved again since (another `savedAt`) takes its new saved price.
 * Everything else comes from `next`: its lists, products and photos, so a
 * product removed since `previous` stays removed.
 */
export declare function mergeSavedProductListsCache(previous: SavedProductLists | null | undefined, next: SavedProductLists): SavedProductLists;
//# sourceMappingURL=saved_product_lists.d.ts.map