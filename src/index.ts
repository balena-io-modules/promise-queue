import { TypedError } from 'typed-error';
import { EventEmitter } from 'eventemitter3';

export class PromiseQueueError extends TypedError {}
export class MaxSizeExceededError extends PromiseQueueError {}
export class TimeoutError extends PromiseQueueError {}

const durationSince = (t0: ReturnType<typeof process.hrtime>): number => {
	const diff = process.hrtime(t0);
	return diff[0] * 1000 + diff[1] / 1e6;
};

export interface PromiseQueueMetricsEvents {
	/** A function arrives at the queue (via `add`) */
	arrival: [];
	/** A function is added to the waiting queue (not emitted when it is rejected for `maxSize` in fifo order) */
	enqueue: [];
	/** The length of the waiting queue after it changed (a function was enqueued, evicted or timed out) */
	queueLength: [queueLength: number];
	/** The number of running functions, emitted whenever it changes */
	inFlight: [inFlight: number];
	/** A function stops waiting in the queue and starts running */
	dequeue: [];
	/** Milliseconds a function spent waiting in the queue, emitted when it leaves the queue */
	queueTime: [milliseconds: number];
	/** Milliseconds a function spent running, emitted on completion */
	serviceTime: [milliseconds: number];
	/** Milliseconds from arrival to completion (queue time + service time) */
	latency: [milliseconds: number];
	/** A function completes processing (also emitted for functions rejected while waiting) */
	completion: [];
	/** A function is rejected because `maxSize` has been reached */
	rejection: [];
	/** The number of waiting functions rejected for exceeding `maxAge` */
	timeout: [count: number];
}

export class PromiseQueue {
	private next: 'pop' | 'shift';
	private queue: Array<
		((err?: Error) => Promise<void>) & {
			arrivalTime: ReturnType<typeof process.hrtime>;
		}
	> = [];
	private inFlight = 0;
	private concurrency: number;
	private maxSize: number;
	private maxAgeSeconds = 0;
	private expiryTimer?: ReturnType<typeof setInterval>;
	private order: 'fifo' | 'lifo';
	public readonly metrics = new EventEmitter<PromiseQueueMetricsEvents>();

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
		// Only integers, or Infinity for no limit: rejects NaN, fractions and
		// non-numbers such as strings from environment variables
		const isIntegerOrInfinity = (x: unknown) =>
			Number.isInteger(x) || x === Infinity;
		if (!isIntegerOrInfinity(maxSize) || maxSize < 0) {
			throw new Error('maxSize must be a non-negative integer');
		}
		// A negative maxAge is accepted and, like 0, disables timeouts
		if (!isIntegerOrInfinity(maxAge)) {
			throw new Error('maxAge must be an integer');
		}
		if (maxSize === 0) {
			maxSize = Infinity;
		}
		if (!isIntegerOrInfinity(concurrency) || concurrency < 0) {
			throw new Error('concurrency must be a non-negative integer');
		}
		if (concurrency === 0) {
			concurrency = Infinity;
		}

		this.concurrency = concurrency;
		this.maxSize = maxSize;
		this.order = order;
		this.next = order === 'lifo' ? 'pop' : 'shift';

