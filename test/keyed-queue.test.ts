import { describe, it } from 'node:test';
import { expect } from 'chai';
import { createKeyedPromiseQueue } from '../src/index.ts';
import { flush } from './helpers/utils.ts';

const prototypeKeys = [
	'constructor',
	'__proto__',
	'toString',
	'hasOwnProperty',
	'valueOf',
	'isPrototypeOf',
	'toLocaleString',
	'propertyIsEnumerable',
];

describe('createKeyedPromiseQueue with keys that exist on Object.prototype', () => {
	for (const key of prototypeKeys) {
		it(`resolves with the function's value for the key "${key}"`, async () => {
			const add = createKeyedPromiseQueue();
			expect(await add(key, () => 'value')).to.equal('value');
			expect(await add(key, () => Promise.resolve('again'))).to.equal('again');
		});
	}

	it('does not share a queue between different prototype keys', async () => {
		const add = createKeyedPromiseQueue({ concurrency: 1 });
		const blocker: PromiseWithResolvers<void> = Promise.withResolvers();
		const blocked = add('constructor', () => blocker.promise);
		const other = add('toString', () => 'other');
		const sameKey = add('constructor', () => 'same');

		expect(await other).to.equal('other');

		let sameKeyDone = false;
		void sameKey.then(() => {
			sameKeyDone = true;
		});
		await flush();
		expect(sameKeyDone).to.equal(false);

		blocker.resolve();
		await blocked;
		expect(await sameKey).to.equal('same');
	});

	it('still works for a normal key', async () => {
		const add = createKeyedPromiseQueue();
		expect(await add('a', () => 1)).to.equal(1);
		expect(await add('b', () => 2)).to.equal(2);
	});
});
