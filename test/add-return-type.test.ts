import { describe, it } from 'node:test';
import { expect } from 'chai';
import { createKeyedPromiseQueue, PromiseQueue } from '../src/index.ts';

describe('add return type', () => {
	it('resolves a mixed-return function with either value', async () => {
		const mixed = (promise: boolean) => () =>
			promise ? Promise.resolve('s') : 1;
		const q = new PromiseQueue();
		expect(await q.add(mixed(true))).to.equal('s');
		expect(await q.add(mixed(false))).to.equal(1);

		const add = createKeyedPromiseQueue();
		expect(await add('k', mixed(true))).to.equal('s');
		expect(await add('k', mixed(false))).to.equal(1);
	});
});
