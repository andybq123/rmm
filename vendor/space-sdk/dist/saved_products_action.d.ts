import { type SavedProductLists } from "./saved_product_lists";
import { z, type PortableCtx } from "./server-contract";
declare const savedProductsMessagesSchema: z.ZodObject<{
    currentPrice: z.ZodString;
    lastCheckedPrice: z.ZodString;
    savedPrice: z.ZodString;
    snapshotNotice: z.ZodString;
    unavailableNotice: z.ZodString;
    ownerSharedCopyNotice: z.ZodString;
}, z.core.$strip>;
/** Complete display copy in the Space's authored UI language. */
export type SavedProductsMessages = Readonly<z.infer<typeof savedProductsMessagesSchema>>;
/** The action's request: it takes no arguments. */
export declare const SAVED_PRODUCTS_REQUEST_SCHEMA: z.ZodObject<{}, z.core.$strict>;
/** The action's response, the shape the page renders. */
export declare const SAVED_PRODUCTS_RESPONSE_SCHEMA: z.ZodObject<{
    lists: z.ZodArray<z.ZodObject<{
        list: z.ZodString;
        missing: z.ZodBoolean;
        items: z.ZodArray<z.ZodObject<{
            product: z.ZodObject<{
                type: z.ZodEnum<{
                    browser: "browser";
                    catalog: "catalog";
                    marketplace: "marketplace";
                }>;
                url: z.ZodString;
                name: z.ZodString;
                image_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                citation_id: z.ZodOptional<z.ZodString>;
                product_id: z.ZodOptional<z.ZodString>;
                provider: z.ZodOptional<z.ZodString>;
                retailer_name: z.ZodOptional<z.ZodString>;
                brand: z.ZodOptional<z.ZodString>;
                price: z.ZodOptional<z.ZodString>;
                sale_price: z.ZodOptional<z.ZodString>;
                currency: z.ZodOptional<z.ZodString>;
            }, z.core.$catchall<z.ZodJSONSchema>>;
            image: z.ZodNullable<z.ZodString>;
            priceLabel: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    snapshotAt: z.ZodNullable<z.ZodString>;
    notice: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type SavedProducts = z.infer<typeof SAVED_PRODUCTS_RESPONSE_SCHEMA>;
export interface SavedProductsActionOptions {
    /**
     * Only these of the lists `space.json` declares, in this order, for one
     * section of a page. Omit for every declared list.
     */
    readonly lists?: readonly string[];
    /** Use "en" for an English Space, or supply every message in the Space's language. */
    readonly messages: "en" | SavedProductsMessages;
}
/** What the action needs from either runtime's `Ctx`. */
export interface SavedProductsActionCtx extends PortableCtx {
    readonly tool: {
        saved_product_lists(lists?: readonly string[]): Promise<SavedProductLists>;
    };
    invalidateQueries(): void;
}
/** Builds `savedProductsAction` for one runtime's `Ctx`. */
export declare function savedProductsActionFor<TCtx extends SavedProductsActionCtx>(): (options: SavedProductsActionOptions) => import("./server-contract").ActionDefinition<TCtx, z.ZodObject<{}, z.core.$strict>, z.ZodObject<{
    lists: z.ZodArray<z.ZodObject<{
        list: z.ZodString;
        missing: z.ZodBoolean;
        items: z.ZodArray<z.ZodObject<{
            product: z.ZodObject<{
                type: z.ZodEnum<{
                    browser: "browser";
                    catalog: "catalog";
                    marketplace: "marketplace";
                }>;
                url: z.ZodString;
                name: z.ZodString;
                image_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                citation_id: z.ZodOptional<z.ZodString>;
                product_id: z.ZodOptional<z.ZodString>;
                provider: z.ZodOptional<z.ZodString>;
                retailer_name: z.ZodOptional<z.ZodString>;
                brand: z.ZodOptional<z.ZodString>;
                price: z.ZodOptional<z.ZodString>;
                sale_price: z.ZodOptional<z.ZodString>;
                currency: z.ZodOptional<z.ZodString>;
            }, z.core.$catchall<z.ZodJSONSchema>>;
            image: z.ZodNullable<z.ZodString>;
            priceLabel: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    snapshotAt: z.ZodNullable<z.ZodString>;
    notice: z.ZodNullable<z.ZodString>;
}, z.core.$strip>>;
export {};
//# sourceMappingURL=saved_products_action.d.ts.map