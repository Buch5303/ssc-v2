/**
 * Auth guard regression tests (2026-06-11). These exist because a security
 * audit found /api/github-commit and 14 other routes shipping with NO auth.
 * If these tests fail, an unauthenticated-route regression is in progress.
 */
jest.mock("next-auth/jwt", () => ({ getToken: jest.fn(async () => null) }));
import { requireInternal, requireSessionOrInternal } from "@/lib/api-guard";
import { getToken } from "next-auth/jwt";

const reqWith = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/test", { headers });

describe("api-guard", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret-test";
    process.env.ADMIN_SECRET = "admin-secret-test";
    (getToken as jest.Mock).mockResolvedValue(null);
  });

  test("requireInternal rejects no credentials", () => {
    expect(requireInternal(reqWith())?.status).toBe(401);
  });
  test("requireInternal rejects wrong secret", () => {
    expect(requireInternal(reqWith({ "x-internal-secret": "nope" }))?.status).toBe(401);
  });
  test("requireInternal accepts CRON_SECRET via bearer", () => {
    expect(requireInternal(reqWith({ authorization: "Bearer cron-secret-test" }))).toBeNull();
  });
  test("requireInternal accepts ADMIN_SECRET via x-internal-secret", () => {
    expect(requireInternal(reqWith({ "x-internal-secret": "admin-secret-test" }))).toBeNull();
  });
  test("requireInternal fails closed when no secrets configured", () => {
    process.env.CRON_SECRET = "";
    process.env.ADMIN_SECRET = "";
    expect(requireInternal(reqWith({ authorization: "Bearer " }))?.status).toBe(401);
    expect(requireInternal(reqWith({ "x-internal-secret": "" }))?.status).toBe(401);
  });
  test("requireSessionOrInternal rejects anonymous", async () => {
    expect((await requireSessionOrInternal(reqWith()))?.status).toBe(401);
  });
  test("requireSessionOrInternal accepts internal secret", async () => {
    expect(await requireSessionOrInternal(reqWith({ "x-internal-secret": "cron-secret-test" }))).toBeNull();
  });
  test("requireSessionOrInternal accepts valid session", async () => {
    (getToken as jest.Mock).mockResolvedValue({ sub: "user-1" });
    expect(await requireSessionOrInternal(reqWith())).toBeNull();
  });
});
