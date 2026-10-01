import { describe, expect, it } from "vitest";
import installerHooks from "../../../src-tauri/installer-hooks.nsh?raw";
import chainSecretsSource from "../../../src-tauri/src/chain_secrets.rs?raw";
import { shellMenuEntries } from "./shellMenu";

function registeredExtensions(): string[] {
  const extensions = shellMenuEntries((key) => key).flatMap((entry) => entry.extensions);
  return [...new Set(extensions)];
}

function uninstallSection(): string {
  const match = /!macro NSIS_HOOK_POSTUNINSTALL([\s\S]*?)!macroend/.exec(installerHooks);
  return match?.[1] ?? "";
}

function menuDeleteLine(extension: string): string {
  return String.raw`DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.${extension}\shell\vivePDF"`;
}

describe("installer hooks", () => {
  it("removes the Explorer menu of every extension the app can register", () => {
    const section = uninstallSection();
    const missing = registeredExtensions().filter((extension) => !section.includes(menuDeleteLine(extension)));

    expect(missing).toEqual([]);
  });

  it("covers office and image sources, not only pdf", () => {
    expect(registeredExtensions()).toEqual(expect.arrayContaining(["pdf", "docx", "png"]));
  });

  it("removes the start-with-system entry the app may have written", () => {
    const section = uninstallSection();

    expect(section).toContain(String.raw`DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "vivePDF"`);
    expect(section).toContain(String.raw`DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "vivePDF"`);
  });

  it("asks the app to forget stored chain passwords before its files go, but not on update", () => {
    const flag = /FORGET_FLAG: &str = "([^"]+)"/.exec(chainSecretsSource)?.[1];
    const section = /!macro NSIS_HOOK_PREUNINSTALL([\s\S]*?)!macroend/.exec(installerHooks)?.[1] ?? "";

    expect(flag).toBe("--forget-chain-secrets");
    expect(section).toContain(String.raw`ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" ${flag}'`);
    expect(section).toMatch(/\$\{If\} \$UpdateMode <> 1[\s\S]*ExecWait[\s\S]*\$\{EndIf\}/);
  });

  it("clears the engine folder before install and after uninstall", () => {
    const engineRemoval = String.raw`RMDir /r "$INSTDIR\engine"`;

    expect(installerHooks).toMatch(/!macro NSIS_HOOK_PREINSTALL\s+RMDir \/r "\$INSTDIR\\engine"/);
    expect(uninstallSection()).toContain(engineRemoval);
  });
});
