import { describe, it } from 'node:test';
import { expect } from 'chai';
import {
	createKeyedPromiseQueue,
	MaxSizeExceededError,
	PromiseQueue,
	PromiseQueueError,
	TimeoutError,
} from '../src/index.ts';
import { flush, getRejection } from './helpers/utils.ts';

describe('PromiseQueue', () => {
	describe('results', () => {
		it('resolves with the return value of a sync function', async () => {
			const q = new PromiseQueue();
			expect(await q.add(() => 1)).to.equal(1);
		});

		it('resolves with the resolved value of an async function', async () => {
			const q = new PromiseQueue();
			expect(
				await q.add(async () => {
					await flush();
					return 'a';
				}),
			).to.equal('a');
		});

		it('rejects with the error thrown by a sync function', async () => {
			const q = new PromiseQueue();
			const err = await getRejection(
				q.add(() => {
					throw new Error('sync');
				}),
			);
			expect(err).to.be.instanceOf(Error);
			expect((err as Error).message).to.equal('sync');
		});

		it('rejects with the rejection of an async function', async () => {
			const q = new PromiseQueue();
			const err = await getRejection(
				q.add(async () => {
					await flush();
					throw new Error('async');
				}),
			);
			expect(err).to.be.instanceOf(Error);
			expect((err as Error).message).to.equal('async');
		});

		it('continues with the next function after one rejects', async () => {
			const q = new PromiseQueue();
			const failed = q.add(() => Promise.reject(new Error('fail')));
			const next = q.add(() => 'next');
			expect(await getRejection(failed)).to.be.instanceOf(Error);
			expect(await next).to.equal('next');
		});
	});

	describe('concurrency', () => {
		const trackConcurrency = async (q: PromiseQueue, count: number) => {
			let active = 0;
			let maxActive = 0;
			await Promise.all(
				Array.from({ length: count }, () =>
					q.add(async () => {
						active++;
						maxActive = Math.max(maxActive, active);
						await flush();
						active--;
					}),
				),
			);
			return maxActive;
		};

		it('runs one function at a time by default', async () => {
			expect(await trackConcurrency(new PromiseQueue(), 5)).to.equal(1);
		});

		it('runs up to `concurrency` functions at a time', async () => {
			const q = new PromiseQueue({ concurrency: 3 });
			expect(await trackConcurrency(q, 10)).to.equal(3);
		});

		it('treats a concurrency of 0 as unlimited', async () => {
			const q = new PromiseQueue({ concurrency: 0 });
			expect(await trackConcurrency(q, 50)).to.equal(50);
		});

		it('throws for a negative concurrency', () => {
			expect(() => new PromiseQueue({ concurrency: -1 })).to.throw();
		});
	});

	describe('order', () => {
		const startOrder = async (q: PromiseQueue) => {
			const blocker: PromiseWithResolvers<void> = Promise.withResolvers();
			const started: number[] = [];
			const done = [
				q.add(() => blocker.promise),
				...[1, 2, 3].map((i) =>
					q.add(() => {
						started.push(i);
					}),
				),
			];
			blocker.resolve();
			await Promise.all(done);
			return started;
		};

		it('starts queued functions in fifo order by default', async () => {
			expect(await startOrder(new PromiseQueue())).to.deep.equal([1, 2, 3]);
		});

		it('starts queued functions in lifo order', async () => {
			const q = new PromiseQueue({ order: 'lifo' });
			expect(await startOrder(q)).to.deep.equal([3, 2, 1]);
		});
	});

	describe('maxSize', () => {
		it('rejects new functions with MaxSizeExceededError when full in fifo order', async () => {
			const q = new PromiseQueue({ maxSize: 1 });
			const blocker: PromiseWithResolvers<void> = Promise.withResolvers();
			const running = q.add(() => blocker.promise);
			const queued = q.add(() => 'queued');
			const rejected = q.add(() => 'rejected');

			const err = await getRejection(rejected);
			expect(err).to.be.instanceOf(MaxSizeExceededError);

			blocker.resolve();
			await running;
			expect(await queued).to.equal('queued');
		});

		it('evicts the oldest queued function with MaxSizeExceededError when full in lifo order', async () => {
			const q = new PromiseQueue({ maxSize: 2, order: 'lifo' });
			const blocker: PromiseWithResolvers<void> = Promise.withResolvers();
			const running = q.add(() => blocker.promise);
			const evicted = q.add(() => 'evicted');
			const b = q.add(() => 'b');
			const c = q.add(() => 'c');

			const err = await getRejection(evicted);
			expect(err).to.be.instanceOf(MaxSizeExceededError);

			blocker.resolve();
			await running;
			expect(await Promise.all([b, c])).to.deep.equal(['b', 'c']);
		});

		it('treats a maxSize of 0 as unlimited', async () => {
			const q = new PromiseQueue({ maxSize: 0 });
			const blocker: PromiseWithResolvers<void> = Promise.withResolvers();
			const all = [
				q.add(() => blocker.promise),
				...Array.from({ length: 1000 }, (_, i) => q.add(() => i)),
			];
			blocker.resolve();
			const results = await Promise.all(all);
			expect(results).to.have.length(1001);
		});

		it('throws for a negative maxSize', () => {
			expect(() => new PromiseQueue({ maxSize: -1 })).to.throw();
		});
	});

	describe('metrics', () => {
		it('emits lifecycle events for a function that runs', async () => {
			const q = new PromiseQueue();
			const events: string[] = [];
			for (const event of [
				'arrival',
				'enqueue',
				'dequeue',
				'completion',
			] as const) {
				q.metrics.on(event, () => events.push(event));
			}
			await q.add(() => 'a');
			await flush();
			expect(events).to.deep.equal([
				'arrival',
				'enqueue',
				'dequeue',
				'completion',
			]);
		});

		it('emits durations in milliseconds for a function that runs', async () => {
			const q = new PromiseQueue();
			const durations: Record<string, unknown[]> = {};
			for (const event of ['queueTime', 'serviceTime', 'latency'] as const) {
				durations[event] = [];
				q.metrics.on(event, (duration: unknown) =>
					durations[event].push(duration),
				);
			}
			await q.add(() => 'a');
			await flush();
			for (const [event, values] of Object.entries(durations)) {
				expect(values, event).to.have.length(1);
				expect(values[0], event).to.be.a('number').that.is.at.least(0);
			}
		});

		it('emits the number of functions in flight as they start and finish', async () => {
			const q = new PromiseQueue({ concurrency: 2 });
			const inFlight: number[] = [];
			q.metrics.on('inFlight', (n: number) => inFlight.push(n));
			await Promise.all([q.add(flush), q.add(flush)]);
			await flush();
			expect(inFlight).to.deep.equal([1, 2, 1, 0]);
		});

		it('emits rejection when a function is rejected for maxSize', async () => {
			const q = new PromiseQueue({ maxSize: 1 });
			let rejections = 0;
			q.metrics.on('rejection', () => rejections++);
			const blocker: PromiseWithResolvers<void> = Promise.withResolvers();
			const all = [
				q.add(() => blocker.promise),
				q.add(() => 'queued'),
				q.add(() => 'rejected'),
			];
			blocker.resolve();
			await Promise.allSettled(all);
			expect(rejections).to.equal(1);
		});
	});
});

