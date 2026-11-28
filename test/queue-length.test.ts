import { describe, it } from 'node:test';
import { expect } from 'chai';
import { PromiseQueue } from '../src/index.ts';
import { flush, getRejection } from './helpers/utils.ts';

describe('queueLength metric', () => {
	it('is 0 in the last emission once a burst has drained', async () => {
		const q = new PromiseQueue({ concurrency: 1 });
		const lengths: number[] = [];
		q.metrics.on('queueLength', (n: number) => lengths.push(n));

		await Promise.all(Array.from({ length: 4 }, () => q.add(() => flush())));
		await flush();

		expect(lengths.at(-1)).to.equal(0);
	});

	it('is emitted whenever the length changes, with the new length', async () => {
		const q = new PromiseQueue({ concurrency: 1 });
		const lengths: number[] = [];
		q.metrics.on('queueLength', (n: number) => lengths.push(n));

		const blocker: PromiseWithResolvers<void> = Promise.withResolvers();
		const all = [
			q.add(() => blocker.promise),
			q.add(() => 'a'),
			q.add(() => 'b'),
			q.add(() => 'c'),
		];
		// The first function is enqueued then immediately dequeued to run
		expect(lengths).to.deep.equal([1, 0, 1, 2, 3]);

		blocker.resolve();
		await Promise.all(all);
		expect(lengths).to.deep.equal([1, 0, 1, 2, 3, 2, 1, 0]);
	});

	it('matches the actual queue length after each dequeue with higher concurrency', async () => {
		const q = new PromiseQueue({ concurrency: 2 });
		const lengths: number[] = [];
		q.metrics.on('queueLength', (n: number) => lengths.push(n));

		const gates = Array.from({ length: 4 }, (): PromiseWithResolvers<void> =>
			Promise.withResolvers(),
		);
		const all = gates.map((gate) => q.add(() => gate.promise));
		expect(lengths).to.deep.equal([1, 0, 1, 0, 1, 2]);

		gates[0].resolve();
		await flush();
		expect(lengths.slice(6)).to.deep.equal([1]);
		gates[1].resolve();
		await flush();
		expect(lengths.slice(6)).to.deep.equal([1, 0]);

		gates[2].resolve();
		gates[3].resolve();
		await Promise.all(all);
		expect(lengths.slice(6)).to.deep.equal([1, 0]);
	});

	it(
		'still runs a dequeued function when a queueLength listener throws',
		{ timeout: 2000 },
		async () => {
			const q = new PromiseQueue({ concurrency: 1 });
			let throwOnce = true;
			q.metrics.on('queueLength', (n: number) => {
				if (n === 0 && throwOnce) {
					throwOnce = false;
					throw new Error('listener');
				}
			});
			let ran = false;
			const err = await getRejection(
				q.add(() => {
					ran = true;
				}),
			);
			expect(err).to.have.property('message', 'listener');
			expect(ran).to.equal(true);
			// The concurrency slot is released, so the queue keeps working
			expect(await q.add(() => 'next')).to.equal('next');
		},
	);
});
