/**
 * Where `path` ends up when `oldPath` is renamed to `newPath`.
 *
 * Covers the renamed thing itself and anything that was inside it, which is
 * what makes a project survive its parent folder being renamed rather than only
 * its own. Null when this rename does not touch `path` at all, so a caller can
 * use the return value as the test.
 *
 * String work, deliberately: at the moment a rename is reported the vault's own
 * tree is still being re-keyed, so a path is the only thing that can be trusted
 * to say where something went.
 */
export function renamedPath(
	path: string | null | undefined,
	oldPath: string,
	newPath: string
): string | null {
	if (!path) return null;
	if (path === oldPath) return newPath;
	return path.startsWith(`${oldPath}/`) ? newPath + path.slice(oldPath.length) : null;
}
