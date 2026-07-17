# Vendored: cuelume 0.1.2

Interaction sounds synthesized via the Web Audio API. MIT © Daniel Belyi.

- Upstream: https://github.com/Danilaa1/cuelume · https://www.npmjs.com/package/cuelume
- Vendored from the npm 0.1.2 tarball (`dist/` + LICENSE, verbatim) on 2026-07-16 after a
  source audit (pure Web Audio + delegated listeners; no network/eval/storage access, no
  install scripts, zero dependencies). Vendored instead of npm-installed because the
  package was younger than the local `min-release-age=7` npm supply-chain policy (ADR-063).
- To switch to the npm dependency later: `npm install cuelume`, change the import in
  `src/lib/sound.svelte.ts` from `$lib/vendor/cuelume/index.js` to `cuelume`, delete this folder.
- Do not edit these files by hand — replace wholesale from a newer audited tarball.
