/**
 * Type-level assertions, checked by `tsc -p tsconfig.test.json` (the files in
 * this directory are never executed). They import the declarations that
 * `npm run build` emits into `out/` rather than the sources: some typing
 * issues, eg private members resolving to `any`, only show up in the emitted
 * `.d.ts` and not when type-checking the source.
 *
 * Use `// @ts-expect-error` for usages that must not compile (tsc reports an
 * unused directive as an error) and `Expect<Equal<A, B>>` for exact types.
 */
export type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
export type Expect<T extends true> = T;

/**
 * Value-level version of `Equal`, for values that only exist as eg callback
 * parameters: `isType<number>()(value)` only compiles if `value` is exactly a
 * `number` (not `any`)
 */
export const isType =
	<T>() =>
	<V>(value: Equal<V, T> extends true ? V : never) =>
		value;
