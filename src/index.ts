import { TypedError } from 'typed-error';

export class PromiseQueueError extends TypedError {}
export class MaxSizeExceededError extends PromiseQueueError {}
export class TimeoutError extends PromiseQueueError {}

export class PromiseQueue {
	private next: 'pop' | 'shift';
	private queue: Array<(err?: Error) => Promise<void>> = [];
	private inFlight = 0;
	private concurrency: number;
	private maxSize: number;
	private maxAge: number;
	private order: 'fifo' | 'lifo';

	constructor({
		concurrency = 1,
		maxSize = 0,
		maxAge = 0,
		order = 'fifo',
	}: {
		concurrency?: PromiseQueue['concurrency'];
		maxSize?: PromiseQueue['maxSize'];
		maxAge?: PromiseQueue['maxAge'];
		order?: PromiseQueue['order'];
	} = {}) {
		if (maxSize < 0) {
			throw new Error('maxSize must be positive');
		}
		if (maxSize === 0) {
			maxSize = Infinity;
		}
		if (concurrency < 0) {
			throw new Error('concurrency must be positive');
		}
		if (concurrency === 0) {
			concurrency = Infinity;
		}

		this.concurrency = concurrency;
		this.maxSize = maxSize;
		this.maxAge = maxAge;
		this.order = order;
		this.next = order === 'lifo' ? 'pop' : 'shift';
	}
	private run() {
		const runNext = () => {
			this.inFlight--;
			this.run();
		};
		while (this.inFlight < this.concurrency && this.queue.length > 0) {
			this.inFlight++;
			const fn = this.queue[this.next]()!;
			fn().then(runNext, runNext);
		}
	}
	public add<T>(fn: () => T | PromiseLike<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			if (this.queue.length >= this.maxSize) {
				const err = new MaxSizeExceededError();
				if (this.order === 'lifo') {
					const evictedFn = this.queue.shift()!;
					// Make sure the evicted request receives the correct error to respond with
					evictedFn(err);
				} else {
					// If we're in fifo (default) mode we can skip wrapping/adding the fn altogether
					reject(err);
					return;
				}
			}

			let timeout: ReturnType<typeof setTimeout> | undefined;
			const wrappedFn = async (e?: Error) => {
				try {
					if (timeout) {
						clearTimeout(timeout);
					}
					if (e) {
						reject(e);
						return;
					}
					const result = await fn();
					resolve(result);
				} catch (e) {
					reject(e);
				}
			};

			this.queue.push(wrappedFn);
			if (this.maxAge > 0 && this.maxAge < Infinity) {
				timeout = setTimeout(() => {
					// We should be able to rely on this `indexOf` being fast regardless
					// of queue size since the oldest entries will be towards the start of the queue
					const index = this.queue.indexOf(wrappedFn);
					if (index === -1) {
						return;
					}
					this.queue.splice(index, 1);
					reject(new TimeoutError());
				}, this.maxAge);
			}
			this.run();
		});
	}
}

export const createKeyedPromiseQueue = (
	...args: ConstructorParameters<typeof PromiseQueue>
) => {
	const queues: {
		[key: string]: PromiseQueue;
	} = {};

	return <T>(key: string, fn: () => T | PromiseLike<T>): Promise<T> => {
		if (queues[key] == null) {
			queues[key] = new PromiseQueue(...args);
		}
		return queues[key].add(fn);
	};
};
