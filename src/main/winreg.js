// Windows "default app" plumbing. Everything lives in HKEY_CURRENT_USER, so no admin
// rights are needed. Windows 10/11 don't let apps make themselves the default silently;
// the supported way is to register as a capable app and then send the user to the
// Default apps page, where one click on "Set default" finishes the job.
'use strict';

const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { shell } = require('electron');
const { ASSOCIATE } = require('./formats');

const APP = 'ImgViewer';
const PROGID = 'ImgViewer.Image';

const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout) => resolve({ err, stdout: String(stdout || '') }));
  });
}

function buildReg(exe) {
  const cmd = `"${exe}" "%1"`;
  const icon = `"${exe}",0`;
  const L = ['Windows Registry Editor Version 5.00', ''];
  const key = (k) => L.push('', `[HKEY_CURRENT_USER\\${k}]`);
  const val = (name, v) => L.push(`${name === '@' ? '@' : q(name)}=${q(v)}`);

  key(`Software\\Classes\\${PROGID}`);
  val('@', 'ImgViewer Image');
  val('FriendlyTypeName', 'Image');
  key(`Software\\Classes\\${PROGID}\\DefaultIcon`);
  val('@', icon);
  key(`Software\\Classes\\${PROGID}\\shell\\open`);
  val('FriendlyAppName', APP);
  key(`Software\\Classes\\${PROGID}\\shell\\open\\command`);
  val('@', cmd);

  key(`Software\\Classes\\Applications\\${APP}.exe`);
  val('FriendlyAppName', APP);
  key(`Software\\Classes\\Applications\\${APP}.exe\\shell\\open\\command`);
  val('@', cmd);
  key(`Software\\Classes\\Applications\\${APP}.exe\\SupportedTypes`);
  for (const e of ASSOCIATE) val(e, '');

  key(`Software\\${APP}\\Capabilities`);
  val('ApplicationName', APP);
  val('ApplicationDescription', 'A simple, fast, modern image viewer.');
  val('ApplicationIcon', icon);
  key(`Software\\${APP}\\Capabilities\\FileAssociations`);
  for (const e of ASSOCIATE) val(e, PROGID);

  key('Software\\RegisteredApplications');
  val(APP, `Software\\${APP}\\Capabilities`);

  for (const e of ASSOCIATE) {
    key(`Software\\Classes\\${e}\\OpenWithProgids`);
    L.push(`${q(PROGID)}=hex(0):`);
  }
  return L.join('\r\n') + '\r\n';
}

async function notifyShell() {
  const ps = "Add-Type -Namespace IV -Name S -MemberDefinition '[DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(int a, uint b, IntPtr c, IntPtr d);'; [IV.S]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)";
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps]);
}

async function register(exe) {
  if (process.platform !== 'win32') return { ok: false, reason: 'not-windows' };
  const file = path.join(os.tmpdir(), `imgviewer-assoc-${process.pid}.reg`);
  // .reg files are UTF-16LE with a BOM
  await fs.writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(buildReg(exe), 'utf16le')]));
  const r = await run('reg.exe', ['import', file]);
  fs.unlink(file).catch(() => {});
  if (r.err) return { ok: false, reason: String(r.err.message || r.err) };
  notifyShell(); // let Explorer pick up the new handler; no need to wait
  return { ok: true };
}

async function isDefault() {
  if (process.platform !== 'win32') return false;
  const checks = ['.jpg', '.png'];
  let hits = 0;
  for (const e of checks) {
    const r = await run('reg.exe', ['query', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${e}\\UserChoice`, '/v', 'ProgId']);
    if (!r.err && r.stdout.includes(PROGID)) hits++;
  }
  return hits === checks.length;
}

async function openDefaultsPage() {
  const build = parseInt(os.release().split('.')[2] || '0', 10);
  // Windows 11 can jump straight to this app's page (with its "Set default" button).
  const url = build >= 22000 ? `ms-settings:defaultapps?registeredAppUser=${APP}` : 'ms-settings:defaultapps';
  try {
    await shell.openExternal(url);
    return true;
  } catch {
    try { await shell.openExternal('ms-settings:defaultapps'); return true; } catch { return false; }
  }
}

module.exports = { register, isDefault, openDefaultsPage, buildReg };
