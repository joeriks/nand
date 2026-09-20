import { describe, expect, it, vi } from "vitest";
import { saveVersion, serial } from "@/lib/server/save";
import { AppError } from "@/lib/server/errors";
const base = { path: "Å ä.md", text: "original", sha: "a".repeat(40) };
const saved = { ...base, text: "ändrad", sha: "b".repeat(40) };
describe("GitHub save protocol", () => {
  it("saves only from the expected base", async () => {
    const write = vi.fn().mockResolvedValue(saved);
    expect(await saveVersion({ text: saved.text, baseSha: base.sha }, async () => base, write)).toEqual(saved);
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("never writes when another session has changed the file", async () => {
    const write = vi.fn();
    await expect(saveVersion({ text: "my version", baseSha: base.sha }, async () => saved, write)).rejects.toMatchObject({ status: 409, code: "conflict", details: saved });
    expect(write).not.toHaveBeenCalled();
  });
  it("rejects a create when that path was created elsewhere", async () => {
    const write = vi.fn();
    await expect(saveVersion({ text: "new", baseSha: null }, async () => base, write)).rejects.toMatchObject({ code: "conflict" });
    expect(write).not.toHaveBeenCalled();
  });
  it("recognizes an already committed snapshot without another commit", async () => {
    const write = vi.fn();
    expect(await saveVersion({ text: saved.text, baseSha: base.sha }, async () => saved, write)).toEqual(saved);
    expect(write).not.toHaveBeenCalled();
  });
  it("reads back after a dropped write response and confirms the commit", async () => {
    const read = vi.fn().mockResolvedValueOnce(base).mockResolvedValueOnce(saved);
    const write = vi.fn().mockRejectedValue(new AppError(503, "network", "lost"));
    expect(await saveVersion({ text: saved.text, baseSha: base.sha }, read, write)).toEqual(saved);
    expect(write).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(2);
  });
  it("does not retry a write when the outcome cannot be read", async () => {
    const read = vi.fn().mockResolvedValueOnce(base).mockRejectedValueOnce(new AppError(503, "network", "offline"));
    const write = vi.fn().mockRejectedValue(new AppError(503, "network", "lost"));
    await expect(saveVersion({ text: saved.text, baseSha: base.sha }, read, write)).rejects.toMatchObject({ code: "uncertain" });
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("detects a race between the preflight and GitHub's conditional write", async () => {
    const other = { ...saved, text: "other person" };
    const read = vi.fn().mockResolvedValueOnce(base).mockResolvedValueOnce(other);
    await expect(saveVersion({ text: saved.text, baseSha: base.sha }, read, async () => { throw new AppError(409, "github-write", "race"); })).rejects.toMatchObject({ code: "conflict", details: other });
  });
  it("respects a protected branch when the remote version is unchanged", async () => {
    await expect(saveVersion({ text: saved.text, baseSha: base.sha }, async () => base, async () => { throw new AppError(403, "github-write", "protected"); })).rejects.toMatchObject({ status: 403, code: "github-write" });
  });
  it("does not infer an empty new file was saved when the path is missing", async () => {
    const write = vi.fn().mockResolvedValue({ ...saved, text: "" });
    await saveVersion({ text: "", baseSha: null }, async () => ({ ...base, text: "", sha: null }), write);
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("serializes writes for a branch and recovers after a failed operation", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = serial("branch", async () => { order.push("first-start"); await gate; order.push("first-end"); throw new Error("fail"); }).catch(() => undefined);
    const second = serial("branch", async () => { order.push("second"); });
    await Promise.resolve(); await Promise.resolve(); expect(order).toEqual(["first-start"]);
    release(); await Promise.all([first, second]); expect(order).toEqual(["first-start", "first-end", "second"]);
  });
});
