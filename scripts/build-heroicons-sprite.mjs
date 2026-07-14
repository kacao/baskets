// Generates an external SVG sprite + a names list from the `heroicons` package
// (24px OUTLINE set — stroke glyphs on currentColor, matching the old iconoir look).
//   static/heroicons.svg      — one <symbol id="<name>"> per Heroicon, PLUS alias
//                               symbols for the internal iconoir-era tokens still
//                               used across the app (so <Icon name="nav-arrow-down">
//                               keeps working — it renders the mapped Heroicon).
//   src/lib/heroiconNames.ts  — the searchable Heroicon name list (IconPicker pool).
// Run via `npm run icons:build` (also wired as a prebuild step). See ADR-052.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'node_modules', 'heroicons', '24', 'outline');
const spriteOut = join(root, 'static', 'heroicons.svg');
const namesOut = join(root, 'src', 'lib', 'heroiconNames.ts');

// iconoir token → Heroicon name. Keeps the ~60 internal icon tokens the UI chrome
// hardcodes working without touching 168 call sites (ADR-052). Every target is
// asserted to exist below. Approximate matches are marked.
const ALIASES = {
	// navigation / chevrons
	'nav-arrow-down': 'chevron-down',
	'nav-arrow-up': 'chevron-up',
	'nav-arrow-left': 'chevron-left',
	'nav-arrow-right': 'chevron-right',
	'arrow-left': 'arrow-left',
	'arrow-up-right-square': 'arrow-top-right-on-square',
	// actions
	plus: 'plus',
	xmark: 'x-mark',
	'xmark-circle': 'x-circle',
	check: 'check',
	'check-circle': 'check-circle',
	trash: 'trash',
	'edit-pencil': 'pencil-square',
	'more-horiz': 'ellipsis-horizontal',
	drag: 'bars-2', // ~ drag handle
	search: 'magnifying-glass',
	'filter-list': 'funnel',
	settings: 'cog-6-tooth',
	download: 'arrow-down-tray',
	upload: 'arrow-up-tray',
	'cloud-upload': 'cloud-arrow-up',
	'color-filter': 'swatch', // ~ color
	'data-transfer-both': 'arrows-right-left', // ~ sync/both
	// content / entities
	bell: 'bell',
	star: 'star',
	bookmark: 'bookmark',
	calendar: 'calendar',
	camera: 'camera',
	user: 'user',
	menu: 'bars-3',
	list: 'list-bullet',
	play: 'play',
	'half-moon': 'moon',
	'sun-light': 'sun',
	'task-list': 'queue-list',
	'map-pin': 'map-pin',
	page: 'document',
	'page-edit': 'document-text',
	folder: 'folder',
	label: 'tag',
	'text-box': 'document-text',
	'input-field': 'variable', // ~ custom fields
	'multiple-pages': 'document-duplicate',
	'multiple-pages-empty': 'document-duplicate',
	'triangle-flag': 'flag',
	'priority-high': 'signal', // ~ priority (signal bars)
	fire: 'fire',
	'fire-flame': 'fire',
	clock: 'clock',
	// view-type icons
	table: 'table-cells',
	'view-grid': 'squares-2x2',
	'dashboard-dots': 'chart-bar-square',
	'git-fork': 'share', // ~ flow / branching
	// file-kind icons (src/lib/files.ts)
	'media-image': 'photo',
	'media-video': 'video-camera',
	'sound-high': 'speaker-wave',
	archive: 'archive-box'
};

// iconoir tokens with NO faithful Heroicon — hand-authored to preserve the glyph.
// Inner markup only; the <symbol> wrapper supplies stroke/fill/linecap.
const CUSTOM = {
	circle: '<circle cx="12" cy="12" r="9" />',
	'git-commit': '<path d="M3 12h5.5m7 0H21" /><circle cx="12" cy="12" r="3.5" />'
};

const SYMBOL_ATTRS =
	'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

const files = readdirSync(srcDir)
	.filter((f) => f.endsWith('.svg'))
	.sort();

const names = [];
const symbols = [];
const inner = {}; // heroicon name → inner markup, for alias duplication

for (const file of files) {
	const name = file.slice(0, -4);
	const raw = readFileSync(join(srcDir, file), 'utf8');
	const body = raw
		.replace(/^[\s\S]*?<svg[^>]*>/, '')
		.replace(/<\/svg>\s*$/, '')
		.trim();
	inner[name] = body;
	names.push(name);
	symbols.push(`<symbol id="${name}" ${SYMBOL_ATTRS}>${body}</symbol>`);
}

// alias symbols (duplicate the target's markup under the iconoir token id)
const missing = [];
for (const [token, target] of Object.entries(ALIASES)) {
	if (!inner[target]) {
		missing.push(`${token} → ${target}`);
		continue;
	}
	if (inner[token]) continue; // token is itself a real Heroicon name; no alias needed
	symbols.push(`<symbol id="${token}" ${SYMBOL_ATTRS}>${inner[target]}</symbol>`);
}
if (missing.length) {
	console.error('ERROR: alias targets not found in Heroicons:\n  ' + missing.join('\n  '));
	process.exit(1);
}

// custom-authored gap symbols
for (const [token, body] of Object.entries(CUSTOM)) {
	symbols.push(`<symbol id="${token}" ${SYMBOL_ATTRS}>${body}</symbol>`);
}

const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${symbols.join('')}</svg>\n`;
mkdirSync(dirname(spriteOut), { recursive: true });
writeFileSync(spriteOut, sprite);

// every symbol id in the sprite (heroicons ∪ aliases ∪ custom) — the authoritative
// set a stored `iconoir:<name>` value validates against, so legacy alias-backed
// tokens (e.g. the built-in status icons) keep passing parseIconValue.
const allIds = [...new Set([...names, ...Object.keys(ALIASES), ...Object.keys(CUSTOM)])].sort();

const namesFile = `// AUTO-GENERATED by scripts/build-heroicons-sprite.mjs — do not edit by hand.
// Run \`npm run icons:build\`. See ADR-052.
// HEROICON_NAMES: the ${names.length} pickable Heroicon names (24px outline, https://heroicons.com).
// ICON_NAMES: every sprite symbol id (Heroicons + legacy iconoir-token aliases) — for validation.
export const HEROICON_NAMES: string[] = ${JSON.stringify(names)};
export const ICON_NAMES: string[] = ${JSON.stringify(allIds)};
`;
writeFileSync(namesOut, namesFile);

console.log(
	`heroicons: ${names.length} symbols + ${Object.keys(ALIASES).length} aliases + ${Object.keys(CUSTOM).length} custom → static/heroicons.svg (${allIds.length} ids)`
);
