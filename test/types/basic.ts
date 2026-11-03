import {
	createKeyedPromiseQueue,
	MaxSizeExceededError,
	PromiseQueue,
	TimeoutError,
} from '../../out/index.js';
import type { PromiseQueueError } from '../../out/index.js';
import type { Equal, Expect } from './helpers.ts';

// The documented usage
const q = new PromiseQueue({
	concurrency: 40,
	maxSize: 400,
	maxAge: 30 * 1000,
	order: 'fifo',
});
export const n = q.add(() => 1);
export const s = q.add(() => Promise.resolve('s'));
export type Results = [
	Expect<Equal<typeof n, Promise<number>>>,
	Expect<Equal<typeof s, Promise<string>>>,
];

export const lengths: number[] = [];
q.metrics.on('queueLength', (queueLength: number) => lengths.push(queueLength));

const keyed = createKeyedPromiseQueue({ concurrency: 2, order: 'lifo' });
export const b = keyed('key', () => true);
export type KeyedResult = Expect<Equal<typeof b, Promise<boolean>>>;

export const errors: PromiseQueueError[] = [
	new MaxSizeExceededError(),
	new TimeoutError(),
];
