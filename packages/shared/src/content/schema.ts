import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { z } from 'zod';

// fumadocs' page frontmatter and meta file (meta.json, meta.yaml) schemas,
// with `visible`, which hides a page or folder from the site's sidebar.

export const notesPageSchema = pageSchema.extend({
  visible: z.boolean().optional(),
});

export const notesMetaSchema = metaSchema.extend({
  visible: z.boolean().optional(),
});

export type NotesPageFrontmatter = z.infer<typeof notesPageSchema>;
export type NotesMeta = z.infer<typeof notesMetaSchema>;
