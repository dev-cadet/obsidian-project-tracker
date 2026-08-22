import type { Project } from "../../types";

/**
 * The saved arrangement, applied to what the store found.
 *
 * Two halves, so an arrangement can never hide a project: the ones it names, in
 * the order it names them, then everything it does not — a project made since,
 * one whose id has changed, one that was never dragged — in the order they
 * arrived, which from the store is alphabetical.
 *
 * Ids rather than paths, because a project keeps its id when its folder is
 * renamed and an arrangement should survive that.
 */
export function orderProjects(projects: Project[], order: string[]): Project[] {
	const rank = new Map(order.map((id, index) => [id, index]));

	const arranged: Project[] = [];
	const rest: Project[] = [];
	for (const project of projects) {
		(rank.has(project.id) ? arranged : rest).push(project);
	}

	arranged.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
	return [...arranged, ...rest];
}
