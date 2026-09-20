import { describe, expect, it, vi } from "vitest";
import { AppUpdates, type UpdatePackage } from "../src/lib/app-updates";

function packageStub(): UpdatePackage {
  return { version: "0.3.3", body: "Nyheter", download: vi.fn(async progress => { progress(4, 8); }), install: vi.fn(async () => {}), close: vi.fn(async () => {}) };
}
describe("app updates", () => {
  it("throttles automatic checks, allows manual checks and releases old resources", async () => {
    const update = packageStub(); const check = vi.fn(async () => update); const service = new AppUpdates(check);
    await service.check(); await service.check(); expect(check).toHaveBeenCalledTimes(1);
    expect(service.state.phase).toBe("available");
    await service.check(true); expect(check).toHaveBeenCalledTimes(2); expect(update.close).toHaveBeenCalledTimes(1);
  });
  it("does not install when download verification fails", async () => {
    const update = packageStub(); update.download = vi.fn(async () => { throw new Error("Invalid signature"); });
    const service = new AppUpdates(async () => update); const prepare = vi.fn(); const release = vi.fn();
    await service.check(); await service.install(prepare, release);
    expect(prepare).not.toHaveBeenCalled(); expect(update.install).not.toHaveBeenCalled(); expect(release).toHaveBeenCalled();
    expect(service.state.phase).toBe("error");
  });
  it("blocks installation if drafts cannot be flushed", async () => {
    const update = packageStub(); const service = new AppUpdates(async () => update); const release = vi.fn();
    await service.check(); await service.install(async () => { throw new Error("Disk full"); }, release);
    expect(update.install).not.toHaveBeenCalled(); expect(release).toHaveBeenCalled(); expect(service.state.error).toBe("Disk full");
  });
  it("downloads before flushing drafts and installs only afterwards", async () => {
    const order: string[] = []; const update = packageStub();
    update.download = async () => { order.push("download"); }; update.install = async () => { order.push("install"); };
    const service = new AppUpdates(async () => update);
    await service.check(); await service.install(async () => { order.push("flush"); }, () => {});
    expect(order).toEqual(["download", "flush", "install"]);
  });
  it("recovers from a network error without claiming the app is current", async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(null);
    const service = new AppUpdates(check); await service.check(); expect(service.state.phase).toBe("error");
    await service.check(true); expect(service.state.phase).toBe("current");
  });
});
