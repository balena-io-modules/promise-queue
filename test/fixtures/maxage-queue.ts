import { setTimeout } from 'node:timers/promises';
import { PromiseQueue } from '../../src/index.ts';

// Scenarios for test/maxage-timer.test.ts: each must leave nothing keeping
// the process alive once its work is done.
const scenario = process.argv[2];

const queue = new PromiseQueue({ concurrency: 1, maxAge: 5000 });

const main = async () => {
	if (scenario === 'used') {
		// The second and third functions have to wait for the first one
		const results = await Promise.all([
			queue.add(async () => {
				await setTimeout(50);
				return 1;
			}),
			queue.add(() => 2),
			queue.add(async () => {
				await setTimeout(10);
				return 3;
			}),
		]);
		console.log(JSON.stringify(results));
	} else if (scenario !== 'idle') {
		throw new Error(`Unknown scenario: ${scenario}`);
	}
	console.log('done');
};
void main();
