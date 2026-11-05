import { setTimeout } from 'timers/promises';

/** Lets all pending promise callbacks (and the queue's follow-up work) run */
export const flush = () => setTimeout(0);

/**
 * Captures the rejection of `promise` so it can be asserted after the await,
 * where a missing rejection can't be swallowed by a `catch` block
 */
export const getRejection = async (promise: PromiseLike<unknown>) => {
	try {
		await promise;
	} catch (err) {
		return err;
	}
	return undefined;
};