		if (maxAge > 0 && maxAge < Infinity) {
			this.maxAgeSeconds = Math.ceil(maxAge / 1000);
		}
	}
	/**
	 * Only runs while there are functions waiting in the queue, so that an idle
	 * queue keeps neither the process alive nor itself from being collected
	 */
	private startExpiryTimer() {
		if (this.maxAgeSeconds === 0 || this.expiryTimer != null) {
			return;
		}
		this.expiryTimer = setInterval(() => {
			this.expireTimedOut();
		}, 1000);
	}
	private stopExpiryTimer() {
		if (this.expiryTimer != null) {
			clearInterval(this.expiryTimer);
			this.expiryTimer = undefined;
		}
	}
	private expireTimedOut() {
		if (this.queue.length === 0) {
			this.stopExpiryTimer();
			return;
		}
		let [timeoutSeconds] = process.hrtime();
		timeoutSeconds -= this.maxAgeSeconds;

		let firstValid = this.queue.findIndex(
			({ arrivalTime }) => arrivalTime[0] > timeoutSeconds,
		);

		if (firstValid === 0) {
			return;
		}

		if (firstValid === -1) {
			// If there are no valid entries then we remove them all
			firstValid = this.queue.length;
		}

		const timedOutFns = this.queue.splice(0, firstValid);
		this.metrics.emit('queueLength', this.queue.length);
		const timeoutError = new TimeoutError();
		this.metrics.emit('timeout', timedOutFns.length);
		timedOutFns.forEach((timedOutFn) => {
			void timedOutFn(timeoutError);
		});
		if (this.queue.length === 0) {
			this.stopExpiryTimer();
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
		if (this.queue.length === 0) {
			this.stopExpiryTimer();
		}
	}
	public add<T>(fn: () => T | PromiseLike<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.metrics.emit('arrival');
			const arrivalTime = process.hrtime();

			if (this.queue.length >= this.maxSize) {
				const err = new MaxSizeExceededError();
				this.metrics.emit('rejection');
				if (this.order === 'lifo') {
					const evictedFn = this.queue.shift()!;
					this.metrics.emit('queueLength', this.queue.length);
					// Make sure the evicted request receives the correct error to respond with
					void evictedFn(err);
				} else {
					// If we're in fifo (default) mode we can skip wrapping/adding the fn altogether
					reject(err);
					return;
				}
			}

			const wrappedFn = async (e?: Error) => {
				// Only set once `fn` starts running: a function that never runs (timed
				// out or evicted) only reports the time it spent waiting, without
				// serviceTime, latency or completion
				let serviceStartTime: ReturnType<typeof process.hrtime> | undefined;
				try {
					this.metrics.emit('queueTime', durationSince(arrivalTime));
					if (e) {
						reject(e);
						return;
					}
					this.metrics.emit('dequeue');
					serviceStartTime = process.hrtime();
					const result = await fn();
					resolve(result);
				} catch (err) {
					// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
					reject(err as Error);
				} finally {
					if (serviceStartTime != null) {
						this.metrics.emit('serviceTime', durationSince(serviceStartTime));
						this.metrics.emit('latency', durationSince(arrivalTime));
						this.metrics.emit('completion');
					}
				}
			};
			wrappedFn.arrivalTime = arrivalTime;

			this.queue.push(wrappedFn);
			this.metrics.emit('enqueue');
			this.metrics.emit('queueLength', this.queue.length);
			this.run();
			if (this.queue.length > 0) {
				this.startExpiryTimer();
			}
		});
	}
}

export const createKeyedPromiseQueue = (
	...args: ConstructorParameters<typeof PromiseQueue>
) => {
	// Each queue is dropped once nothing is outstanding for its key, so that the
	// map does not grow with every distinct key. `pending` counts every call made
	// on the queue and a call only settles once its function has finished or
	// will never run (timed out / evicted), so at 0 nothing for that key is
	// running or waiting and a fresh queue cannot break its concurrency.
	// (PromiseQueue's own `inFlight` can't be used: it is only decremented after
	// the caller's promise has settled.)
	const queues = new Map<string, { queue: PromiseQueue; pending: number }>();

	return async <T>(key: string, fn: () => T | PromiseLike<T>): Promise<T> => {
		let entry = queues.get(key);
		if (entry == null) {
			entry = { queue: new PromiseQueue(...args), pending: 0 };
			queues.set(key, entry);
		}
		entry.pending++;
		try {
			return await entry.queue.add(fn);
		} finally {
			entry.pending--;
			if (entry.pending === 0 && queues.get(key) === entry) {
				queues.delete(key);
			}
		}
	};
};
