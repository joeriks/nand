import { z } from "zod";

export const MAX_NOTE_BYTES = 1024 * 1024;
export function validPath(path: string, allowEmpty = false): boolean {
  if (!path) return allowEmpty;
  return path.length <= 1000 && !/[\\\u0000-\u001f\u007f%?#:]/.test(path) &&
    !path.startsWith("/") && path.split("/").every(part => !!part && part !== "." && part !== ".." && part.toLowerCase() !== ".git");
}
export const rootSchema = z.string().refine(path => validPath(path, true), "Ogiltig undermapp.");
export const pathSchema = z.string().refine(path => validPath(path) && /\.(md|txt|csv)$/i.test(path), "Ange en relativ sökväg som slutar med .md, .txt eller .csv.");
export const branchSchema = z.string().min(1).max(255).refine(value => !/[\u0000-\u0020\u007f~^:?*\[\\]/.test(value) && !value.includes("..") && !value.includes("@{") && !value.startsWith("-") && !value.endsWith("/") && !value.endsWith("."), "Ogiltigt grennamn.");
export const storageModeSchema = z.enum(["repository", "wiki"]);
export const workspaceSchema = z.object({ mode: storageModeSchema.default("repository"), repository: z.object({ id: z.number().int().positive(), fullName: z.string(), installationId: z.number().int().positive(), defaultBranch: z.string(), private: z.boolean(), hasWiki: z.boolean().optional() }), branch: branchSchema, root: rootSchema });
export const selectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("repository"), repositoryId: z.number().int().positive(), installationId: z.number().int().positive(), branch: branchSchema, root: rootSchema }),
  z.object({ mode: z.literal("wiki"), repositoryId: z.number().int().positive(), installationId: z.number().int().positive(), branch: z.literal("").optional(), root: z.literal("").optional() }),
]);
export const wikiPathSchema = pathSchema.refine(path => /\.md$/i.test(path) && !path.includes("/") && !/[\\:*?"<>|]/.test(path) && !path.startsWith("-") && path.length <= 200, "Wiki-sidor ska ha ett filnamn utan mappar, till exempel Min idé.md.");
export const saveSchema = z.object({
  path: pathSchema,
  text: z.string().refine(text => new TextEncoder().encode(text).length <= MAX_NOTE_BYTES, "Anteckningen är större än 1 MiB."),
  baseSha: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
});
export function repositoryPath(root: string, path: string): string {
  rootSchema.parse(root);
  pathSchema.parse(path);
  return root ? `${root}/${path}` : path;
}
export function encodePath(path: string): string { return path.split("/").map(encodeURIComponent).join("/"); }
