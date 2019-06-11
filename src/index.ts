import { TypedError } from 'typed-error';
import * as EventEmitter from 'eventemitter3';

export class PromiseQueueError extends TypedError {}
export class MaxSizeExceededError extends PromiseQueueError {}
export class TimeoutError extends PromiseQueueError {}

// duration in bigint nanoseconds since t0
const durationSince = (t0: bigint): bigint => {
	return process.hrtime.bigint() - t0;
};

export class PromiseQueue {
	private next: 'pop' | 'shift';
	private queue: Array<
		((err?: Error) => Promise<void>) & {
			arrivalTime: ReturnType<typeof process.hrtime.bigint>;
		}
	> = [];
	private inFlight = 0;
	private concurrency: number;
	private maxSize: number;
	private order: 'fifo' | 'lifo';
	public metrics: EventEmitter = new EventEmitter();

	constructor({
		concurrency = 1,
		maxSize = 0,
		maxAge = 0,
		order = 'fifo',
	}: {
		concurrency?: PromiseQueue['concurrency'];
		maxSize?: PromiseQueue['maxSize'];
		maxAge?: number;
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
		this.order = order;
		this.next = order === 'lifo' ? 'pop' : 'shift';

		if (maxAge > 0 && maxAge < Infinity) {
			const maxAgeSeconds = Math.ceil(maxAge / 1000);
			setInterval(() => {
				if (this.queue.length === 0) {
					return;
				}
				let timeoutNano = process.hrtime.bigint();
				timeoutNano += BigInt(maxAgeSeconds * 1e9);
				const firstValid = this.queue.findIndex(
					({ arrivalTime }) => arrivalTime > timeoutNano,
				);

				if (firstValid === 0) {
					return;
				}

				const timedOutFns = this.queue.splice(0, firstValid);
				this.metrics.emit('queueLength', this.queue.length);
				const timeoutError = new TimeoutError();
				timedOutFns.forEach(timedOutFn => {
					this.metrics.emit('timeout');
					timedOutFn(timeoutError);
				});
			}, 1000);
		}
	}
	private run() {
		const runNext = () => {
			this.inFlight--;
			this.metrics.emit('inFlight', this.inFlight);
			this.run();
		};
		while (this.inFlight < this.concurrency && this.queue.length > 0) {
			this.inFlight++;
			this.metrics.emit('inFlight', this.inFlight);
			const fn = this.queue[this.next]()!;
			fn().then(runNext, runNext);
		}
	}
	public add<T>(fn: () => T | PromiseLike<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.metrics.emit('arrival');
			const arrivalTime = process.hrtime.bigint();

			if (this.queue.length >= this.maxSize) {
				const err = new MaxSizeExceededError();
				this.metrics.emit('rejection');
				if (this.order === 'lifo') {
					const evictedFn = this.queue.shift()!;
					this.metrics.emit('queueLength', this.queue.length);
					// Make sure the evicted request receives the correct error to respond with
					evictedFn(err);
				} else {
					// If we're in fifo (default) mode we can skip wrapping/adding the fn altogether
					reject(err);
					return;
				}
			}

			const wrappedFn = async (e?: Error) => {
				const serviceStartTime = process.hrtime.bigint();
				try {
					this.metrics.emit('queueTime', durationSince(arrivalTime));
					if (e) {
						reject(e);
						return;
					}
					this.metrics.emit('dequeue');
					const result = await fn();
					resolve(result);
				} catch (e) {
					reject(e);
				} finally {
					this.metrics.emit('serviceTime', durationSince(serviceStartTime));
					this.metrics.emit('latency', durationSince(arrivalTime));
					this.metrics.emit('completion');
				}
			};
			wrappedFn.arrivalTime = arrivalTime;

			this.queue.push(wrappedFn);
			this.metrics.emit('enqueue');
			this.metrics.emit('queueLength', this.queue.length);
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
