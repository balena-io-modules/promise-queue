import { describe, it } from 'node:test';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { expect } from 'chai';
import { createKeyedPromiseQueue } from '../src/index.ts';
import { flush, getRejection } from './helpers/utils.ts';

const memoryFixture = path.join(
	process.cwd(),
	'test',
	'fixtures',
	'keyed-queue-memory.ts',
);

const countTimeouts = () =>
	process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

describe('createKeyedPromiseQueue idle keys', () => {
	it('enforces the concurrency per key while calls are outstanding', async () => {
		const add = createKeyedPromiseQueue({ concurrency: 1 });
		const blocker: PromiseWithResolvers<void> = Promise.withResolvers();
		const events: string[] = [];
		const first = add('a', async () => {
			events.push('first start');
			await blocker.promise;
			events.push('first end');
		});
		const second = add('a', () => {
			events.push('second');
		});
		const otherKey = add('b', () => {
			events.push('other key');
		});
		await otherKey;
		await flush();
		expect(events).to.deep.equal(['first start', 'other key']);

		blocker.resolve();
		await Promise.all([first, second]);
		expect(events).to.deep.equal([
			'first start',
			'other key',
			'first end',
			'second',
		]);
	});

	it('enforces the concurrency for a key that went idle and is reused', async () => {
		const add = createKeyedPromiseQueue({ concurrency: 1 });
		expect(await add('a', () => 1)).to.equal(1);
		await flush();

		const blocker = Promise.withResolvers<number>();
		let secondStarted = false;
		const first = add('a', () => blocker.promise);
		const second = add('a', () => {
			secondStarted = true;
			return 2;
		});
		await flush();
		expect(secondStarted).to.equal(false);

		blocker.resolve(3);
		expect(await first).to.equal(3);
		expect(await second).to.equal(2);
		expect(secondStarted).to.equal(true);
	});

	it('keeps the queue for a key while a call is still waiting', async () => {
		const add = createKeyedPromiseQueue({ concurrency: 1 });
		let running = 0;
		let maxRunning = 0;
		const track = (gate: Promise<void>) => async () => {
			running++;
			maxRunning = Math.max(maxRunning, running);
			try {
				await gate;
			} finally {
				running--;
			}
		};
		const gates = Array.from({ length: 3 }, (): PromiseWithResolvers<void> =>
			Promise.withResolvers(),
		);
		const first = add('a', track(gates[0].promise));
		const second = add('a', track(gates[1].promise));
		gates[0].resolve();
		await first;
		// The second call is still running or waiting, so the third must queue
		// behind it rather than get a fresh queue for the key
		const third = add('a', track(gates[2].promise));
		await flush();
		expect(maxRunning).to.equal(1);

		gates[1].resolve();
		gates[2].resolve();
		await Promise.all([second, third]);
		expect(maxRunning).to.equal(1);
	});

	it('reuses the key after a rejection', async () => {
		const add = createKeyedPromiseQueue({ concurrency: 1 });
		const err = await getRejection(
			add('a', () => {
				throw new Error('failed');
			}),
		);
		expect(err).to.be.instanceOf(Error);
		expect((err as Error).message).to.equal('failed');

		expect(await add('a', () => 'next')).to.equal('next');
		const asyncErr = await getRejection(
			add('a', () => Promise.reject(new Error('async failed'))),
		);
		expect((asyncErr as Error).message).to.equal('async failed');
		expect(await add('a', () => 'after')).to.equal('after');
	});

	it('leaves no timers behind once many keys with maxAge are idle', async () => {
		const timersBefore = countTimeouts();
		const add = createKeyedPromiseQueue({ concurrency: 1, maxAge: 5000 });
		const results = await Promise.all(
			Array.from({ length: 200 }, (_, i) =>
				// Two calls per key, so that half of them have to wait
				Promise.all([add(`key${i}`, () => i), add(`key${i}`, () => i * 2)]),
			),
		);
		expect(results[199]).to.deep.equal([199, 398]);
		expect(countTimeouts()).to.be.at.most(timersBefore);
	});

	it('does not retain memory for keys that are idle', async () => {
		const stdout = await new Promise<string>((resolve, reject) => {
			const child = spawn(
				process.execPath,
				[
					'--expose-gc',
					'--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
					memoryFixture,
				],
				// A leaked handle would keep the child alive: kill it rather than
				// hang the suite
				{
					stdio: ['ignore', 'pipe', 'inherit'],
					timeout: 30000,
					killSignal: 'SIGKILL',
				},
			);
			let out = '';
			child.stdout.on('data', (data) => {
				out += data;
			});
			child.on('error', reject);
			child.on('close', (code, signal) => {
				if (code === 0) {
					resolve(out);
				} else {
					reject(
						new Error(
							`Memory fixture exited with code ${code}, signal ${signal}`,
						),
					);
				}
			});
		});
		const bytesPerKey = Number(stdout.trim());
		expect(bytesPerKey).to.be.a('number');
		// Retaining a queue per key costs a few hundred bytes per key
		expect(bytesPerKey).to.be.lessThan(50);
	});
});
