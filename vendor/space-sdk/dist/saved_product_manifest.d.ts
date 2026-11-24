export declare const MAX_SPACE_MANIFEST_BYTES: number;
/**
 * `space.json.savedProductLists` from a parsed `space.json`, or undefined
 * when the manifest declares no valid selection: not a stateful Space, not an
 * array of at most 20 distinct names of 1 to 256 UTF-8 bytes.
 */
export declare function declaredSavedProductLists(manifest: unknown): readonly string[] | undefined;
//# sourceMappingURL=saved_product_manifest.d.ts.map