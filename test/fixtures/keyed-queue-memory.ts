import { setTimeout } from 'node:timers/promises';
import { createKeyedPromiseQueue } from '../../src/index.ts';

// Run with --expose-gc: prints the heap bytes retained per distinct key once
// all of the keys are idle again.
const keyCount = 50_000;
const batchSize = 100;

const gc = (globalThis as unknown as { gc: () => void }).gc;
const measureHeap = () => {
	gc();
	gc();
	return process.memoryUsage().heapUsed;
};

const add = createKeyedPromiseQueue({ concurrency: 1 });
const runKeys = async (prefix: string, count: number) => {
	for (let i = 0; i < count; i += batchSize) {
		await Promise.all(
			Array.from({ length: batchSize }, (_, j) =>
				add(`${prefix}$${i + j}$src$dest`, () => i + j),
			),
		);
	}
};

const main = async () => {
	// Warm up, so that one-off allocations are not attributed to the keys
	await runKeys('warmup', 1000);
	await setTimeout(10);
	const before = measureHeap();
	await runKeys('measured', keyCount);
	await setTimeout(10);
	const after = measureHeap();
	console.log((after - before) / keyCount);
};
void main();
