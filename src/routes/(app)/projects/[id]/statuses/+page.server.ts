// Reuses the project-settings load + actions (full data + all structure actions).
// ponytail: full settings load runs per sub-page; split queries if load latency matters.
import { load as base, actions } from '../settings/+page.server';

export const load = base;
export { actions };
