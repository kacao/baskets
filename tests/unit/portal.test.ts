import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { portal } from '$lib/portal';

let host: HTMLElement;

beforeEach(() => {
	host = document.createElement('div');
	host.setAttribute('data-pane-host', '');
	document.body.appendChild(host);
});

afterEach(() => {
	document.body.replaceChildren();
});

describe('portal', () => {
	it('moves the node into the default target host', () => {
		const node = document.createElement('span');
		portal(node);
		expect(node.parentElement).toBe(host);
	});

	it('moves the node into an explicitly named target host', () => {
		const other = document.createElement('div');
		other.setAttribute('data-page-header', '');
		document.body.appendChild(other);
		const node = document.createElement('span');
		portal(node, '[data-page-header]');
		expect(node.parentElement).toBe(other);
	});

	it('relocates a node that already lives elsewhere in the DOM', () => {
		const origin = document.createElement('div');
		const node = document.createElement('span');
		origin.appendChild(node);
		document.body.appendChild(origin);
		expect(node.parentElement).toBe(origin);
		portal(node);
		expect(node.parentElement).toBe(host);
	});

	it('returns an object exposing update and destroy functions', () => {
		const node = document.createElement('span');
		const action = portal(node);
		expect(typeof action.update).toBe('function');
		expect(typeof action.destroy).toBe('function');
	});

	it('does not throw when the target selector matches no element', () => {
		const node = document.createElement('span');
		expect(() => portal(node, '[data-missing-host]')).not.toThrow();
	});

	it('leaves the node unattached when the target selector is not found', () => {
		const node = document.createElement('span');
		portal(node, '[data-missing-host]');
		expect(node.parentElement).toBeNull();
	});

	it('re-targets the node to a new host when update is called', () => {
		const other = document.createElement('div');
		other.setAttribute('data-page-header', '');
		document.body.appendChild(other);
		const node = document.createElement('span');
		const action = portal(node);
		expect(node.parentElement).toBe(host);
		action.update('[data-page-header]');
		expect(node.parentElement).toBe(other);
	});

	it('keeps the node at its current host when update targets a missing selector', () => {
		const node = document.createElement('span');
		const action = portal(node);
		action.update('[data-missing-host]');
		expect(node.parentElement).toBe(host);
	});

	it('removes the node from the DOM on destroy', () => {
		const node = document.createElement('span');
		const action = portal(node);
		expect(node.parentElement).toBe(host);
		action.destroy();
		expect(node.parentElement).toBeNull();
		expect(host.contains(node)).toBe(false);
	});

	it('does not throw on destroy when the node was never attached to a target', () => {
		const node = document.createElement('span');
		const action = portal(node, '[data-missing-host]');
		expect(() => action.destroy()).not.toThrow();
		expect(node.parentElement).toBeNull();
	});
});
