// Some restricted Windows CI runners cannot resolve the account SID via uv_os_get_passwd.
// tsx only needs a stable username to name its temporary directory.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require("node:os");
const original = os.userInfo;
os.userInfo = (...args) => {
  try { return original(...args); }
  catch { return { username: "codex-ci", uid: -1, gid: -1, shell: null, homedir: os.tmpdir() }; }
};
