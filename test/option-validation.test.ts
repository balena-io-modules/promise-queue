import { describe, it } from 'node:test';
import { expect } from 'chai';
import { PromiseQueue } from '../src/index.ts';

// Values a JavaScript caller (or a parsed environment variable) could pass
const getError = (options: Record<string, unknown>) => {
	try {
		new PromiseQueue(options);
	} catch (err) {
		return err;
	}
};

const invalidCounts: Array<[string, unknown]> = [
	['NaN', NaN],
	['a negative number', -1],
	['-Infinity', -Infinity],
	['a fraction', 1.5],
	['a string', '0'],
	['a numeric string', '5'],
	['null', null],
	['a boolean', true],
];

describe('option validation', () => {
	for (const option of ['concurrency', 'maxSize'] as const) {
		describe(option, () => {
			for (const [description, value] of invalidCounts) {
				it(`throws for ${description}`, () => {
					const err = getError({ [option]: value });
					expect(err).to.be.instanceOf(Error);
					expect((err as Error).message).to.equal(
						`${option} must be a non-negative integer`,
					);
				});
			}

			it('accepts 0 (unlimited), positive integers and Infinity', () => {
				for (const value of [0, 1, 10, Infinity]) {
					expect(getError({ [option]: value })).to.equal(undefined);
				}
			});
		});
	}

	describe('maxAge', () => {
		for (const [description, value] of [
			['NaN', NaN],
			['-Infinity', -Infinity],
			['a fraction', 1000.5],
			['a string', 'abc'],
			['a numeric string', '1000'],
			['null', null],
		] as Array<[string, unknown]>) {
			it(`throws for ${description}`, () => {
				const err = getError({ maxAge: value });
				expect(err).to.be.instanceOf(Error);
				expect((err as Error).message).to.equal('maxAge must be an integer');
			});
		}

		it('accepts 0, positive integers and Infinity', (t) => {
			// A positive maxAge starts an interval, which must not keep the tests alive
			t.mock.timers.enable({ apis: ['setInterval'] });
			for (const value of [0, 1000, Infinity]) {
				expect(getError({ maxAge: value })).to.equal(undefined);
			}
		});

		it('still accepts a negative integer, which disables timeouts', () => {
			expect(getError({ maxAge: -1 })).to.equal(undefined);
		});
	});
});
