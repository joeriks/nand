import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { DraftStore, newDraft, readDraft } from "@/lib/drafts";
import { LocalFiles, type LocalFilesTransport } from "@/lib/local-files";
import { dirty, draftKey } from "@/lib/types";

function fixture(initial: Record<string, string> = {}) {
  const disk = new Map(Object.entries(initial));
  const store = new DraftStore(), scope = crypto.randomUUID(), account = "local";
  let failSave = false, loseReply = false;
  const transport: LocalFilesTransport = {
    snapshot: async paths => ({ directory: "C:\\Documents\\nand", files: [...disk].filter(([path]) => paths.includes(path)).map(([path, text]) => ({ path, text })) }),
    save: async ({ path, text, expected }) => {
      if (failSave) throw new Error("Disken är skrivskyddad");
      const current = disk.get(path) ?? null;
      if (current !== expected && current !== text) return { saved: false, text: current };
      disk.set(path, text);
      if (loseReply) throw new Error("Svaret försvann");
      return { saved: true, text };
    },
  };
  const files = new LocalFiles({ store, scope, account, transport, owns: () => true });
  const key = (path: string) => draftKey(account, scope, path);
  const draft = (path: string, text: string) => { store.set(newDraft(account, scope, { path, text, sha: null })); };
  return { disk, store, files, key, draft, transport, fail: () => { failSave = true; }, lose: (value: boolean) => { loseReply = value; } };
}

describe("ordinary local files with a durable editing buffer", () => {
  it("migrates drafts and reads only explicitly included existing files", async () => {
    const f = fixture({ "existing.md": "# Original", "Data/table.csv": "\ufeffID;Pris\r\n001;1,25\r\n" });
    f.draft("Legacy.md", "# Bevarat utkast\r\n");
    await f.files.tick();
    expect(f.files.state.error).toBe("");
    expect(f.disk.get("Legacy.md")).toBe("# Bevarat utkast\r\n");
    expect(f.store.get(f.key("existing.md"))).toBeUndefined();
    await f.files.include("Data/table.csv");
    expect(f.store.get(f.key("Data/table.csv"))?.text).toBe("\ufeffID;Pris\r\n001;1,25\r\n");
    expect(dirty(f.store.get(f.key("Legacy.md"))!)).toBe(false);
    expect((await readDraft(f.key("Legacy.md")))?.text).toBe("# Bevarat utkast\r\n");
  });
  it("persists exclusion, stops reading excluded files, and safely includes them again", async () => {
    const f = fixture({ "note.md": "# First" });
    await f.files.include("note.md"); await f.files.exclude("note.md");
    expect((await readDraft(f.key("note.md")))?.localExcluded).toBe(true);
    f.disk.set("note.md", "# External"); await f.files.tick();
    expect(f.store.get(f.key("note.md"))?.text).toBe("# First");
    expect(f.disk.get("note.md")).toBe("# External");
    await f.files.include("note.md");
    expect(f.store.get(f.key("note.md"))?.text).toBe("# External");
    expect(f.store.get(f.key("note.md"))?.localExcluded).toBe(false);
  });
  it("does not exclude a conflicted draft", async () => {
    const f = fixture({ "note.md": "# Disk" }); f.draft("note.md", "# Unsaved");
    await expect(f.files.exclude("note.md")).rejects.toThrow("konflikter");
    expect(f.store.get(f.key("note.md"))?.localExcluded).not.toBe(true);
  });
  it("does not overwrite an existing file when migrating a same-name draft", async () => {
    const f = fixture({ "note.md": "# Disk version" }); f.draft("note.md", "# Local draft");
    await f.files.tick();
    expect(f.disk.get("note.md")).toBe("# Disk version");
    expect(f.store.get(f.key("note.md"))?.conflict?.remote.text).toBe("# Disk version");
    expect(f.store.get(f.key("note.md"))?.text).toBe("# Local draft");
  });
  it("reads external edits and protects simultaneous edits or external deletions with conflicts", async () => {
    const f = fixture({ "note.md": "# First" }); await f.files.include("note.md"); await f.files.tick();
    f.disk.set("note.md", "# External"); await f.files.tick();
    expect(f.store.get(f.key("note.md"))?.text).toBe("# External");
    f.store.update(f.key("note.md"), value => ({ ...value, text: "# Typing" }));
    f.disk.set("note.md", "# Changed again"); await f.files.tick();
    expect(f.disk.get("note.md")).toBe("# Changed again");
    expect(f.store.get(f.key("note.md"))?.conflict?.remote.text).toBe("# Changed again");
    f.disk.delete("note.md"); await f.files.tick();
    expect(f.store.get(f.key("note.md"))?.conflict?.remote.sha).toBeNull();
    expect(f.store.get(f.key("note.md"))?.text).toBe("# Typing");
  });
  it("persists an unsaved draft when disk writes fail", async () => {
    const f = fixture(); f.fail(); f.draft("note.md", "# Important"); await f.files.tick();
    expect(f.files.state.error).toContain("skrivskyddad");
    expect(f.disk.has("note.md")).toBe(false);
    expect((await readDraft(f.key("note.md")))?.text).toBe("# Important");
  });
  it("sends image data through the binary saver and never writes it as text", async () => {
    const image = "data:image/png;base64,iVBORw0KGgo=";
    const f = fixture(); f.draft("picture.png", image);
    await f.files.tick();
    expect(f.files.state.error).toContain("Bildsparning saknas");
    expect(f.disk.has("picture.png")).toBe(false);
    expect((await readDraft(f.key("picture.png")))?.text).toBe(image);
    f.transport.saveImage = async ({ path, dataUrl, expected }) => {
      expect(expected).toBeNull();
      f.disk.set(path, dataUrl);
      return { saved: true, text: dataUrl };
    };
    await f.files.tick();
    expect(f.disk.get("picture.png")).toBe(image);
    expect(dirty(f.store.get(f.key("picture.png"))!)).toBe(false);
  });
  it("recovers a lost save reply while retaining newer edits", async () => {
    const f = fixture(); f.lose(true); f.draft("note.md", "# First save"); await f.files.tick();
    expect(f.disk.get("note.md")).toBe("# First save");
    f.store.update(f.key("note.md"), value => ({ ...value, text: "# Newer edit" }));
    f.lose(false); await f.files.tick();
    expect(f.disk.get("note.md")).toBe("# Newer edit");
    expect(f.store.get(f.key("note.md"))?.conflict).toBeUndefined();
  });
  it("keeps typing after an in-flight save dirty until the next save", async () => {
    const f = fixture(); f.draft("note.md", "# Captured");
    const save = f.transport.save;
    f.transport.save = async input => { f.store.update(f.key("note.md"), value => ({ ...value, text: "# Later" })); return save(input); };
    await f.files.tick();
    expect(f.disk.get("note.md")).toBe("# Captured");
    expect(f.store.get(f.key("note.md"))?.text).toBe("# Later");
    expect(dirty(f.store.get(f.key("note.md"))!)).toBe(true);
    f.transport.save = save; await f.files.flush();
    expect(f.disk.get("note.md")).toBe("# Later");
  });
});
