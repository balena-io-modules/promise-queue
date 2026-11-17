import { EventEmitter } from 'eventemitter3';
import { PromiseQueue } from '../../out/index.js';
import type { PromiseQueueMetricsEvents } from '../../out/index.js';
import { isType } from './helpers.ts';
import type { Equal, Expect } from './helpers.ts';

const q = new PromiseQueue();
const noop = (): void => undefined;

// Unknown event names are rejected
// @ts-expect-error unknown event
q.metrics.on('arival', noop);
// @ts-expect-error unknown event
q.metrics.once('arival', noop);
// @ts-expect-error unknown event
q.metrics.off('arival');
// @ts-expect-error unknown event
q.metrics.emit('arival');

// The listener arguments are inferred
q.metrics.on('timeout', (count) => isType<number>()(count));
q.metrics.on('queueTime', (milliseconds) => isType<number>()(milliseconds));
q.metrics.on('arrival', noop);

// Listeners with wrongly typed arguments are rejected
// @ts-expect-error queueLength is a number
q.metrics.on('queueLength', (n: string) => n);
// @ts-expect-error inFlight is a number
q.metrics.once('inFlight', (n: string) => n);
// @ts-expect-error arrival has no arguments
q.metrics.on('arrival', (n: number) => n);
// @ts-expect-error timeout needs a number
q.metrics.emit('timeout', 'x');

// Every documented event is accepted
for (const event of [
	'arrival',
	'enqueue',
	'dequeue',
	'completion',
	'rejection',
] as const) {
	q.metrics.on(event, noop);
}
for (const event of [
	'queueLength',
	'inFlight',
	'queueTime',
	'serviceTime',
	'latency',
	'timeout',
] as const) {
	q.metrics.on(event, (n: number) => n);
}

// The open-balena-api pattern needs `as const`
for (const cause of ['rejection', 'timeout'] as const) {
	q.metrics.on(cause, (count = 1) => count);
}
for (const cause of ['rejection', 'timeout']) {
	// @ts-expect-error cause is a string, not an event name
	q.metrics.on(cause, (count = 1) => count);
}

// `metrics` is readonly
// @ts-expect-error metrics is readonly
q.metrics = new EventEmitter();

// PromiseQueueMetricsEvents is exported
export type TimeoutArgs = Expect<
	Equal<PromiseQueueMetricsEvents['timeout'], [count: number]>
>;
export type ArrivalArgs = Expect<
	Equal<PromiseQueueMetricsEvents['arrival'], []>
>;
export const names: Array<keyof PromiseQueueMetricsEvents> = [
	'arrival',
	'latency',
];
