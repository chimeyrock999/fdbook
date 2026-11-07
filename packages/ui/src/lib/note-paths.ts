import { NOTES_DIR } from '@fdbook/shared/asset-types.ts';

// The notes' folder in the worktree, as a prefix of the paths under it.
export const NOTES_PREFIX = `${NOTES_DIR}/`;

// The file API speaks worktree paths, the sync socket paths inside the notes.
export const syncPath = (path: string) => path.slice(NOTES_PREFIX.length);
