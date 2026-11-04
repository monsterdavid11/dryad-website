import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  existsSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";
import { fixture } from "./test-fixture.js";
import { signer } from "./security.js";
const executable = process.env.DRYAD_TEST_LAUNCHER_EXE,
  sdk = executable || resolve(".tools/dotnet/dotnet.exe"),
  launcher =
    executable || resolve("../launcher/bin/Release/net10.0-windows/Dryad.dll"),
  verifier =
    process.env.DRYAD_TEST_VERIFIER ||
    resolve("../build-dryad/Release/DryadLicenseTest.exe"),
  keyPath =
    process.env.DRYAD_TEST_LICENSE_KEY || resolve("data/keys/license.pem");
test(
  "actual .NET launcher pairs, DPAPI persists/rotates credentials, and Windows DLL verifier accepts only valid unexpired signatures",
  {
    skip:
      !process.env.DRYAD_TEST_LAUNCHER_EXE ||
      !existsSync(sdk) ||
      !existsSync(launcher) ||
      !existsSync(verifier) ||
      !existsSync(keyPath),
    timeout: 30000,
  },
  async () => {
    const signing = signer(readFileSync(keyPath)),
      f = await fixture({ signing, allowDevLicenses: false }),
      dir = mkdtempSync(resolve("data/native-e2e-")),
      state = resolve(dir, "Dryad");
    const child = async (program, args, onLine, env = {}) =>
      new Promise((resolveResult, reject) => {
        const p = spawn(program, args, {
          windowsHide: true,
          env: { ...process.env, ...env },
        });
        let out = "",
          err = "",
          buffer = "";
        p.stdout.on("data", (chunk) => {
          out += chunk;
          buffer += chunk;
          let i;
          while ((i = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, i);
            buffer = buffer.slice(i + 1);
            onLine?.(line);
          }
        });
        p.stderr.on("data", (c) => (err += c));
        p.once("error", reject);
        const timeout = setTimeout(() => {
          p.kill();
          reject(Error("Child process timed out."));
        }, 20000);
        p.once("exit", (code) => {
          clearTimeout(timeout);
          resolveResult({ code, out, err });
        });
      });
    try {
      const account = await f.register();
      f.grant(account.data.user);
      // A test-only paid subscription fixture; no payment provider mutation.
      f.db
        .prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,?)")
        .run(
          account.data.user.id,
          "sub_launcher_fixture",
          "active",
          "monthly",
          Math.floor(Date.now() / 1000) + 86400,
          0,
        );
      let approval;
      const args = [
        ...(executable ? [] : [launcher]),
        "--api",
        f.base,
        "--development",
        "--no-browser",
        "--once",
        "--state",
        state,
      ];
      const first = await child(sdk, args, (line) => {
        try {
          const event = JSON.parse(line);
          if (event.event === "pairing")
            approval = f.request("/account/pairing/approve", {
              method: "POST",
              cookie: account.cookie,
              body: { code: event.code },
            });
        } catch {}
      });
      assert.equal(first.code, 0, first.err);
      assert.equal((await approval).status, 200);
      const ciphertext = readFileSync(resolve(state, "credentials.bin"));
      assert.equal(ciphertext.includes(Buffer.from("refreshToken")), false);
      assert.equal(ciphertext.includes(Buffer.from("privateKey")), false);
      const outbox = resolve(state, "outbox");
      mkdirSync(outbox, { recursive: true });
      writeFileSync(
        resolve(outbox, "usage.json"),
        JSON.stringify({
          sessionId: "native-e2e",
          sequence: 1,
          day: new Date().toISOString().slice(0, 10),
          script: "Farming loop",
          seconds: 17,
          runs: 1,
          gold: 123,
          elixir: 456,
          walls: 0,
        }),
      );
      const initial = readFileSync(resolve(state, "license.jwt"), "utf8");
      const second = await child(sdk, args);
      assert.equal(second.code, 0, second.err);
      const lease = readFileSync(resolve(state, "license.jwt"), "utf8");
      const claims = JSON.parse(Buffer.from(lease.split(".")[1], "base64url"));
      const nativeHardware = await child(verifier, ["hardware"]);
      const launcherHardware = await child(sdk, [
        ...(executable ? [] : [launcher]),
        "--hardware-id",
      ]);
      assert.equal(nativeHardware.code, 0);
      assert.equal(launcherHardware.code, 0);
      assert.equal(nativeHardware.out, launcherHardware.out);
      assert.equal(claims.hardware, nativeHardware.out);
      assert.notEqual(lease, initial);
      assert.equal(
        f.db
          .prepare("SELECT gold FROM usage WHERE user_id=?")
          .get(account.data.user.id).gold,
        123,
      );
      assert.equal(existsSync(resolve(outbox, "usage.json")), false);
      assert.equal(
        (await child(verifier, ["allowed"], null, { LOCALAPPDATA: dir })).code,
        0,
      );
      const parts = lease.split(".");
      parts[1] = Buffer.from(
        JSON.stringify({
          ...JSON.parse(Buffer.from(parts[1], "base64url")),
          exp: 9999999999,
        }),
      ).toString("base64url");
      writeFileSync(resolve(state, "license.jwt"), parts.join("."));
      assert.equal(
        (await child(verifier, ["denied"], null, { LOCALAPPDATA: dir })).code,
        0,
      );
      writeFileSync(
        resolve(state, "license.jwt"),
        signing.sign({
          ...claims,
          iss: "dryad",
          aud: "dryad-overlay",
          product: "dryad",
          iat: 1,
          exp: 2,
          jti: "expired",
        }),
      );
      assert.equal(
        (await child(verifier, ["denied"], null, { LOCALAPPDATA: dir })).code,
        0,
      );
      const now = Math.floor(Date.now() / 1000);
      const developmentKey = resolve("data/keys/license.pem");
      if (existsSync(developmentKey) && resolve(keyPath) !== developmentKey) {
        writeFileSync(
          resolve(state, "license.jwt"),
          signer(readFileSync(developmentKey)).sign(claims),
        );
        assert.equal(
          (await child(verifier, ["denied"], null, { LOCALAPPDATA: dir })).code,
          0,
          "Development signing key accepted by production release",
        );
      }
      for (const patch of [
        { hardware: "0".repeat(64) },
        { development: true },
        { hardware: undefined },
        { device: undefined },
        { sub: undefined },
        { exp: now + 601, iat: now },
        { product: "other" },
      ]) {
        writeFileSync(
          resolve(state, "license.jwt"),
          signing.sign({ ...claims, ...patch }),
        );
        assert.equal(
          (await child(verifier, ["denied"], null, { LOCALAPPDATA: dir })).code,
          0,
          "Unsafe lease accepted: " + JSON.stringify(patch),
        );
      }
      writeFileSync(
        resolve(state, "license.jwt"),
        signing.sign({
          ...claims,
          iss: "dryad",
          aud: "dryad-overlay",
          product: "dryad",
          iat: now,
          exp: now + 2,
          jti: "live-expiry",
        }),
      );
      assert.equal(
        (await child(verifier, ["expiry"], null, { LOCALAPPDATA: dir })).code,
        0,
      );
      writeFileSync(resolve(state, "license.jwt"), lease);
      const device = f.db
        .prepare("SELECT id FROM devices WHERE user_id=?")
        .get(account.data.user.id);
      await f.request("/account/devices/" + device.id, {
        method: "DELETE",
        cookie: account.cookie,
      });
      const revoked = await child(sdk, args);
      assert.equal(revoked.code, 1);
      assert.equal(existsSync(resolve(state, "license.jwt")), false);
    } finally {
      await f.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
