import { describe, expect, it } from 'vitest';
import { popover } from '$lib/transitions';

const node = {} as unknown as Element;

describe('popover', () => {
	it('defaults to a 150ms duration when no options are passed', () => {
		const cfg = popover(node);
		expect(cfg.duration).toBe(150);
	});

	it('honors a passed duration', () => {
		const cfg = popover(node, { duration: 300 });
		expect(cfg.duration).toBe(300);
	});

	it('honors a passed y offset in the css output', () => {
		const cfg = popover(node, { y: 20 });
		// at t=0 the translate uses the full negative y offset
		expect(cfg.css!(0, 1)).toContain('translateY(-20px)');
	});

	it('provides an easing function', () => {
		const cfg = popover(node);
		expect(typeof cfg.easing).toBe('function');
	});

	it('produces a css string containing opacity and a transform/translate', () => {
		const cfg = popover(node);
		const at1 = cfg.css!(1, 0);
		expect(at1).toMatch(/opacity/);
		expect(at1).toMatch(/translate|transform/);
	});

	it('produces a css string at t=0 containing opacity and a transform/translate', () => {
		const cfg = popover(node);
		const at0 = cfg.css!(0, 1);
		expect(at0).toMatch(/opacity/);
		expect(at0).toMatch(/translate|transform/);
	});

	it('is fully in at t=1 (opacity ~1, translate ~0)', () => {
		const cfg = popover(node, { y: 8 });
		const css = cfg.css!(1, 0);
		expect(css).toContain('opacity: 1');
		expect(css).toContain('translateY(0px)');
	});

	it('is fully out at t=0 (opacity ~0, translated by the y offset)', () => {
		const cfg = popover(node, { y: 8 });
		const css = cfg.css!(0, 1);
		expect(css).toContain('opacity: 0');
		expect(css).toContain('translateY(-8px)');
	});

	it('does not throw for a negative y offset', () => {
		const cfg = popover(node, { y: -8 });
		expect(() => cfg.css!(0, 1)).not.toThrow();
		// negative y at t=0 → (0-1) * -8 = 8px
		expect(cfg.css!(0, 1)).toContain('translateY(8px)');
	});

	it('does not throw for a zero duration', () => {
		const cfg = popover(node, { duration: 0 });
		expect(cfg.duration).toBe(0);
		expect(() => cfg.css!(0.5, 0.5)).not.toThrow();
	});
});
