import { describe, it } from 'node:test';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { expect } from 'chai';
import { PromiseQueue, TimeoutError } from '../src/index.ts';
import { getRejection } from './helpers/utils.ts';

const fixture = path.join(process.cwd(), 'test', 'fixtures', 'maxage-queue.ts');

const runFixture = (scenario: string, timeoutMs: number) =>
	new Promise<{
		code: number | null;
		signal: NodeJS.Signals | null;
		stdout: string;
		stderr: string;
	}>((resolve, reject) => {
		const child = spawn(
			process.execPath,
			['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', fixture, scenario],
			// If the child is still alive after the timeout it is killed, which
			// shows up as a non-null `signal`
			{
				stdio: ['ignore', 'pipe', 'pipe'],
				timeout: timeoutMs,
				killSignal: 'SIGKILL',
			},
		);
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (data) => {
			stdout += data;
		});
		child.stderr.on('data', (data) => {
			stderr += data;
		});
		child.on('error', reject);
		child.on('close', (code, signal) => {
			resolve({ code, signal, stdout, stderr });
		});
	});

const countTimeouts = () =>
	process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

describe('maxAge timer', () => {
	describe('process lifetime', () => {
		it('lets the process exit when an idle queue with maxAge was created', async () => {
			const result = await runFixture('idle', 5000);
			expect(result.signal, 'child had to be killed').to.equal(null);
			expect(result.code).to.equal(0);
			expect(result.stdout.trim()).to.equal('done');
		});

		it('lets the process exit after functions ran through a queue with maxAge', async () => {
			const result = await runFixture('used', 5000);
			expect(result.signal, 'child had to be killed').to.equal(null);
			expect(result.code).to.equal(0);
			expect(result.stdout.trim().split('\n')).to.deep.equal([
				'[1,2,3]',
				'done',
			]);
		});
	});

	describe('expiry', () => {
		it('rejects waiting functions with TimeoutError and emits timeout', async () => {
			const q = new PromiseQueue({ concurrency: 1, maxAge: 1000 });
			let timedOut = 0;
			q.metrics.on('timeout', (count: number) => {
				timedOut += count;
			});

			const blocker: PromiseWithResolvers<void> = Promise.withResolvers();
			const running = q.add(() => blocker.promise);
			const waiting1 = q.add(() => 'never');
			const waiting2 = q.add(() => 'never');

			const err1 = await getRejection(waiting1);
			const err2 = await getRejection(waiting2);
			expect(err1).to.be.instanceOf(TimeoutError);
			expect(err2).to.be.instanceOf(TimeoutError);
			expect(timedOut).to.equal(2);

			blocker.resolve();
			await running;
		});

		it('stops the timer once the queue is empty and restarts it for later functions', async () => {
			const timersBefore = countTimeouts();
			const q = new PromiseQueue({ concurrency: 1, maxAge: 1000 });
			let timedOut = 0;
			q.metrics.on('timeout', (count: number) => {
				timedOut += count;
			});

			const blocker1: PromiseWithResolvers<void> = Promise.withResolvers();
			const running1 = q.add(() => blocker1.promise);
			const waiting1 = q.add(() => 'never');
			expect(await getRejection(waiting1)).to.be.instanceOf(TimeoutError);
			blocker1.resolve();
			await running1;
			expect(await q.add(() => 'ok')).to.equal('ok');

			// The queue is idle now: the timer must not stay around
			expect(countTimeouts()).to.be.at.most(timersBefore);

			// Functions queued after the idle period must still expire
			const blocker2: PromiseWithResolvers<void> = Promise.withResolvers();
			const running2 = q.add(() => blocker2.promise);
			const waiting2 = q.add(() => 'never');
			expect(await getRejection(waiting2)).to.be.instanceOf(TimeoutError);
			expect(timedOut).to.equal(2);
			blocker2.resolve();
			await running2;
			expect(countTimeouts()).to.be.at.most(timersBefore);
		});
	});
});
