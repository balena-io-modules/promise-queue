import { setTimeout } from 'node:timers/promises';
import { afterEach, describe, it, mock } from 'node:test';
import { expect } from 'chai';
import {
	MaxSizeExceededError,
	PromiseQueue,
	TimeoutError,
} from '../src/index.ts';
import { flush, getRejection } from './helpers/utils.ts';

const trackedEvents = [
	'queueTime',
	'dequeue',
	'serviceTime',
	'latency',
	'completion',
] as const;

const track = (q: PromiseQueue) => {
	const events: string[] = [];
	for (const event of trackedEvents) {
		q.metrics.on(event, () => events.push(event));
	}
	return events;
};

describe('metrics for functions that never ran', () => {
	afterEach(() => {
		mock.timers.reset();
	});

	it('only emits queueTime for a function evicted by lifo maxSize', async () => {
		const q = new PromiseQueue({ maxSize: 1, order: 'lifo' });
		const blocker: PromiseWithResolvers<void> = Promise.withResolvers();
		const blocking = q.add(() => blocker.promise);
		const events = track(q);

		const evicted = q.add(() => 'evicted');
		const newest = q.add(() => 'newest');
		expect(await getRejection(evicted)).to.be.instanceOf(MaxSizeExceededError);
		await flush();
		expect(events).to.deep.equal(['queueTime']);

		blocker.resolve();
		await Promise.all([blocking, newest]);
		await flush();
		// Only the blocker (completion) and the function that ran (everything)
		expect(events.filter((e) => e === 'queueTime')).to.have.length(2);
		expect(events.filter((e) => e === 'dequeue')).to.have.length(1);
		expect(events.filter((e) => e === 'serviceTime')).to.have.length(2);
		expect(events.filter((e) => e === 'latency')).to.have.length(2);
		expect(events.filter((e) => e === 'completion')).to.have.length(2);
	});

	it('only emits queueTime for a function that timed out', async () => {
		mock.timers.enable({ apis: ['setInterval'] });
		const q = new PromiseQueue({ maxAge: 1000 });
		const blocker: PromiseWithResolvers<void> = Promise.withResolvers();
		const blocking = q.add(() => blocker.promise);
		const events = track(q);

		const timedOut = q.add(() => 'timed out');
		// Well over maxAge, so it has expired even with a coarse age check
		await setTimeout(2100);
		mock.timers.tick(1000);
		expect(await getRejection(timedOut)).to.be.instanceOf(TimeoutError);
		await flush();
		expect(events).to.deep.equal(['queueTime']);

		blocker.resolve();
		await blocking;
		await flush();
		expect(events).to.deep.equal([
			'queueTime',
			'serviceTime',
			'latency',
			'completion',
		]);
	});

	it('still emits everything once for a function that runs and rejects', async () => {
		const q = new PromiseQueue();
		const events = track(q);
		const err = await getRejection(
			q.add(() => Promise.reject(new Error('fail'))),
		);
		expect(err).to.be.instanceOf(Error);
		await flush();
		expect(events).to.deep.equal([
			'queueTime',
			'dequeue',
			'serviceTime',
			'latency',
			'completion',
		]);
	});

	it('still emits everything once for a function that throws synchronously', async () => {
		const q = new PromiseQueue();
		const events = track(q);
		const err = await getRejection(
			q.add(() => {
				throw new Error('throws');
			}),
		);
		expect(err).to.be.instanceOf(Error);
		await flush();
		expect(events).to.deep.equal([
			'queueTime',
			'dequeue',
			'serviceTime',
			'latency',
			'completion',
		]);
	});

	it('rejects with the error of a throwing metrics listener instead of hanging', async () => {
		const q = new PromiseQueue();
		q.metrics.on('queueTime', () => {
			throw new Error('listener');
		});
		const result = await Promise.race([
			getRejection(q.add(() => 'a')),
			setTimeout(200).then(() => 'still pending'),
		]);
		expect(result).to.be.instanceOf(Error);
		expect((result as Error).message).to.equal('listener');
	});
});
