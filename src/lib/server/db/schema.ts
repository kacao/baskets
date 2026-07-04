// Dialect facade (ADR-050). Every table object is re-exported from here so all
// ~65 importers keep `import { task } from '$lib/server/db/schema'` unchanged.
//
// Both dialect modules are STRUCTURALLY IDENTICAL (same table + column names), so
// we pick the active one at runtime and cast the Postgres schema onto the sqlite
// types — TypeScript then sees one consistent shape (sqlite is canonical for
// types), while the actual SQL is produced by the db instance in ./index created
// with the matching driver. Keep schema.sqlite.ts and schema.pg.ts in lockstep.
import * as sqliteSchema from './schema.sqlite';
import * as pgSchema from './schema.pg';
import { DIALECT } from './dialect';

const active: typeof sqliteSchema =
	DIALECT === 'postgres' ? (pgSchema as unknown as typeof sqliteSchema) : sqliteSchema;

export const {
	// better-auth
	user,
	session,
	account,
	verification,
	twoFactor,
	// app
	workspace,
	project,
	apiKey,
	integration,
	status,
	projectStatus,
	view,
	permission,
	milestone,
	milestoneDependency,
	location,
	labelGroup,
	label,
	projectLabel,
	taskLabel,
	projectDependency,
	taskDependency,
	task,
	customField,
	customFieldOption,
	taskCustomValue,
	projectCustomValue,
	file,
	comment,
	activity,
	notification,
	template
} = active;
