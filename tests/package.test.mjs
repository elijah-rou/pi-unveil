import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const root = fileURLToPath(new URL("../", import.meta.url));

test("the distributable loads without the source checkout's node_modules", { timeout: 20000 }, async () => {
  const temp = mkdtempSync(join(tmpdir(), "pi-unveil-package-"));
  try {
    const [archive] = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temp], {
      cwd: root, encoding: "utf8", timeout: 10000,
    }));
    const paths = archive.files.map((file) => file.path);
    for (const path of ["unveil.ts", "src/state.ts", "skills/unveil-plan/SKILL.md", "skills/unveil-understand/SKILL.md"]) {
      assert.ok(paths.includes(path), path);
    }
    assert.ok(!paths.some((path) => /^(node_modules|tests|plans)\//.test(path)));
    execFileSync("tar", ["-xzf", join(temp, archive.filename), "-C", temp], { timeout: 10000 });
    const packed = join(temp, "package");
    assert.equal(existsSync(join(packed, "node_modules")), false);
    const loader = new DefaultResourceLoader({
      cwd: temp, agentDir: join(temp, "agent"), settingsManager: SettingsManager.inMemory(),
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      additionalExtensionPaths: [join(packed, "unveil.ts")], additionalSkillPaths: [join(packed, "skills")],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    assert.equal(loader.getExtensions().extensions.length, 1);
    assert.deepEqual(loader.getSkills().diagnostics, []);
    assert.equal(loader.getSkills().skills.length, 2);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
