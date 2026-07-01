/** True if adding edge from -> to creates a cycle (graph: id -> dependsOn ids). */
export function createsCycle(edges: Map<string, string[]>, from: string, to: string) {
	const stack = [to];
	const seen = new Set<string>();
	while (stack.length) {
		const cur = stack.pop()!;
		if (cur === from) return true;
		if (seen.has(cur)) continue;
		seen.add(cur);
		for (const next of edges.get(cur) ?? []) stack.push(next);
	}
	return false;
}
