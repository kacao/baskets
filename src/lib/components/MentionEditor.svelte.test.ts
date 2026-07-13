import { render } from '@testing-library/svelte';
import { fireEvent, screen } from '@testing-library/dom';
import { describe, it, expect } from 'vitest';
import MentionEditor from './MentionEditor.svelte';

// jsdom implements Range/Selection well enough to place a caret, but (unlike
// Element) it never shipped Range.getBoundingClientRect — the component calls
// it to position the "@" picker. This is an environment gap, not a component
// bug (jsdom's own Element.getBoundingClientRect is also just a zero-rect
// stub), so we fill it in here rather than touching MentionEditor.svelte.
if (!Range.prototype.getBoundingClientRect) {
	const zeroRect = () =>
		({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
	Range.prototype.getBoundingClientRect = zeroRect;
	Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
}

describe('MentionEditor', () => {
	it('renders a contenteditable editor with the placeholder', () => {
		const { container } = render(MentionEditor, {
			props: { placeholder: 'Write something…', tasks: [{ id: 't1', title: 'Alpha' }] }
		});
		const editor = container.querySelector('[contenteditable="true"]');
		expect(editor).toBeInTheDocument();
		expect(editor).toHaveAttribute('data-placeholder', 'Write something…');
	});

	it('emits a hidden input carrying the token value when `name` is set', () => {
		const { container } = render(MentionEditor, {
			props: { name: 'description', value: 'hello @[Alpha](task:t1)' }
		});
		const hidden = container.querySelector('input[name="description"]');
		expect(hidden).toBeInTheDocument();
		expect(hidden).toHaveValue('hello @[Alpha](task:t1)');
	});

	it('does not render a hidden input when `name` is unset', () => {
		const { container } = render(MentionEditor, { props: { value: 'plain text' } });
		expect(container.querySelector('input[type="hidden"]')).not.toBeInTheDocument();
	});

	// The "@" picker is driven by the native Selection API against a real caret
	// inside the contenteditable's text node (see detectQuery/caretInfo in the
	// component). jsdom implements Range/Selection well enough to reproduce this
	// without simulating actual browser typing: we place a text node + caret by
	// hand and fire the same `input` event the browser would dispatch.
	function typeAtCaret(editor: Element, text: string) {
		const textNode = document.createTextNode(text);
		editor.appendChild(textNode);
		const range = document.createRange();
		range.setStart(textNode, text.length);
		range.collapse(true);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
		fireEvent.input(editor);
	}

	it('opens the @ picker with a matching candidate when typing "@" + a query', async () => {
		const { container } = render(MentionEditor, {
			props: { name: 'description', tasks: [{ id: 't1', title: 'Alpha' }] }
		});
		const editor = container.querySelector('[contenteditable="true"]')!;
		typeAtCaret(editor, '@al');

		const search = await screen.findByPlaceholderText('Search…');
		expect(search).toBeInTheDocument();
		expect(await screen.findByText('Alpha')).toBeInTheDocument();
	});

	it('inserts a task token into the hidden input when a candidate is chosen', async () => {
		const { container } = render(MentionEditor, {
			props: { name: 'description', tasks: [{ id: 't1', title: 'Alpha' }] }
		});
		const editor = container.querySelector('[contenteditable="true"]')!;
		typeAtCaret(editor, '@al');

		const candidate = await screen.findByText('Alpha');
		await fireEvent.click(candidate.closest('button')!);

		const hidden = container.querySelector('input[name="description"]');
		expect(hidden).toHaveValue('@[Alpha](task:t1) ');
	});
});