describe('createKeyedPromiseQueue', () => {
	it('queues functions separately per key', async () => {
		const queue = createKeyedPromiseQueue({ concurrency: 1 });
		const blocker: PromiseWithResolvers<void> = Promise.withResolvers();
		const started: string[] = [];
		const a1 = queue('a', async () => {
			started.push('a1');
			await blocker.promise;
		});
		const a2 = queue('a', () => {
			started.push('a2');
		});
		const b1 = queue('b', () => {
			started.push('b1');
		});
		await b1;
		expect(started).to.deep.equal(['a1', 'b1']);
		blocker.resolve();
		await Promise.all([a1, a2]);
		expect(started).to.deep.equal(['a1', 'b1', 'a2']);
	});

	it('resolves with the value of the function', async () => {
		const queue = createKeyedPromiseQueue();
		expect(await queue('a', () => 1)).to.equal(1);
	});
});

describe('errors', () => {
	it('are PromiseQueueErrors with their class name as name', () => {
		for (const ErrorClass of [MaxSizeExceededError, TimeoutError]) {
			const err = new ErrorClass();
			expect(err).to.be.instanceOf(PromiseQueueError);
			expect(err).to.be.instanceOf(Error);
			expect(err.name).to.equal(ErrorClass.name);
		}
	});
});
