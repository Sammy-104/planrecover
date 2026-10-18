import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readExecutionProfile} from './execution-profile.mjs';

// The managed image uses shared-store leases. Portable checkouts, including
// Windows, must not require Linux flock/timeout or change package managers.
if (readExecutionProfile() === 'managed-linux') {
  const result=spawnSync('bash',[fileURLToPath(new URL('./install-pnpm.sh',import.meta.url))],{stdio:'inherit'});
  if(result.error)throw result.error;
  process.exit(result.status??1);
}
const js=process.env.SITES_PNPM_BIN;
const command=js?process.execPath:process.platform==='win32'?'pnpm.cmd':'pnpm';
const prefix=js?[js]:[];
const options={shell:!js&&process.platform==='win32',env:process.env};
const version=spawnSync(command,[...prefix,'--version'],{...options,encoding:'utf8'});
if(version.error)throw version.error;
if(version.status!==0||version.stdout.trim()!=='11.25.0')throw Error('Install the project-pinned pnpm 11.25.0 before installing dependencies.');
const result=spawnSync(command,[...prefix,'install','--frozen-lockfile'],{...options,stdio:'inherit'});
if(result.error)throw result.error;
process.exit(result.status??1);
