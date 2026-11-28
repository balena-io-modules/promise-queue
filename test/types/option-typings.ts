import { createKeyedPromiseQueue, PromiseQueue } from '../../out/index.js';
import type { PromiseQueueOptions } from '../../out/index.js';
import type { Equal, Expect } from './helpers.ts';

// Invalid option values are rejected by the PromiseQueue constructor
// @ts-expect-error order must be 'fifo' | 'lifo'
export const badOrder = new PromiseQueue({ order: 'bogus' });
// @ts-expect-error concurrency must be a number
export const badConcurrency = new PromiseQueue({ concurrency: 'x' });
// @ts-expect-error maxSize must be a number
export const badMaxSize = new PromiseQueue({ maxSize: {} });
// @ts-expect-error maxAge must be a number
export const badMaxAge = new PromiseQueue({ maxAge: '1000' });

// ... and by createKeyedPromiseQueue
// @ts-expect-error order must be 'fifo' | 'lifo'
export const keyedBadOrder = createKeyedPromiseQueue({ order: 'bogus' });
export const keyedBadConc = createKeyedPromiseQueue({
	// @ts-expect-error concurrency must be a number
	concurrency: 'x',
});
// @ts-expect-error maxSize must be a number
export const keyedBadMaxSize = createKeyedPromiseQueue({ maxSize: {} });
// @ts-expect-error maxAge must be a number
export const keyedBadMaxAge = createKeyedPromiseQueue({ maxAge: '1000' });

// Valid options are accepted
export const valid = [
	new PromiseQueue(),
	new PromiseQueue({}),
	new PromiseQueue({
		concurrency: 2,
		maxSize: 10,
		maxAge: 1000,
		order: 'lifo',
	}),
	new PromiseQueue({ order: 'fifo' }),
	createKeyedPromiseQueue(),
	createKeyedPromiseQueue({
		concurrency: 2,
		maxSize: 10,
		maxAge: 1000,
		order: 'lifo',
	}),
];

// PromiseQueueOptions is exported
export const options: PromiseQueueOptions = { concurrency: 1, order: 'lifo' };
export const fromOptions = new PromiseQueue(options);
export type OptionsOrder = Expect<
	Equal<PromiseQueueOptions['order'], 'fifo' | 'lifo' | undefined>
>;
// @ts-expect-error order must be 'fifo' | 'lifo'
export const badOptions: PromiseQueueOptions = { order: 'bogus' };

// The `NonNullable<ConstructorParameters<typeof PromiseQueue>[0]>` pattern
// used by open-balena-api
type QueueOpts = NonNullable<ConstructorParameters<typeof PromiseQueue>[0]>;
export const queueOpts: QueueOpts = {};
queueOpts.maxAge ??= 1000;
export type QueueOptsMaxAge = Expect<
	Equal<QueueOpts['maxAge'], number | undefined>
>;
export type QueueOptsOrder = Expect<
	Equal<QueueOpts['order'], 'fifo' | 'lifo' | undefined>
>;
// @ts-expect-error maxAge must be a number
queueOpts.maxAge = 'x';
export const fromQueueOpts = new PromiseQueue(queueOpts);

// The `Parameters<typeof createKeyedPromiseQueue>[0]` pattern used by
// balena-delta
type KeyedOpts = Parameters<typeof createKeyedPromiseQueue>[0];
export const keyedOpts: KeyedOpts = { concurrency: 2 };
export const fromKeyedOpts = createKeyedPromiseQueue(keyedOpts);
export type KeyedOptsOrder = Expect<
	Equal<NonNullable<KeyedOpts>['order'], 'fifo' | 'lifo' | undefined>
>;
// @ts-expect-error concurrency must be a number
export const badKeyedOpts: KeyedOpts = { concurrency: 'x' };
