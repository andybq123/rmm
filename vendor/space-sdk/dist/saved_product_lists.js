// `ctx.tool.saved_product_lists`: the owner's Remember Products lists, read
// live for a Space action. Both runtimes import this file, so the error brand
// and the result shape agree between the VM worker and the Cloudflare shim.
/** `error_code` the daemon sets when the invocation doesn't act for the owner. */
export const SAVED_PRODUCT_LISTS_OWNER_ONLY_CODE = "saved_product_lists_owner_only";
/** Blob keys the daemon may name for product photos; the worker refuses others. */
export const SAVED_PRODUCT_IMAGE_KEY_PREFIX = "saved-products/";
export const SAVED_PRODUCT_LISTS_UNAVAILABLE_BRAND = "@hatch/space-sdk/SavedProductListsUnavailableError/v1";
/**
 * Thrown by `ctx.tool.saved_product_lists` when live lists can't be read for
 * this invocation: anyone but the Space's owner, and every shared or published
 * copy. Serve the page's saved copy then. Any other error is a real failure.
 *
 * Check with `SavedProductListsUnavailableError.is(e)`, not `instanceof`: the
 * worker and the Space's `actions.js` bundle separate SDK copies.
 */
export class SavedProductListsUnavailableError extends Error {
    /** @internal — branded property; check via `SavedProductListsUnavailableError.is(e)`. */
    __brand = SAVED_PRODUCT_LISTS_UNAVAILABLE_BRAND;
    code = SAVED_PRODUCT_LISTS_OWNER_ONLY_CODE;
    constructor(message = "Live saved products are available only to the Space owner", options) {
        super(message, options);
        this.name = "SavedProductListsUnavailableError";
    }
    static is(value) {
        if (value instanceof SavedProductListsUnavailableError)
            return true;
        return (typeof value === "object" &&
            value !== null &&
            value.__brand === SAVED_PRODUCT_LISTS_UNAVAILABLE_BRAND);
    }
}
const CHECKED_FIELDS = ["name", "price", "sale_price", "currency"];
/** The same saved product: same identity and link, and not saved again since. */
function sameSave(a, b) {
    return (a.product.citation_id !== undefined &&
        a.product.citation_id === b.product.citation_id &&
        a.product.url === b.product.url &&
        a.savedAt !== null &&
        a.savedAt === b.savedAt);
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
export function mergeSavedProductListsCache(previous, next) {
    if (!previous)
        return next;
    return {
        lists: next.lists.map((list) => {
            const earlier = previous.lists.find((candidate) => candidate.list === list.list);
            if (!earlier)
                return list;
            return {
                ...list,
                items: list.items.map((item) => {
                    if (item.product.type !== "catalog" ||
                        (item.price !== "saved" && item.price !== "refreshing")) {
                        return item;
                    }
                    const checked = earlier.items.find((candidate) => (candidate.price === "current" || candidate.price === "cached") &&
                        sameSave(candidate, item));
                    if (!checked)
                        return item;
                    const product = { ...item.product };
                    for (const field of CHECKED_FIELDS) {
                        if (checked.product[field] === undefined)
                            delete product[field];
                        else
                            product[field] = checked.product[field];
                    }
                    return { ...item, product: product, price: "cached" };
                }),
            };
        }),
    };
}
