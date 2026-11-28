import { createKeyedPromiseQueue, PromiseQueue } from '../../out/index.js';
import type { Equal, Expect } from './helpers.ts';

// Each case is checked for both `q.add(fn)` and the function returned by
// `createKeyedPromiseQueue`: `add('key', fn)`
const q = new PromiseQueue();
const add = createKeyedPromiseQueue();
declare const cond: boolean;
declare const nested: PromiseLike<PromiseLike<number>>;
declare const noop: () => void;
declare const tick: Promise<void>;

export const syncFn = [q.add(() => 1), add('key', () => 1)] as const;
export type SyncFn = Expect<
	Equal<typeof syncFn, readonly [Promise<number>, Promise<number>]>
>;

export const asyncFn = [
	q.add(() => Promise.resolve('s')),
	add('key', () => Promise.resolve('s')),
] as const;
export type AsyncFn = Expect<
	Equal<typeof asyncFn, readonly [Promise<string>, Promise<string>]>
>;

// A function with a mixed sync/async return type
const mixed = (): Promise<string> | number => (cond ? Promise.resolve('s') : 1);
export const mixedFn = [q.add(mixed), add('key', mixed)] as const;
export type MixedFn = Expect<
	Equal<
		typeof mixedFn,
		readonly [Promise<string | number>, Promise<string | number>]
	>
>;

// Nested thenables are unwrapped, like `await` does
export const nestedFn = [
	q.add(() => nested),
	add('key', () => nested),
] as const;
export type NestedFn = Expect<
	Equal<typeof nestedFn, readonly [Promise<number>, Promise<number>]>
>;

export const voidFn = [q.add(noop), add('key', noop)] as const;
export type VoidFn = Expect<
	Equal<typeof voidFn, readonly [Promise<void>, Promise<void>]>
>;

// Explicit type arguments keep working
export const explicit = [
	q.add<number>(() => Promise.resolve(1)),
	q.add<number>(() => 1),
	add<number>('key', () => Promise.resolve(1)),
	add<number>('key', () => 1),
] as const;
export type Explicit = Expect<
	Equal<
		typeof explicit,
		readonly [
			Promise<number>,
			Promise<number>,
			Promise<number>,
			Promise<number>,
		]
	>
>;
// Literal types are kept for async results checked against an explicit type
// argument or a contextual type
interface Result {
	status: 'ok' | 'fail';
	pair: [number, string];
}
export const explicitAsyncObject = [
	q.add<Result>(async () => {
		await tick;
		return { status: 'ok', pair: [1, 's'] };
	}),
	q.add<Result>(() => Promise.resolve({ status: 'ok', pair: [1, 's'] })),
	add<Result>('key', async () => {
		await tick;
		return { status: 'ok', pair: [1, 's'] };
	}),
	add<Result>('key', () => Promise.resolve({ status: 'ok', pair: [1, 's'] })),
] as const;
export type ExplicitAsyncObject = Expect<
	Equal<
		typeof explicitAsyncObject,
		readonly [
			Promise<Result>,
			Promise<Result>,
			Promise<Result>,
			Promise<Result>,
		]
	>
>;
export const contextual: Array<Promise<Result>> = [
	q.add(() => Promise.resolve({ status: 'ok', pair: [1, 's'] })),
	q.add(async () => {
		await tick;
		return { status: 'ok', pair: [1, 's'] };
	}),
	add('key', () => Promise.resolve({ status: 'ok', pair: [1, 's'] })),
	add('key', async () => {
		await tick;
		return { status: 'ok', pair: [1, 's'] };
	}),
];

// @ts-expect-error the function does not return a string
export const wrongExplicit = q.add<string>(() => 1);
// @ts-expect-error the function does not return a string
export const wrongKeyedExplicit = add<string>('key', () => 1);
